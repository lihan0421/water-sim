// src/physics/RigidBody.ts
// 半隐式欧拉刚体积分：盒惯量张量，力/力矩累加，线速度+角速度阻尼。
import { Vector3, Quaternion, Matrix3 } from 'three';

// 物理为单线程顺序调用，共享暂存变量避免每步堆分配（与 three 内部惯例一致）
const _v = new Vector3();
const _dq = new Quaternion();
const _qInv = new Quaternion();

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
    if (mass <= 0 || halfExtents.x <= 0 || halfExtents.y <= 0 || halfExtents.z <= 0) {
      throw new Error('RigidBody: mass and halfExtents must be positive');
    }
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
    this.torqueAcc.add(_v.crossVectors(worldOffset, f));
  }

  step(dt: number) {
    // 线性积分：半隐式欧拉（先更新速度再更新位置）
    this.velocity.addScaledVector(this.forceAcc, dt / this.mass);
    this.position.addScaledVector(this.velocity, dt);
    // 角积分：I⁻¹_world = R·I⁻¹_body·Rᵀ —— 世界力矩先转体坐标过惯量再转回，
    // 否则非立方体（如船）转向后力矩响应随朝向出错（长短轴惯量差数倍）
    _qInv.copy(this.quaternion).invert();
    const angAcc = _v.copy(this.torqueAcc)
      .applyQuaternion(_qInv).applyMatrix3(this.invInertia).applyQuaternion(this.quaternion);
    this.angularVelocity.addScaledVector(angAcc, dt);
    // 四元数积分：dq/dt = 0.5 * ω_quat * q
    const w = this.angularVelocity;
    _dq.set(w.x * dt / 2, w.y * dt / 2, w.z * dt / 2, 0).multiply(this.quaternion);
    this.quaternion.set(
      this.quaternion.x + _dq.x,
      this.quaternion.y + _dq.y,
      this.quaternion.z + _dq.z,
      this.quaternion.w + _dq.w,
    ).normalize();
    // 力/力矩清零
    this.forceAcc.set(0, 0, 0);
    this.torqueAcc.set(0, 0, 0);
  }
}
