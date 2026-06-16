import * as THREE from 'three/webgpu';
import { Vector3 } from 'three';
import { vec4 } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { WaterScene, SceneContext } from '../../core/WaterScene';
import { InteractiveWaves } from '../../sim/interactive/InteractiveWaves';
import { GpuHeightMirror, WaterHeightField, type GridMapping } from '../../physics/HeightSampler';
import { Throwables } from '../../entities/Throwables';
import { SplashParticles } from '../../effects/SplashParticles';
import { createWaterMaterial } from '../ocean/WaterMaterial';

// 水槽：10m×10m 玻璃槽体，反射边界驻波，无 FFT（仅交互层）。
// N=128 给出精确 3 m/s 波速（N=512 被 CFL 限制到 0.77 m/s）。

const TANK_HALF = 5;   // 槽半宽（m）
const TANK_DEPTH = 3;  // 槽水深（m）
const TANK_N = 128;    // 交互格数，dx≈0.08m，恰好满足 CFL(c=3 m/s)

// 反弹边界（留 0.2m 给球/箱半径）
const BOUNDS = { minX: -(TANK_HALF - 0.2), maxX: TANK_HALF - 0.2, minZ: -(TANK_HALF - 0.2), maxZ: TANK_HALF - 0.2, floorY: -(TANK_DEPTH - 0.2) };

export class TankScene implements WaterScene {
  readonly name = 'tank';
  scene = new THREE.Scene();
  private ctx!: SceneContext;
  private interactive!: InteractiveWaves;
  private controls!: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private surface!: THREE.Mesh;
  private heightField!: WaterHeightField;
  private throwables!: Throwables;
  private splash!: SplashParticles;
  private heightFn!: (x: number, z: number) => number;
  private spawnSel: { kind: 'ball' | 'box' } = { kind: 'ball' };
  private downPos = new THREE.Vector2();
  private params = { waveSpeed: 3, damping: 0.006 };

