import * as THREE from 'three/webgpu';
import GUI from 'lil-gui';
import type { WaterScene, SceneContext } from './WaterScene';

export class App {
  private renderer: THREE.WebGPURenderer;
  private camera: THREE.PerspectiveCamera;
  private gui = new GUI({ title: 'Water Sim' });
  private sceneGui: GUI | undefined;
  private current: WaterScene | null = null;
  private factories: Record<string, () => WaterScene>;
  private clock = new THREE.Clock();
  private fpsEl: HTMLDivElement;
  private switching = false;
  private readonly onResize: () => void;

  constructor(renderer: THREE.WebGPURenderer, factories: Record<string, () => WaterScene>) {
    this.renderer = renderer;
    this.factories = factories;
    this.camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 4000);
    this.onResize = () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      renderer.setSize(innerWidth, innerHeight);
    };
    addEventListener('resize', this.onResize);
    this.fpsEl = document.createElement('div');
    this.fpsEl.style.cssText = 'position:fixed;left:8px;top:8px;color:#0f0;font:12px monospace;z-index:9';
    document.body.appendChild(this.fpsEl);
    const names = Object.keys(factories);
    const state = { scene: names[0] };
    this.gui.add(state, 'scene', names).name('场景').onChange((n: string) => this.switchTo(n));
  }

  async switchTo(name: string) {
    if (!this.factories[name]) return;
    if (this.switching) return;
    this.switching = true;
    try {
      this.current?.dispose();
      this.current = null;
      this.sceneGui?.destroy();
      this.sceneGui = this.gui.addFolder(name);
      const next = this.factories[name]();
      const ctx: SceneContext = { renderer: this.renderer, camera: this.camera, gui: this.sceneGui, domElement: this.renderer.domElement };
      await next.init(ctx);
      this.current = next;
    } finally {
      this.switching = false;
    }
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

  dispose() {
    removeEventListener('resize', this.onResize);
    this.fpsEl.remove();
    this.current?.dispose();
    this.gui.destroy();
  }
}
