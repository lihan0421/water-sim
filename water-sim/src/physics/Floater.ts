// src/physics/Floater.ts
// 多点浮力采样组件：体坐标采样点转换到世界系，按浸没深度柱积分浮力 F = ρgAd（钳制到 maxDraft）。
// 水速基础阻尼：浸水时施加线性阻力 + 角速度指数衰减。
import { Vector3 } from 'three';
import type { RigidBody } from './RigidBody';

// 水密度 kg/m³，重力加速度 m/s²
const RHO = 1000, G = 9.81;

// 单线程顺序调用共享暂存，避免每点堆分配（受力即时被 RigidBody 累加，可安全复用）
const _wp = new Vector3();
const _f = new Vector3();

export interface FloaterOpts {
  points: Vector3[];        // 体坐标采样点（通常布在底面）
  crossSectionArea: number; // 水线总截面积 m²（所有点均分）
  maxDraft: number;         // 浸没深度饱和值（整体没入后浮力不再增加）
  linearDrag: number;       // 线阻尼系数 N·s/m
  angularDrag: number;      // 角阻尼系数 N·m·s
}

/** waterHeight(wx, wz) → 水面高度（m） */
export type HeightFn = (wx: number, wz: number) => number;

export class Floater {
  constructor(private body: RigidBody, private o: FloaterOpts) {}

  /** 按当前水面高度施加浮力+阻尼到刚体。
   * 调用契约：每帧须在 body.step() 之前调用（角阻尼直接修改 angularVelocity），
   * 之后由调用方自行加重力并 step。 */
  applyForces(waterHeight: HeightFn, dt: number) {
    // 每采样点均分水线面积
    const perArea = this.o.crossSectionArea / this.o.points.length;
    let submerged = 0;

    for (const p of this.o.points) {
      // 将体坐标采样点旋转+平移到世界系
      const wp = _wp.copy(p).applyQuaternion(this.body.quaternion).add(this.body.position);
      const wh = waterHeight(wp.x, wp.z);
      const depth = wh - wp.y; // 正值 = 浸没深度
      if (depth <= 0) continue;
      submerged++;
      // 浮力 F = ρ·g·A·depth，深度钳制到 maxDraft 防过饱和
      const d = Math.min(depth, this.o.maxDraft);
      _f.set(0, RHO * G * perArea * d, 0);
      // 力作用于采样点（世界系偏移 = wp - body.position）
      this.body.applyForceAtPoint(_f, wp.sub(this.body.position));
    }

    if (submerged > 0) {
      // 线性阻力按浸没点比例缩放，避免出入水瞬间阻力跳变
      const frac = submerged / this.o.points.length;
      this.body.applyForce(_f.copy(this.body.velocity).multiplyScalar(-this.o.linearDrag * frac));
      // 角阻尼：精确指数衰减，帧率无关且永不反转
      this.body.angularVelocity.multiplyScalar(Math.exp(-this.o.angularDrag * frac * dt));
    }
  }
}
