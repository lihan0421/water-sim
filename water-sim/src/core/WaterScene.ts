import * as THREE from 'three/webgpu';
import type GUI from 'lil-gui';

export interface SceneContext {
  renderer: THREE.WebGPURenderer;
  camera: THREE.PerspectiveCamera;
  gui: GUI;            // 场景专属文件夹，切换场景时整体销毁重建
  domElement: HTMLElement;
}

export interface WaterScene {
  readonly name: string;
  init(ctx: SceneContext): Promise<void>;
  update(dt: number, time: number): void;   // 每帧：物理 + compute 调度
  readonly scene: THREE.Scene;              // 渲染用
  dispose(): void;                          // 释放 GPU 资源、移除事件监听
}