  // 非 readonly 几何/材质，dispose 时释放
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];

  async init(ctx: SceneContext) {
    this.ctx = ctx;
    this.scene.background = new THREE.Color(0x6a8ea0); // 水蓝背景，透过玻璃可见

    // —— 交互层 ——
    this.interactive = new InteractiveWaves({
      N: TANK_N,
      sizeMeters: 10.4,
      boundary: 'reflect',
      waveSpeed: this.params.waveSpeed,
      damping: this.params.damping,
    });
    // origin 固定在槽中心，不跟随任何锚点

    // —— 水面 ——
    const surfGeo = new THREE.PlaneGeometry(10, 10, 128, 128);
    surfGeo.rotateX(-Math.PI / 2);
    this.geos.push(surfGeo);
    const i = this.interactive;
    const { material: surfMat } = createWaterMaterial({
      fft: null,
      interactive: { heightTex: i.heightTex, foamTex: i.foamTex, origin: i.origin, sizeMeters: i.sizeMeters },
      deepColor: new THREE.Color(0x062030),
      shallowColor: new THREE.Color(0x1a5068),
    });
    this.mats.push(surfMat);
    this.surface = new THREE.Mesh(surfGeo, surfMat);
    this.scene.add(this.surface);

    // —— 槽体结构 ——
    // 玻璃墙（transmission 材质；WebGPU r0.180 支持基础 PBR，transmission 降级为半透明）
    const glassMat = new THREE.MeshPhysicalNodeMaterial({
      color: 0xffffff, transmission: 0.92, roughness: 0.05, thickness: 0.1, transparent: true,
    });
    this.mats.push(glassMat);
    const wallConfigs = [
      { size: [10.2, TANK_DEPTH, 0.1], pos: [0, -TANK_DEPTH / 2, -(TANK_HALF + 0.05)] },
      { size: [10.2, TANK_DEPTH, 0.1], pos: [0, -TANK_DEPTH / 2, TANK_HALF + 0.05] },
      { size: [0.1, TANK_DEPTH, 10.2], pos: [-(TANK_HALF + 0.05), -TANK_DEPTH / 2, 0] },
      { size: [0.1, TANK_DEPTH, 10.2], pos: [TANK_HALF + 0.05, -TANK_DEPTH / 2, 0] },
    ];
    for (const { size, pos } of wallConfigs) {
      const geo = new THREE.BoxGeometry(...(size as [number, number, number]));
      this.geos.push(geo);
      const wall = new THREE.Mesh(geo, glassMat);
      wall.position.set(...(pos as [number, number, number]));
      this.scene.add(wall);
    }

    // 内衬水体侧面（透明蓝，可透过玻璃看到水线）
    const waterPanelMat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    waterPanelMat.colorNode = vec4(0.1, 0.35, 0.45, 0.55) as any;
    this.mats.push(waterPanelMat);
    const panelConfigs = [
      { size: [10, TANK_DEPTH], pos: [0, -TANK_DEPTH / 2, -TANK_HALF], ry: 0 },
      { size: [10, TANK_DEPTH], pos: [0, -TANK_DEPTH / 2, TANK_HALF], ry: Math.PI },
      { size: [10, TANK_DEPTH], pos: [-TANK_HALF, -TANK_DEPTH / 2, 0], ry: Math.PI / 2 },
      { size: [10, TANK_DEPTH], pos: [TANK_HALF, -TANK_DEPTH / 2, 0], ry: -Math.PI / 2 },
    ];
    for (const { size, pos, ry } of panelConfigs) {
      const geo = new THREE.PlaneGeometry(...(size as [number, number]));
      this.geos.push(geo);
      const panel = new THREE.Mesh(geo, waterPanelMat);
      panel.position.set(...(pos as [number, number, number]));
      panel.rotation.y = ry;
      this.scene.add(panel);
    }

    // 槽底
    const bottomGeo = new THREE.BoxGeometry(10, 0.1, 10);
    this.geos.push(bottomGeo);
    const bottomMat = new THREE.MeshStandardNodeMaterial({ color: 0x0d1a25, roughness: 0.6 });
    this.mats.push(bottomMat);
    const bottom = new THREE.Mesh(bottomGeo, bottomMat);
    bottom.position.set(0, -(TANK_DEPTH + 0.05), 0);
    this.scene.add(bottom);

    // 台面（大地面 + 环境参照）
    const tableGeo = new THREE.PlaneGeometry(80, 80);
    tableGeo.rotateX(-Math.PI / 2);
    this.geos.push(tableGeo);
    const tableMat = new THREE.MeshStandardNodeMaterial({ color: 0xc8b89a, roughness: 0.7 });
    this.mats.push(tableMat);
    const table = new THREE.Mesh(tableGeo, tableMat);
    table.position.y = -(TANK_DEPTH + 0.1);
    this.scene.add(table);

    // 光照
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.0);
    sun.position.set(20, 30, 15);
    this.scene.add(sun, new THREE.HemisphereLight(0xc8dff5, 0x302820, 0.7));

    // 物理高度场
    const im: GridMapping = { originX: 0, originZ: 0, sizeMeters: this.interactive.sizeMeters, N: this.interactive.N };
    this.heightField = new WaterHeightField([{
      mirror: new GpuHeightMirror(ctx.renderer, () => this.interactive.currentBuffer, this.interactive.N),
      mapping: () => im,
      tiling: false,
    }]);
    this.heightFn = (x, z) => this.heightField.height(x, z);

    this.splash = new SplashParticles(this.scene);
    this.throwables = new Throwables(this.scene, this.interactive,
      (pos, speed) => this.splash.burst(ctx.renderer, pos, speed));

    // 相机
    ctx.camera.position.set(9, 6, 9);
    ctx.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(ctx.camera, ctx.domElement);
    this.controls.minDistance = 4;
    this.controls.maxDistance = 40;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 0, 0);

    // GUI
    ctx.gui.add(this.params, 'waveSpeed', 0.5, 4, 0.1).name('波速 m/s')
      .onChange((v: number) => this.interactive.setWaveSpeed(v));
    ctx.gui.add(this.params, 'damping', 0.001, 0.05, 0.001).name('阻尼')
      .onChange((v: number) => this.interactive.setDamping(v));
    ctx.gui.add(this.spawnSel, 'kind', { 球: 'ball', 箱: 'box' }).name('投掷类型');
    ctx.gui.add({ 清空: () => this.throwables.clear() }, '清空');

    ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    ctx.domElement.addEventListener('pointerup', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.downPos.set(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 5) return;
    const el = this.ctx.domElement;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.waterPlane, hit)) return;
    // 投掷初速调小（×0.4），防止物体飞出槽外
    const origin = this.ctx.camera.position.clone().addScaledVector(this.raycaster.ray.direction, 2).setY(this.ctx.camera.position.y);
    const dir = hit.clone().sub(origin);
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const speed = 14 * 0.4;
    const vel = new Vector3(
      (dir.x / flat) * speed + (Math.random() - 0.5),
      4 * 0.4,
      (dir.z / flat) * speed + (Math.random() - 0.5),
    );
    this.throwables.spawn(e.shiftKey ? 'box' : this.spawnSel.kind, origin, vel);
  };

  update(dt: number, _time: number) {
    this.interactive.update(this.ctx.renderer, dt);
    this.splash.update(this.ctx.renderer, dt);
    this.heightField.refresh();
    this.throwables.update(dt, this.heightFn, 0, 0, undefined, BOUNDS);
    this.controls.update();
  }

  dispose() {
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.splash.dispose();
    this.throwables.dispose();
    this.controls.dispose();
    this.interactive.dispose();
    this.heightField.dispose();
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.scene.background = null;
  }
}
