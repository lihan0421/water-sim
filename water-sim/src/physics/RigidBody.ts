// src/physics/RigidBody.ts
// 半隐式欧拉刚体积分：盒惯量张量，力/力矩累加，线速度+角速度阻尼。
import { Vector3, Quaternion, Matrix3 } from 'three';

/** 盒近似惯量的半隐式欧拉刚体 */
export class RigidBody {
  position = new Vector3();
  quaternion = new Quaternion();
  velocity = new Vector3();
  angularVelocity = new Vector3();
  private forceAcc = new Vector3();
  private torqueAcc = new Vector3();
  private invInertia = new Matrix3();

  constructor(public mass: number, halfExtents: Vector3) {
    // 盒惯量 I = m/12 · (b²+c², a²+c², a²+b²)，a,b,c 为全尺寸
    const a = halfExtents.x * 2, b = halfExtents.y * 2, c = halfExtents.z * 2;
    const ix = (mass / 12) * (b * b + c * c);
    const iy = (mass / 12) * (a * a + c * c);
    const iz = (mass / 12) * (a * a + b * b);
    this.invInertia.set(1 / ix, 0, 0, 0, 1 / iy, 0, 0, 0, 1 / iz);
  }

  applyForce(f: Vector3) { this.forceAcc.add(f); }

  /** worldOffset: 作用点相对质心的世界系偏移 */
  applyForceAtPoint(f: Vector3, worldOffset: Vector3) {
    this.forceAcc.add(f);
    // τ = r × F
    this.torqueAcc.add(new Vector3().crossVectors(worldOffset, f));
  }

  step(dt: number) {
    // 线性积分：半隐式欧拉（先更新速度再更新位置）
    this.velocity.addScaledVector(this.forceAcc, dt / this.mass);
    this.position.addScaledVector(this.velocity, dt);
    // 角积分：用体坐标惯量近似世界惯量（小角速度场景误差可接受）
    const angAcc = this.torqueAcc.clone().applyMatrix3(this.invInertia);
    this.angularVelocity.addScaledVector(angAcc, dt);
    // 四元数积分：dq/dt = 0.5 * ω_quat * q
    const w = this.angularVelocity;
    const dq = new Quaternion(w.x * dt / 2, w.y * dt / 2, w.z * dt / 2, 0).multiply(this.quaternion);
    this.quaternion.set(
      this.quaternion.x + dq.x,
      this.quaternion.y + dq.y,
      this.quaternion.z + dq.z,
      this.quaternion.w + dq.w,
    ).normalize();
    // 力/力矩清零
    this.forceAcc.set(0, 0, 0);
    this.torqueAcc.set(0, 0, 0);
  }
}
