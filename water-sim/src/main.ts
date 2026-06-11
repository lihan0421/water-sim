import * as THREE from 'three/webgpu';
import { App } from './core/App';
import type { WaterScene, SceneContext } from './core/WaterScene';

class PlaceholderScene implements WaterScene {
  readonly name = 'placeholder';
  scene = new THREE.Scene();
  private cube = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshNormalMaterial());
  async init(ctx: SceneContext) { this.scene.add(this.cube); ctx.camera.position.set(0, 1, 3); ctx.camera.lookAt(0, 0, 0); }
  update(dt: number) { this.cube.rotation.y += dt; }
  dispose() { this.cube.geometry.dispose(); }
}

async function boot() {
  if (!navigator.gpu) { document.getElementById('unsupported')!.style.display = 'block'; return; }
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  await renderer.init();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);
  const app = new App(renderer, { ocean: () => new PlaceholderScene() });
  await app.switchTo('ocean');
  app.start();
}
boot();
