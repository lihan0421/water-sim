// src/entities/Throwables.ts
// 可投掷物体管理：球/箱各带 RigidBody + Floater + mesh。点击在相机处生成、朝点击方向抛出，
// 入水瞬间向交互层注入凹陷扰动（强度 ∝ 垂直速度）并回调浪花。对象池上限 MAX_ITEMS，超出回收最旧。
import * as THREE from 'three/webgpu';
import { Vector3 } from 'three';
import { RigidBody } from '../physics/RigidBody';
import { Floater } from '../physics/Floater';
import type { HeightFn } from '../physics/Floater';
import type { InteractiveWaves } from '../sim/interactive/InteractiveWaves';

interface Item { mesh: THREE.Mesh; body: RigidBody; floater: Floater; wasAirborne: boolean }
const MAX_ITEMS = 24;        // 对象池上限：超出则回收最旧
const CULL_RADIUS = 400;     // 距原点超此距离（米）的物体自动回收，防漂远累积
const CULL_DEPTH = 50;       // 沉到水下此深度（米）也回收

export class Throwables {
  private items: Item[] = [];
  private ballGeo = new THREE.SphereGeometry(0.35, 24, 16);
  private boxGeo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  private ballMat = new THREE.MeshStandardNodeMaterial({ color: 0xd84a3a, roughness: 0.4 });
  private boxMat = new THREE.MeshStandardNodeMaterial({ color: 0xc9a063, roughness: 0.8 });

  constructor(private scene: THREE.Scene, private waves: InteractiveWaves | null,
              public onSplash?: (pos: Vector3, speed: number) => void) {}

  spawn(kind: 'ball' | 'box', pos: Vector3, vel: Vector3) {
    if (this.items.length >= MAX_ITEMS) this.remove(this.items[0]);
    const isBall = kind === 'ball';
    const half = new Vector3(0.35, 0.35, 0.35);
    const density = isBall ? 400 : 600; // kg/m³，均小于水(1000)故都能浮
    const volume = isBall ? (4 / 3) * Math.PI * 0.35 ** 3 : 0.7 ** 3;
    const body = new RigidBody(density * volume, half);
    body.position.copy(pos); body.velocity.copy(vel);
    const pts = isBall
      ? [new Vector3(0, -0.3, 0), new Vector3(0.2, -0.15, 0), new Vector3(-0.2, -0.15, 0), new Vector3(0, -0.15, 0.2), new Vector3(0, -0.15, -0.2)]
      : [-0.3, 0.3].flatMap((x) => [-0.3, 0.3].map((z) => new Vector3(x, -0.35, z)));
    const floater = new Floater(body, {
      points: pts,
      crossSectionArea: isBall ? Math.PI * 0.35 ** 2 : 0.49,
      maxDraft: 0.7, linearDrag: body.mass * 1.2, angularDrag: 1.5,
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

  update(dt: number, waterHeight: HeightFn) {
    // 逆序遍历，便于在循环内安全回收
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      // 契约：applyForces 须在 step 前调用；重力由本处自加
      it.floater.applyForces(waterHeight, dt);
      it.body.applyForce(new Vector3(0, -9.81 * it.body.mass, 0));
      it.body.step(dt);
      // 入水检测 → 扰动 + 浪花回调（仅在由空中转入水、且有明显下落速度时触发一次）
      const wh = waterHeight(it.body.position.x, it.body.position.z);
      const inWater = it.body.position.y - 0.2 < wh;
      if (inWater && it.wasAirborne && it.body.velocity.y < -1) {
        const impact = Math.min(-it.body.velocity.y * 0.12, 1.2); // 凹陷强度随入水垂直速度，封顶 1.2m
        this.waves?.addDisturbance(it.body.position.x, it.body.position.z, -impact, 1.2);
        this.onSplash?.(it.body.position.clone().setY(wh), -it.body.velocity.y);
      }
      it.wasAirborne = !inWater;
      it.mesh.position.copy(it.body.position);
      it.mesh.quaternion.copy(it.body.quaternion);
      // 漂远/沉底回收
      const p = it.body.position;
      if (Math.hypot(p.x, p.z) > CULL_RADIUS || p.y < wh - CULL_DEPTH) this.remove(it);
    }
  }

  clear() { for (const it of this.items) this.scene.remove(it.mesh); this.items = []; }

  dispose() {
    this.clear();
    this.ballGeo.dispose(); this.boxGeo.dispose();
    this.ballMat.dispose(); this.boxMat.dispose();
  }
}
