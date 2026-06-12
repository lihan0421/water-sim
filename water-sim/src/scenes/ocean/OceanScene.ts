import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { positionWorldDirection } from 'three/tsl';
import type { WaterScene, SceneContext } from '../../core/WaterScene';
import { FFTWaves } from '../../sim/fft/FFTWaves';
import { createOceanGeometry } from './surfaceGeometry';
import { createWaterMaterial } from './WaterMaterial';
import { skyColor } from './skyNode';

/**
 * 第一个可见的大海：FFT 海浪 + 位移水面 + 程序化天空 + OrbitControls。
 * GUI 改风速/风向/浪高需重建 FFTWaves（频谱是构造时烘焙的），choppy 可热改。
 */
export class OceanScene implements WaterScene {
  readonly name = 'ocean';
  scene = new THREE.Scene();
  private ctx!: SceneContext;
  private fft!: FFTWaves;
  private controls!: OrbitControls;
  private surface!: THREE.Mesh;
  private skirt!: THREE.Mesh;
  private cellSize = 1; // 内层网格格距，由 createOceanGeometry 提供，相机吸附按此对齐
  private params = { windSpeed: 10, windDirection: 30, amplitudeScale: 1, choppiness: 1.2 };

  private static readonly FFT_N = 256;

  private createFFT() {
    const fft = new FFTWaves(OceanScene.FFT_N, this.spectrumParams());
    fft.choppyU.value = this.params.choppiness;
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
    const { material } = createWaterMaterial({ fft: this.fft });
    return material;
  }

  async init(ctx: SceneContext) {
    this.ctx = ctx;
    this.scene.backgroundNode = skyColor(positionWorldDirection);

    this.fft = this.createFFT();

    const { inner, outer, cellSize } = createOceanGeometry();
    this.cellSize = cellSize;
    const material = this.buildMaterial();
    this.surface = new THREE.Mesh(inner, material);
    this.skirt = new THREE.Mesh(outer, material);
    this.skirt.position.y = -0.01; // 略低于内层，避免 z-fighting
    this.scene.add(this.surface, this.skirt);

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
    };
    ctx.gui.add(this.params, 'windSpeed', 2, 25, 0.5).name('风速 m/s').onFinishChange(rebuild);
    ctx.gui.add(this.params, 'windDirection', 0, 360, 1).name('风向°').onFinishChange(rebuild);
    ctx.gui.add(this.params, 'amplitudeScale', 0.2, 2.5, 0.05).name('浪高').onFinishChange(rebuild);
    ctx.gui.add(this.params, 'choppiness', 0, 2.5, 0.05).name('尖锐度')
      .onChange((v: number) => { this.fft.choppyU.value = v; });
  }

  update(_dt: number, time: number) {
    this.fft.update(this.ctx.renderer, time);
    this.controls.update();
    // 海面网格按单元吸附跟随相机，使无限海面无游移感
    const snap = this.cellSize;
    this.surface.position.x = Math.round(this.ctx.camera.position.x / snap) * snap;
    this.surface.position.z = Math.round(this.ctx.camera.position.z / snap) * snap;
  }

  dispose() {
    this.controls.dispose();
    this.fft.dispose();
    this.surface.geometry.dispose();
    this.skirt.geometry.dispose();
    (this.surface.material as THREE.Material).dispose();
    this.scene.backgroundNode = null;
  }
}
