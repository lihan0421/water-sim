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
import { createWaterMaterial } from '../ocean/WaterMaterial';
import { skyColor } from '../ocean/skyNode';

// 河流：FFT 细纹 + 半拉格朗日平流 + 反射/吸收边界。
// 流速 +X，宽 60m（Z 方向），OrbitControls 限于南侧视角。

const FLOW_VX = 2.5; // m/s，+X 方向流速
const FFT_N = 256;
const RIVER_HALF_W = 30; // 河面半宽（Z 方向）

export class RiverScene implements WaterScene {
  readonly name = 'river';
  scene = new THREE.Scene();
  private ctx!: SceneContext;
  private fft!: FFTWaves;
  private interactive!: InteractiveWaves;
  private controls!: OrbitControls;
  private raycaster = new THREE.Raycaster();
  private waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private surface!: THREE.Mesh;
  private heightField!: WaterHeightField;
  private throwables!: Throwables;
  private boat!: Boat;
  private splash!: SplashParticles;
  private heightFn!: (x: number, z: number) => number;
  private params = { amplitude: 0.25, flowSpeed: FLOW_VX };
  private camMode = { follow: false };
  private spawnSel: { kind: 'ball' | 'box' } = { kind: 'ball' };
  private downPos = new THREE.Vector2();
  private camBack = new THREE.Vector3();
  private camTarget = new THREE.Vector3();
  private bowSplashCooldown = 0;
  private driftTimer = 2; // 首次漂流箱提前
  private flowForce = new Vector3(); // 船只水流力暂存
  private bankMat!: THREE.MeshStandardNodeMaterial;
  private bankGeos: THREE.BoxGeometry[] = [];
  private surfaceGeo!: THREE.BufferGeometry;

  private createFFT() {
    return new FFTWaves(FFT_N, {
      windSpeed: 4,
      windDirection: 0.3,
      fetch: 5000,
      amplitudeScale: this.params.amplitude,
    });
  }

  async init(ctx: SceneContext) {
    this.ctx = ctx;
    this.scene.backgroundNode = skyColor(positionWorldDirection);

    // 河岸：两侧草色长堤（Z 方向 ±(RIVER_HALF_W + 10)，X 方向 400m）
    this.bankMat = new THREE.MeshStandardNodeMaterial({ color: 0x4a7c59, roughness: 0.9 });
    for (const sz of [-1, 1]) {
      const geo = new THREE.BoxGeometry(400, 4, 20);
      this.bankGeos.push(geo);
      const bank = new THREE.Mesh(geo, this.bankMat);
      bank.position.set(0, 1, sz * (RIVER_HALF_W + 10));
      this.scene.add(bank);
    }

    this.fft = this.createFFT();
    this.interactive = new InteractiveWaves({ sizeMeters: 150, boundary: 'absorb', waveSpeed: 4 });
    this.interactive.setFlow(FLOW_VX, 0);

    // 水面：60m 宽（Z）× 400m 长（X），跟随相机 X 方向滚动
    this.surfaceGeo = new THREE.PlaneGeometry(400, 60, 400, 60);
    this.surfaceGeo.rotateX(-Math.PI / 2);
    const i = this.interactive;
    const { material, uniforms } = createWaterMaterial({
      fft: this.fft,
      interactive: { heightTex: i.heightTex, foamTex: i.foamTex, origin: i.origin, sizeMeters: i.sizeMeters },
      deepColor: new THREE.Color(0x12402e),
      shallowColor: new THREE.Color(0x3d6e4f),
    });
    uniforms.fftFade.value = 0.35; // 河流 FFT 贡献降低，以小纹理为主
    this.surface = new THREE.Mesh(this.surfaceGeo, material);
    this.scene.add(this.surface);

    // 光照（MeshStandardNodeMaterial 河岸需要）
    const sun = new THREE.DirectionalLight(0xfff2e0, 2.2);
    sun.position.set(40, 60, 20);
    this.scene.add(sun, new THREE.HemisphereLight(0xbcd8ff, 0x102030, 0.6));

    // 物理高度场
    const N = FFT_N;
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
      mkFftLayer(0),
      mkFftLayer(1),
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

    ctx.camera.position.set(0, 20, 80);
    ctx.camera.lookAt(0, 0, 0);
    this.controls = new OrbitControls(ctx.camera, ctx.domElement);
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.target.set(0, 0, 0);

    ctx.gui.add(this.params, 'amplitude', 0.05, 0.5, 0.05).name('浪高').onFinishChange(() => {
      const old = this.fft;
      this.fft = this.createFFT();
      const { material: mat, uniforms: uni } = createWaterMaterial({
        fft: this.fft,
        interactive: { heightTex: i.heightTex, foamTex: i.foamTex, origin: i.origin, sizeMeters: i.sizeMeters },
        deepColor: new THREE.Color(0x12402e), shallowColor: new THREE.Color(0x3d6e4f),
      });
      uni.fftFade.value = 0.35;
      (this.surface.material as THREE.Material).dispose();
      this.surface.material = mat;
      old.dispose();
    });
    ctx.gui.add(this.params, 'flowSpeed', 0, 8, 0.1).name('流速 m/s')
      .onChange((v: number) => { this.interactive.setFlow(v, 0); this.params.flowSpeed = v; });
    ctx.gui.add(this.spawnSel, 'kind', { 球: 'ball', 箱: 'box' }).name('投掷类型');
    ctx.gui.add({ 清空: () => this.throwables.clear() }, '清空');
    ctx.gui.add(this.camMode, 'follow').name('跟船视角')
      .onChange((v: boolean) => {
        this.controls.enabled = !v;
        if (!v) this.controls.target.copy(this.boat.position);
      });

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
    const origin = this.ctx.camera.position.clone().addScaledVector(this.raycaster.ray.direction, 2).setY(this.ctx.camera.position.y);
    const dir = hit.clone().sub(origin);
    const flat = Math.hypot(dir.x, dir.z) || 1;
    const speed = 14;
    const vel = new Vector3(
      (dir.x / flat) * speed + (Math.random() - 0.5) * 2,
      4,
      (dir.z / flat) * speed + (Math.random() - 0.5) * 2,
    );
    this.throwables.spawn(e.shiftKey ? 'box' : this.spawnSel.kind, origin, vel);
  };

