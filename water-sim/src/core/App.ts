import * as THREE from 'three/webgpu';
import GUI from 'lil-gui';
import type { WaterScene, SceneContext } from './WaterScene';

export class App {
  private renderer: THREE.WebGPURenderer;
  private camera: THREE.PerspectiveCamera;
  private gui = new GUI({ title: 'Water Sim' });
  private sceneGui!: GUI;
  private current: WaterScene | null = null;
  private factories: Record<string, () => WaterScene>;
  private clock = new THREE.Clock();
  private fpsEl: HTMLDivElement;

  constructor(renderer: THREE.WebGPURenderer, factories: Record<string, () => WaterScene>) {
    this.renderer = renderer;
    this.factories = factories;
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    });
    this.fpsEl = document.createElement('div');
    this.fpsEl.style.cssText = 'position:fixed;left:8px;top:8px;color:#0f0;font:12px monospace;z-index:9';
    document.body.appendChild(this.fpsEl);
    const names = Object.keys(factories);
    const state = { scene: names[0] };
    this.gui.add(state, 'scene', names).name('场景').onChange((n: string) => this.switchTo(n));
  }

  async switchTo(name: string) {
    this.current?.dispose();
    this.sceneGui?.destroy();
    this.sceneGui = this.gui.addFolder(name);
    this.current = this.factories[name]();
    const ctx: SceneContext = { renderer: this.renderer, camera: this.camera, gui: this.sceneGui, domElement: this.renderer.domElement };
    await this.current.init(ctx);
  }

  start() {
    let acc = 0, frames = 0;
    this.renderer.setAnimationLoop(() => {
      const dt = Math.min(this.clock.getDelta(), 1 / 20); // 防卡顿大步长
      acc += dt; frames++;
      if (acc > 0.5) { this.fpsEl.textContent = `${Math.round(frames / acc)} fps`; acc = 0; frames = 0; }
      if (this.current) {
        this.current.update(dt, this.clock.elapsedTime);
        this.renderer.render(this.current.scene, this.camera);
      }
    });
  }
}
