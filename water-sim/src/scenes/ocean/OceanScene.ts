import * as THREE from 'three/webgpu';
import { Vector3 } from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { positionWorldDirection } from 'three/tsl';
import type { WaterScene, SceneContext } from '../../core/WaterScene';
import { FFTWaves } from '../../sim/fft/FFTWaves';
import { InteractiveWaves } from '../../sim/interactive/InteractiveWaves';
import { GpuHeightMirror, WaterHeightField, type GridMapping } from '../../physics/HeightSampler';
import { Throwables } from '../../entities/Throwables';
import { Boat } from '../../entities/Boat';
import { SplashParticles } from '../../effects/SplashParticles';
import { createOceanGeometry } from './surfaceGeometry';
import { createWaterMaterial } from './WaterMaterial';
import { skyColor } from './skyNode';

/**
 * 第一个可见的大海：FFT 海浪 + 位移水面 + 程序化天空 + OrbitControls。
 * GUI 改风速/风向/浪高需重建 FFTWaves（频谱是构造时烘焙的），choppy 可热改。
 * 物理：FFT cascade0/1 高度 + 交互层高度回读组成 WaterHeightField，供投掷物体浮力。
 */
export class OceanScene implements WaterScene {
  readonly name = 'ocean';
  scene = new THREE.Scene();
  private ctx!: SceneContext;
  private fft!: FFTWaves;
  private interactive!: InteractiveWaves;
  private controls!: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private surface!: THREE.Mesh;
  private skirt!: THREE.Mesh;
  private heightField!: WaterHeightField;
  private throwables!: Throwables;
  private boat!: Boat;
  private cellSize = 1; // 内层网格格距，由 createOceanGeometry 提供，相机吸附按此对齐
  private params = { windSpeed: 10, windDirection: 30, amplitudeScale: 1, choppiness: 1.2, foamBias: 0.6 };
  private camMode = { follow: false }; // 相机模式：false=自由轨道，true=跟船
  private spawnSel: { kind: 'ball' | 'box' } = { kind: 'ball' };
  private downPos = new THREE.Vector2(); // 左键按下位置，pointerup 时区分单击/拖拽
  private heightFn!: (x: number, z: number) => number; // 复用闭包，避免每帧新建
  private camBack = new THREE.Vector3(); // 跟船相机暂存
  private camTarget = new THREE.Vector3();
  private splash!: SplashParticles;
  private bowSplashCooldown = 0; // 船首浪花节流（0.1s 间隔），防高速下 burst 过密

  private static readonly FFT_N = 256;

  private createFFT() {
    const fft = new FFTWaves(OceanScene.FFT_N, this.spectrumParams());
    fft.choppyU.value = this.params.choppiness;
    fft.foamBiasU.value = this.params.foamBias;
    return fft;
  }

  private spectrumParams() {
    return {
      windSpeed: this.params.windSpeed,
      windDirection: (this.params.windDirection * Math.PI) / 180,
      fetch: 1e5,
      amplitudeScale: this.params.amplitudeScale,
    };
  }

  private buildMaterial() {
    const i = this.interactive;
    const { material } = createWaterMaterial({
      fft: this.fft,
      interactive: { heightTex: i.heightTex, foamTex: i.foamTex, origin: i.origin, sizeMeters: i.sizeMeters },
    });
    return material;
  }

