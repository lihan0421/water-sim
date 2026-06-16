// src/entities/Throwables.ts
// 可投掷物体管理：球/箱各带 RigidBody + Floater + mesh。点击在相机处生成、朝点击方向抛出，
// 入水瞬间向交互层注入凹陷扰动（强度 ∝ 垂直速度）并回调浪花。
// 数量上限 MAX_ITEMS、超出回收最旧（几何/材质共享，逐次新建刚体，非严格对象池）。
import * as THREE from 'three/webgpu';
import { Vector3 } from 'three';
import { RigidBody } from '../physics/RigidBody';
import { Floater } from '../physics/Floater';
import type { HeightFn } from '../physics/Floater';
import type { InteractiveWaves } from '../sim/interactive/InteractiveWaves';

interface Item { mesh: THREE.Mesh; body: RigidBody; floater: Floater; wasAirborne: boolean }
const MAX_ITEMS = 24;        // 数量上限：超出则回收最旧
const CULL_RADIUS = 400;     // 距锚点（相机目标）超此距离（米）自动回收，防漂远累积
const CULL_DEPTH = 50;       // 沉到水下此深度（米）也回收
const BALL_R = 0.35;         // 球半径；箱半边长同值（全尺寸 0.7）
const _g = new Vector3();    // 重力暂存，避免每物体每帧分配
const _fFlow = new Vector3(); // 水流拖拽力暂存

export class Throwables {
  private items: Item[] = [];
  private ballGeo = new THREE.SphereGeometry(BALL_R, 24, 16);
  private boxGeo = new THREE.BoxGeometry(BALL_R * 2, BALL_R * 2, BALL_R * 2);
  private ballMat = new THREE.MeshStandardNodeMaterial({ color: 0xd84a3a, roughness: 0.4 });
  private boxMat = new THREE.MeshStandardNodeMaterial({ color: 0xc9a063, roughness: 0.8 });

  constructor(private scene: THREE.Scene, private waves: InteractiveWaves | null,
              public onSplash?: (pos: Vector3, speed: number) => void) {}

  spawn(kind: 'ball' | 'box', pos: Vector3, vel: Vector3) {
    if (this.items.length >= MAX_ITEMS) this.remove(this.items[0]);
    const isBall = kind === 'ball';
    const half = new Vector3(BALL_R, BALL_R, BALL_R);
    const density = isBall ? 400 : 600; // kg/m³，均小于水(1000)故都能浮
    const volume = isBall ? (4 / 3) * Math.PI * BALL_R ** 3 : (BALL_R * 2) ** 3;
    const body = new RigidBody(density * volume, half);
    body.position.copy(pos); body.velocity.copy(vel);
    const pts = isBall
      ? [new Vector3(0, -0.3, 0), new Vector3(0.2, -0.15, 0), new Vector3(-0.2, -0.15, 0), new Vector3(0, -0.15, 0.2), new Vector3(0, -0.15, -0.2)]
      : [-0.3, 0.3].flatMap((x) => [-0.3, 0.3].map((z) => new Vector3(x, -BALL_R, z)));
    const floater = new Floater(body, {
      points: pts,
      crossSectionArea: isBall ? Math.PI * BALL_R ** 2 : (BALL_R * 2) ** 2,
      maxDraft: BALL_R * 2, linearDrag: body.mass * 1.2, angularDrag: 1.5,
    });
    const mesh = new THREE.Mesh(isBall ? this.ballGeo : this.boxGeo, isBall ? this.ballMat : this.boxMat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    this.items.push({ mesh, body, floater, wasAirborne: true });
  }

  private remove(it: Item) {
    const idx = this.items.indexOf(it);
    if (idx >= 0) this.items.splice(idx, 1);
    this.scene.remove(it.mesh);
  }

  /** anchorX/Z：回收判距锚点；flow：水平流速；bounds：槽体墙面/底部反弹约束（水槽场景用） */
  update(dt: number, waterHeight: HeightFn, anchorX = 0, anchorZ = 0,
         flow?: { x: number; z: number },
         bounds?: { minX: number; maxX: number; minZ: number; maxZ: number; floorY: number }) {
    // 逆序遍历，便于在循环内安全回收
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      // 契约：applyForces 须在 step 前调用；重力由本处自加
      it.floater.applyForces(waterHeight, dt);
      it.body.applyForce(_g.set(0, -9.81 * it.body.mass, 0));
      // 水流拖拽（河流场景）：须在 step 前施加，否则 step 清空 forceAcc 后力在下帧才生效（1 帧滞后）
      if (flow) {
        const whPre = waterHeight(it.body.position.x, it.body.position.z);
        if (it.body.position.y - 0.2 < whPre) {
          const dk = it.body.mass * 0.8;
          it.body.applyForce(_fFlow.set(
            (flow.x - it.body.velocity.x) * dk,
            0,
            (flow.z - it.body.velocity.z) * dk,
          ));
        }
      }
      it.body.step(dt);
      // 入水检测 → 扰动 + 浪花回调（仅在由空中转入水、且有明显下落速度时触发一次）
      const wh = waterHeight(it.body.position.x, it.body.position.z);
      const inWater = it.body.position.y - 0.2 < wh; // 0.2 ≈ 物体没入过半（半径 0.35）才算入水
      if (inWater && it.wasAirborne && it.body.velocity.y < -1) {
        const impact = Math.min(-it.body.velocity.y * 0.12, 1.2); // 凹陷强度随入水垂直速度，封顶 1.2m
        this.waves?.addDisturbance(it.body.position.x, it.body.position.z, -impact, 1.2);
        this.onSplash?.(it.body.position.clone().setY(wh), -it.body.velocity.y);
      }
      // 墙面/底部反弹（水槽场景）：越界后位置钳制 + 速度反向衰减
      if (bounds) {
        const p = it.body.position, v = it.body.velocity;
        if (p.x < bounds.minX) { p.x = bounds.minX; v.x = Math.abs(v.x) * 0.5; }
        if (p.x > bounds.maxX) { p.x = bounds.maxX; v.x = -Math.abs(v.x) * 0.5; }
        if (p.z < bounds.minZ) { p.z = bounds.minZ; v.z = Math.abs(v.z) * 0.5; }
        if (p.z > bounds.maxZ) { p.z = bounds.maxZ; v.z = -Math.abs(v.z) * 0.5; }
        if (p.y < bounds.floorY) { p.y = bounds.floorY; v.y = Math.abs(v.y) * 0.5; }
      }
      it.wasAirborne = !inWater;
      it.mesh.position.copy(it.body.position);
      it.mesh.quaternion.copy(it.body.quaternion);
      // 漂远/沉底回收
      const p = it.body.position;
      if (Math.hypot(p.x - anchorX, p.z - anchorZ) > CULL_RADIUS || p.y < wh - CULL_DEPTH) this.remove(it);
    }
  }

  clear() { for (const it of this.items) this.scene.remove(it.mesh); this.items = []; }

  dispose() {
    this.clear();
    this.ballGeo.dispose(); this.boxGeo.dispose();
    this.ballMat.dispose(); this.boxMat.dispose();
  }
}
