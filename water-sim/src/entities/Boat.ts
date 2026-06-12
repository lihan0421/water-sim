// src/entities/Boat.ts
// 可驾驶船只：拉长壳体 RigidBody + 多点 Floater，WASD 驱动（W/S 沿艏向推力、A/D 舵转向）。
// 每帧在船首/船尾沿水线注入移动扰动 → 开尔文激波 + 下陷尾迹；高速时回调船首浪花。
import * as THREE from 'three/webgpu';
import { Vector3 } from 'three';
import { RigidBody } from '../physics/RigidBody';
import { Floater } from '../physics/Floater';
import type { HeightFn } from '../physics/Floater';
import type { InteractiveWaves } from '../sim/interactive/InteractiveWaves';

// 单线程顺序调用共享暂存，避免每帧堆分配（house discipline）
const _heading = new Vector3();
const _side = new Vector3();
const _thrust = new Vector3();
const _sideForce = new Vector3();
const _stern = new Vector3();
const _latVel = new Vector3();
const _grav = new Vector3();
const _bow = new Vector3();
const _sternPos = new Vector3();

export class Boat {
  readonly group = new THREE.Group();
  readonly body: RigidBody;
  private floater: Floater;
  private hullMat: THREE.MeshStandardNodeMaterial;
  private deckMat: THREE.MeshStandardNodeMaterial;
  private hullGeo: THREE.BoxGeometry;
  private bowGeo: THREE.CylinderGeometry;
  private cabinGeo: THREE.BoxGeometry;
  private keys = new Set<string>();
  private throttle = 0; private rudder = 0;
  // 同一处理器接 keydown/keyup；keydown 自动重复仅重复加入 Set（幂等），无需额外去重
  private onKey = (e: KeyboardEvent) => {
    if (e.type === 'keydown') this.keys.add(e.code); else this.keys.delete(e.code);
  };

  constructor(scene: THREE.Scene, private waves: InteractiveWaves | null,
              public onBowSplash?: (pos: Vector3, speed: number) => void) {
    // 程序化船体：壳(拉伸盒) + 船头楔(四棱锥) + 舱
    this.hullMat = new THREE.MeshStandardNodeMaterial({ color: 0x7a4f2a, roughness: 0.6 });
    this.deckMat = new THREE.MeshStandardNodeMaterial({ color: 0xae8a5c, roughness: 0.8 });
    this.hullGeo = new THREE.BoxGeometry(2.2, 1.0, 6.0);
    this.bowGeo = new THREE.CylinderGeometry(0, 1.1, 2.0, 4, 1);
    this.cabinGeo = new THREE.BoxGeometry(1.6, 0.9, 2.0);
    const hull = new THREE.Mesh(this.hullGeo, this.hullMat);
    const bow = new THREE.Mesh(this.bowGeo, this.hullMat);
    bow.rotation.set(Math.PI / 2, 0, Math.PI / 4); bow.scale.set(1, 1, 0.9); bow.position.set(0, 0, -4.0);
    const cabin = new THREE.Mesh(this.cabinGeo, this.deckMat);
    cabin.position.set(0, 0.95, 0.8);
    this.group.add(hull, bow, cabin);
    scene.add(this.group);

    this.body = new RigidBody(2200, new Vector3(1.1, 0.5, 3.0)); // ~半载排水
    this.body.position.set(0, 0.2, 0);
    // 浮力点：船底 2×4 栅格
    const pts: Vector3[] = [];
    for (const x of [-0.8, 0.8]) for (const z of [-2.4, -0.8, 0.8, 2.4]) pts.push(new Vector3(x, -0.5, z));
    this.floater = new Floater(this.body, {
      points: pts, crossSectionArea: 2.2 * 6.0 * 0.7, maxDraft: 1.0,
      linearDrag: 1500, angularDrag: 4,
    });
    addEventListener('keydown', this.onKey); addEventListener('keyup', this.onKey);
  }

  /** 跟随相机/锚点用：当前船位（直接返回内部刚体位置，调用方勿改写） */
  get position(): Vector3 { return this.body.position; }

  update(dt: number, waterHeight: HeightFn) {
    // 输入 → 推力/舵；throttle/rudder 一阶平滑避免突变
    const fwd = this.keys.has('KeyW') ? 1 : this.keys.has('KeyS') ? -0.4 : 0;
    const turn = (this.keys.has('KeyA') ? 1 : 0) - (this.keys.has('KeyD') ? 1 : 0);
    this.throttle += (fwd - this.throttle) * Math.min(dt * 2, 1);
    this.rudder += (turn - this.rudder) * Math.min(dt * 4, 1);

    // 艏向（船头 -Z）投影到水平面
    _heading.set(0, 0, -1).applyQuaternion(this.body.quaternion); _heading.y = 0; _heading.normalize();
    _side.set(-_heading.z, 0, _heading.x); // 右舷横向单位向量
    // 船尾作用点（质心→船尾世界偏移，推力施加于此使转向有力矩）
    _stern.copy(_heading).multiplyScalar(-3);
    // 推力 18kN 沿艏向 + 满舵横向分量（∝ 油门，停船时舵无效）
    _thrust.copy(_heading).multiplyScalar(this.throttle * 18000);
    _sideForce.copy(_side).multiplyScalar(this.rudder * this.throttle * 6000);
    this.body.applyForceAtPoint(_thrust.add(_sideForce), _stern);
    // 横向水阻（防侧滑漂移）：抵消速度在右舷方向分量
    _latVel.copy(this.body.velocity).projectOnVector(_side);
    this.body.applyForce(_latVel.multiplyScalar(-3000));

    // 契约：applyForces 须在 step 前；重力本处自加
    this.floater.applyForces(waterHeight, dt);
    this.body.applyForce(_grav.set(0, -9.81 * this.body.mass, 0));
    this.body.step(dt);
    this.group.position.copy(this.body.position);
    this.group.quaternion.copy(this.body.quaternion);

    // —— 船行激波：沿水线注入移动扰动（强度 ∝ 速度，封顶 8m/s）——
    const speed = this.body.velocity.length();
    if (this.waves && speed > 0.5) {
      _bow.copy(this.body.position).addScaledVector(_heading, -4.2);
      _sternPos.copy(this.body.position).addScaledVector(_heading, 3.2);
      const k = Math.min(speed / 8, 1);
      this.waves.addDisturbance(_bow.x, _bow.z, 0.25 * k, 1.6);       // 船首抬升 → 开尔文波
      this.waves.addDisturbance(_sternPos.x, _sternPos.z, -0.30 * k, 2.2); // 船尾下陷 → 尾迹
      if (speed > 4) this.onBowSplash?.(_bow.setY(waterHeight(_bow.x, _bow.z)), speed);
    }
  }

  dispose() {
    removeEventListener('keydown', this.onKey); removeEventListener('keyup', this.onKey);
    this.group.removeFromParent();
    this.hullGeo.dispose(); this.bowGeo.dispose(); this.cabinGeo.dispose();
    this.hullMat.dispose(); this.deckMat.dispose();
  }
}