  async init(ctx: SceneContext) {
    this.ctx = ctx;
    this.scene.backgroundNode = skyColor(positionWorldDirection);

    this.fft = this.createFFT();
    this.interactive = new InteractiveWaves({ sizeMeters: 200, boundary: 'absorb' });

    const { inner, outer, cellSize } = createOceanGeometry();
    this.cellSize = cellSize;
    const material = this.buildMaterial();
    this.surface = new THREE.Mesh(inner, material);
    this.skirt = new THREE.Mesh(outer, material);
    this.skirt.position.y = -0.01; // 略低于内层，避免 z-fighting
    this.scene.add(this.surface, this.skirt);

    // 标准材质物体需要光照
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
    sun.position.set(40, 60, 20);
    this.scene.add(sun, new THREE.HemisphereLight(0xbcd8ff, 0x102030, 0.6));

    // —— 物理高度场：FFT cascade0/1（平铺，provider 跟随 rebuild）+ 交互层（钳制，provider 跟随环形缓冲）——
    // mapping 返回复用的对象（每帧每层每查询调用，新建字面量会造成 GC 压力）
    const N = OceanScene.FFT_N;
    const mkFftLayer = (idx: number) => {
      const m: GridMapping = { originX: 0, originZ: 0, sizeMeters: 0, N };
      return {
        mirror: new GpuHeightMirror(ctx.renderer, () => this.fft.cascades[idx].heightBuffer, N),
        mapping: () => { m.sizeMeters = this.fft.cascades[idx].domainSize; return m; },
        tiling: true,
      };
    };
    const im: GridMapping = { originX: 0, originZ: 0, sizeMeters: this.interactive.sizeMeters, N: this.interactive.N };
    this.heightField = new WaterHeightField([
      mkFftLayer(0), // 250m 大尺度
      mkFftLayer(1), // 60m 中尺度（cascade2=15m 细波跳过，省回读带宽）
      {
        mirror: new GpuHeightMirror(ctx.renderer, () => this.interactive.currentBuffer, this.interactive.N),
        mapping: () => {
          im.originX = this.interactive.origin.value.x;
          im.originZ = this.interactive.origin.value.y;
          return im;
        },
        tiling: false,
      },
    ]);
    this.heightFn = (x, z) => this.heightField.height(x, z);

    this.splash = new SplashParticles(this.scene);
    this.throwables = new Throwables(this.scene, this.interactive,
      (pos, speed) => this.splash.burst(this.ctx.renderer, pos, speed));
    this.boat = new Boat(this.scene, this.interactive,
      (pos, speed) => {
        if (this.bowSplashCooldown <= 0) {
          this.splash.burst(this.ctx.renderer, pos.clone(), speed);
          this.bowSplashCooldown = 0.1;
        }
      });

    ctx.camera.position.set(0, 25, 60);
    ctx.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(ctx.camera, ctx.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.495; // 不许俯视到水面以下
    this.controls.target.set(0, 0, 0);

    const rebuild = () => {
      const old = this.fft;
      this.fft = this.createFFT();
      const mat = this.buildMaterial();
      const prevMat = this.surface.material as THREE.Material;
      this.surface.material = mat;
      this.skirt.material = mat;
      prevMat.dispose();
      old.dispose(); // 释放旧级联的 compute 管线与纹理，避免 VRAM 堆积
      // 注：mirror 的 bufferNode 用 provider 读 this.fft.cascades[idx]，rebuild 后自动指向新级联
    };
    ctx.gui.add(this.params, 'windSpeed', 2, 25, 0.5).name('风速 m/s').onFinishChange(rebuild);
    ctx.gui.add(this.params, 'windDirection', 0, 360, 1).name('风向°').onFinishChange(rebuild);
    ctx.gui.add(this.params, 'amplitudeScale', 0.2, 2.5, 0.05).name('浪高').onFinishChange(rebuild);
    ctx.gui.add(this.params, 'choppiness', 0, 2.5, 0.05).name('尖锐度')
      .onChange((v: number) => { this.fft.choppyU.value = v; });
    ctx.gui.add(this.params, 'foamBias', 0.1, 1.5, 0.05).name('泡沫阈值')
      .onChange((v: number) => { this.fft.setFoamBias(v); });
    ctx.gui.add(this.spawnSel, 'kind', { 球: 'ball', 箱: 'box' }).name('投掷类型');
    ctx.gui.add({ 清空: () => this.throwables.clear() }, '清空');
    // 相机模式：跟船时禁用轨道控制（避免与跟随写位姿打架）；
    // 切回自由时把轨道目标移到船位，否则 controls.update 会向旧目标猛拉视角
    ctx.gui.add(this.camMode, 'follow').name('跟船视角')
      .onChange((v: boolean) => {
        this.controls.enabled = !v;
        if (!v) this.controls.target.copy(this.boat.position);
      });

    // 点击海面 → 在相机处生成物体、朝点击方向抛出（Shift 键投箱，覆盖类型选择器）。
    // 左键同时是 OrbitControls 旋转键：在 pointerup 时按位移阈值区分单击与拖拽，拖拽不投掷。
    ctx.domElement.addEventListener('pointerdown', this.onPointerDown);
    ctx.domElement.addEventListener('pointerup', this.onPointerUp);
  }

  private onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    this.downPos.set(e.clientX, e.clientY);
  };