  update(dt: number, time: number) {
    this.bowSplashCooldown = Math.max(0, this.bowSplashCooldown - dt);
    this.fft.update(this.ctx.renderer, time);
    this.splash.update(this.ctx.renderer, dt);

    // 船只水流拖拽：在 boat.update 前施力，step() 同帧消费
    const flowVx = this.params.flowSpeed;
    const boatFlowK = this.boat.body.mass * 0.3;
    this.boat.body.applyForce(
      this.flowForce.set((flowVx - this.boat.body.velocity.x) * boatFlowK, 0, -this.boat.body.velocity.z * boatFlowK),
    );
    this.boat.update(dt, this.heightFn);

    const bp = this.boat.position;
    this.interactive.follow(bp.x, bp.z);
    this.interactive.update(this.ctx.renderer, dt);

    this.heightField.refresh();
    this.throwables.update(dt, this.heightFn, bp.x, bp.z, { x: flowVx, z: 0 });

    // 每 4s 在上游漂入一个箱子，随水流顺流而下
    this.driftTimer -= dt;
    if (this.driftTimer <= 0) {
      this.driftTimer = 4;
      const ox = this.interactive.origin.value.x;
      const oz = this.interactive.origin.value.y;
      const sx = ox - this.interactive.sizeMeters * 0.45;
      const sz = oz + (Math.random() - 0.5) * (RIVER_HALF_W * 1.2);
      const wh = this.heightFn(sx, sz);
      this.throwables.spawn('box', new Vector3(sx, wh + 0.5, sz), new Vector3(flowVx, 0, 0));
    }

    if (this.camMode.follow) {
      this.boat.group.getWorldDirection(this.camBack);
      this.camBack.y = 0;
      if (this.camBack.lengthSq() > 1e-6) this.camBack.normalize();
      this.camTarget.copy(bp).addScaledVector(this.camBack, 18); this.camTarget.y += 8;
      this.ctx.camera.position.lerp(this.camTarget, 1 - Math.exp(-3 * dt));
      this.ctx.camera.lookAt(bp.x, bp.y, bp.z);
    } else {
      this.controls.update();
    }

    // 水面跟随相机 X 方向（流向），Z 固定为 0（河面宽度有限）
    this.surface.position.x = Math.round(this.ctx.camera.position.x);
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
    this.heightField.dispose();
    this.surfaceGeo.dispose();
    (this.surface.material as THREE.Material).dispose();
    this.bankMat.dispose();
    for (const g of this.bankGeos) g.dispose();
    this.scene.backgroundNode = null;
  }
}
