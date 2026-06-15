import * as THREE from 'three/webgpu';
import { Vector3 } from 'three';
import {
  Fn, instancedArray, instanceIndex, uniform, float, vec3, vec4, If, hash,
} from 'three/tsl';

const COUNT = 8192;

export class SplashParticles {
  readonly points: THREE.Points;
  private positions = instancedArray(COUNT, 'vec3');
  private velocities = instancedArray(COUNT, 'vec3');
  private life = instancedArray(COUNT, 'float'); // ≤0 表示死亡
  private updateCompute: any;
  private emitCompute: any;
  private dtU = uniform(0);
  private emitPosU = uniform(new THREE.Vector3());
  private emitSpeedU = uniform(0);
  private emitSeedU = uniform(0);
  // int 型 uniform 避免 float 精度在大下标处产生截断误差
  private emitStartU = uniform(0, 'int');
  private emitCountU = uniform(0, 'int');
  private cursor = 0;

  constructor(scene: THREE.Scene) {
    this.updateCompute = Fn(() => {
      const p = this.positions.element(instanceIndex);
      const v = this.velocities.element(instanceIndex);
      const l = this.life.element(instanceIndex);
      If(l.greaterThan(0), () => {
        v.y.subAssign(float(9.81).mul(this.dtU));
        p.addAssign(v.mul(this.dtU));
        l.subAssign(this.dtU);
      });
    })().compute(COUNT);

    this.emitCompute = Fn(() => {
      const absIdx = instanceIndex.toInt();
      const active = absIdx.greaterThanEqual(this.emitStartU)
        .and(absIdx.lessThan(this.emitStartU.add(this.emitCountU)));
      If(active, () => {
        const p = this.positions.element(instanceIndex);
        const v = this.velocities.element(instanceIndex);
        const l = this.life.element(instanceIndex);
        const seed = instanceIndex.toFloat().add(this.emitSeedU);
        const ang = hash(seed).mul(Math.PI * 2);
        const r = hash(seed.add(7)).mul(0.6);
        p.assign(vec3(
          this.emitPosU.x.add(ang.cos().mul(r)),
          this.emitPosU.y.add(0.1),
          this.emitPosU.z.add(ang.sin().mul(r)),
        ));
        const up = this.emitSpeedU.mul(0.35).add(hash(seed.add(13)).mul(1.5));
        v.assign(vec3(
          ang.cos().mul(hash(seed.add(3)).mul(2)),
          up,
          ang.sin().mul(hash(seed.add(5)).mul(2)),
        ));
        l.assign(hash(seed.add(11)).mul(0.6).add(0.5));
      });
    })().compute(COUNT);

    const mat = new THREE.PointsNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.positionNode = this.positions.element(instanceIndex) as any;
    mat.sizeNode = this.life.element(instanceIndex).max(0).mul(6).add(2) as any;
    mat.colorNode = vec4(0.9, 0.95, 1.0, this.life.element(instanceIndex).max(0).mul(0.8)) as any;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(COUNT * 3), 3));
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /** speed 越大喷溅越多越高；pos 由调用方确保是独立副本（非共享暂存） */
  burst(renderer: THREE.WebGPURenderer, pos: Vector3, speed: number) {
    const n = Math.min(Math.floor(speed * 18), 320);
    if (n <= 0) return;
    this.emitPosU.value.copy(pos);
    this.emitSpeedU.value = speed;
    this.emitSeedU.value = Math.random() * 1000;
    this.emitStartU.value = this.cursor;
    this.emitCountU.value = n;
    // % (COUNT-400) 保证 cursor+n 始终 < COUNT，emit range 不越界
    this.cursor = (this.cursor + n) % (COUNT - 400);
    renderer.compute(this.emitCompute);
  }

  update(renderer: THREE.WebGPURenderer, dt: number) {
    this.dtU.value = dt;
    renderer.compute(this.updateCompute);
  }

  dispose() {
    this.updateCompute.dispose();
    this.emitCompute.dispose();
    this.positions.dispose();
    this.velocities.dispose();
    this.life.dispose();
    const geo = this.points.geometry;
    const mat = this.points.material as THREE.Material;
    this.points.removeFromParent();
    geo.dispose();
    mat.dispose();
  }
}