  private onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return; // 仅左键投掷，右键/中键给 OrbitControls
    if (Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y) > 5) return; // 拖拽=旋转相机
    const el = this.ctx.domElement;
    const rect = el.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.ctx.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.waterPlane, hit)) return;
    // 从相机前方 2m（同高度）投出，初速指向命中点 + 轻微随机扰动
    const origin = this.ctx.camera.position.clone().addScaledVector(this.raycaster.ray.direction, 2).setY(this.ctx.camera.position.y);
    const dir = hit.clone().sub(origin);
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const speed = 14;
    const vel = new Vector3(
      (dir.x / flat) * speed + (Math.random() - 0.5) * 2,
      4, // 略带上抛，形成抛物线
      (dir.z / flat) * speed + (Math.random() - 0.5) * 2,
    );
    const kind = e.shiftKey ? 'box' : this.spawnSel.kind;
    this.throwables.spawn(kind, origin, vel);
  };

  update(dt: number, time: number) {
    this.bowSplashCooldown = Math.max(0, this.bowSplashCooldown - dt);
    this.fft.update(this.ctx.renderer, time);
    this.splash.update(this.ctx.renderer, dt);
    // 顺序：fft → boat → follow → interactive → heightField.refresh → throwables
    // 船需在 interactive.follow 之前更新，但其激波扰动先入暂存队列，follow 更新 origin 后再换算格坐标（见 InteractiveWaves）
    this.boat.update(dt, this.heightFn);
    // 交互层网格跟随船（缓变锚点；船是玩家关注中心，激波/尾迹始终落在分辨率最高的交互层内）
    const bp = this.boat.position;
    this.interactive.follow(bp.x, bp.z);
    this.interactive.update(this.ctx.renderer, dt);
    // 物理：回读最新高度（fire-and-forget，1 帧延迟）后更新投掷物体浮力（回收锚点用船位）
    this.heightField.refresh();
    this.throwables.update(dt, this.heightFn, bp.x, bp.z);

    if (this.camMode.follow) {
      // 跟船：相机置于船后上方，lerp 平滑，lookAt 船
      // getWorldDirection 返回 +Z（Three 约定）；船头在 -Z，故 +Z 即船尾方向，相机沿此后退。
      // 压平 y 分量：相机不随船体俯仰/横摇起伏
      this.boat.group.getWorldDirection(this.camBack);
      this.camBack.y = 0;
      if (this.camBack.lengthSq() > 1e-6) this.camBack.normalize();
      this.camTarget.copy(bp).addScaledVector(this.camBack, 18); this.camTarget.y += 8;
      // 1-e^(-rate·dt)：帧率无关的指数趋近
      this.ctx.camera.position.lerp(this.camTarget, 1 - Math.exp(-3 * dt));
      this.ctx.camera.lookAt(bp.x, bp.y, bp.z);
    } else {
      this.controls.update();
    }
    // 海面网格按单元吸附跟随相机，使无限海面无游移感
    const snap = this.cellSize;
    this.surface.position.x = Math.round(this.ctx.camera.position.x / snap) * snap;
    this.surface.position.z = Math.round(this.ctx.camera.position.z / snap) * snap;
  }

  dispose() {
    this.ctx.domElement.removeEventListener('pointerdown', this.onPointerDown);
    this.ctx.domElement.removeEventListener('pointerup', this.onPointerUp);
    this.splash.dispose();
    this.throwables.dispose();
    this.boat.dispose();
    this.controls.dispose();
    this.fft.dispose();
    this.interactive.dispose();
    this.surface.geometry.dispose();
    this.skirt.geometry.dispose();
    (this.surface.material as THREE.Material).dispose();
    this.scene.backgroundNode = null;
  }
}
