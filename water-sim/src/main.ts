import * as THREE from 'three/webgpu';
import { texture } from 'three/tsl';
import { App } from './core/App';
import type { WaterScene, SceneContext } from './core/WaterScene';
import { FFTWaves } from './sim/fft/FFTWaves';

class PlaceholderScene implements WaterScene {
  readonly name = 'placeholder';
  scene = new THREE.Scene();
  private cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
  async init(ctx: SceneContext) { this.scene.add(this.cube); ctx.camera.position.set(0, 1, 3); ctx.camera.lookAt(0, 0, 0); }
  update(dt: number) { this.cube.rotation.y += dt; }
  dispose() { this.cube.geometry.dispose(); (this.cube.material as THREE.Material).dispose(); }
}

/**
 * 调试场景（?debug=fft）：跑 FFTWaves，用一张平面显示 cascade[0] 位移纹理，
 * colorNode = displacement·0.05 + 0.5 把位移映射到可见色域。人工浏览器验收用。
 */
class FFTDebugScene implements WaterScene {
  readonly name = 'fft-debug';
  scene = new THREE.Scene();
  private waves = new FFTWaves(256, { windSpeed: 10, windDirection: 0.5, fetch: 1e5, amplitudeScale: 1 });
  private renderer!: THREE.WebGPURenderer;
  private plane!: THREE.Mesh;
  private mat!: THREE.MeshBasicNodeMaterial;

  async init(ctx: SceneContext) {
    this.renderer = ctx.renderer;
    this.mat = new THREE.MeshBasicNodeMaterial();
    this.mat.colorNode = texture(this.waves.cascades[0].displacementTex).mul(0.05).add(0.5);
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.scene.add(this.plane);
    ctx.camera.position.set(0, 0, 3);
    ctx.camera.lookAt(0, 0, 0);
  }

  update(_dt: number, time: number) {
    this.waves.update(this.renderer, time);
  }

  dispose() {
    this.waves.dispose();
    this.plane.geometry.dispose();
    this.mat.dispose();
  }
}

async function boot() {
  if (!navigator.gpu) { document.getElementById('unsupported')!.style.display = 'block'; return; }
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  const debugFft = new URLSearchParams(location.search).get('debug') === 'fft';
  const factories: Record<string, () => WaterScene> = { ocean: () => new PlaceholderScene() };
  if (debugFft) factories['fft-debug'] = () => new FFTDebugScene();
  const app = new App(renderer, factories);
  await app.switchTo(debugFft ? 'fft-debug' : 'ocean');
  app.start();
}
boot();
