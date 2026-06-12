import * as THREE from 'three/webgpu';
import {
  Fn, instancedArray, instanceIndex, uniform, uniformArray,
  float, int, vec2, vec4, ivec2, textureStore, If, Loop, clamp,
} from 'three/tsl';

// 交互波动层 GPU 实现（Task 7）。算法与 waveKernel.ts 严格一致（CPU 测试即回归基准）：
// 显式波动方程 next = h + (h-prev)(1-damp) + c²dt²∇²h，边缘按 boundary 处理。
// 在此基础上叠加：扰动注入（点击/船尾迹）、泡沫累积、网格整格吸附跟随。
export interface InteractiveOpts {
  N?: number;             // 网格分辨率，默认 512
  sizeMeters: number;     // 网格覆盖边长
  boundary: 'absorb' | 'reflect';
  waveSpeed?: number;     // m/s，默认 6
  damping?: number;       // 默认 0.015
}

const MAX_DISTURB = 16;

export class InteractiveWaves {
  readonly N: number;
  readonly sizeMeters: number;
  readonly heightTex: THREE.StorageTexture;
  readonly foamTex: THREE.StorageTexture;
  readonly origin = uniform(new THREE.Vector2(0, 0)); // 网格中心世界坐标（满足 WaterMaterial.InteractiveMaps）
  readonly heightBuffers: any[]; // ping-pong instancedArray，三缓冲轮换 prev/curr/next
  private computes: { step: any[]; export: any[] };
  private dPosU: any; private dValU: any; private dCountU = uniform(0, 'int'); // 扰动数量，int 作循环上界
  private c2dt2U = uniform(0.2); private dampU: any;
  private boundaryReflect: number;
  // 扰动暂存（每帧清零）
  private disturbCount = 0;
  // 物理参数
  private waveSpeed: number; private dx: number;
  private ring = 0;

  constructor(o: InteractiveOpts) {
    this.N = o.N ?? 512;
    this.sizeMeters = o.sizeMeters;
    this.dx = o.sizeMeters / this.N;
    this.waveSpeed = o.waveSpeed ?? 6;
    this.dampU = uniform(o.damping ?? 0.015);
    this.boundaryReflect = o.boundary === 'reflect' ? 1 : 0;

    const NN = this.N * this.N;
    const a = instancedArray(NN, 'float'), b = instancedArray(NN, 'float'), c = instancedArray(NN, 'float');
    this.heightBuffers = [a, b, c]; // prev, curr, next 轮换
    const foamBuf = instancedArray(NN, 'float');
    this.heightTex = makeTex(this.N); this.foamTex = makeTex(this.N);
    this.dPosU = uniformArray(Array.from({ length: MAX_DISTURB }, () => new THREE.Vector2()));
    this.dValU = uniformArray(Array.from({ length: MAX_DISTURB }, () => new THREE.Vector2()));

    const Ni = int(this.N);
    const Nm1 = this.N - 1, Nm2 = this.N - 2;
    const reflectB = this.boundaryReflect;
    const dampU = this.dampU, c2dt2U = this.c2dt2U, dCountU = this.dCountU;
    const dPosU = this.dPosU, dValU = this.dValU;

    // 三缓冲轮换：每种角色分配（prev,curr,next）各建一个 step compute。
    const mkStep = (prev: any, curr: any, next: any) => Fn(() => {
      const i = instanceIndex.toInt();
      const x = i.mod(Ni), z = i.div(Ni);
      const edge = x.equal(0).or(x.equal(Nm1)).or(z.equal(0)).or(z.equal(Nm1));
      // 钳制寻址的拉普拉斯采样（边缘格走 edge 分支，不会用到越界 lap）
      const atC = (xx: any, zz: any) =>
        curr.element(clamp(zz, int(0), int(Nm1)).mul(Ni).add(clamp(xx, int(0), int(Nm1))));
      const h = curr.element(i), hp = prev.element(i);
      const lap = atC(x.add(1), z).add(atC(x.sub(1), z)).add(atC(x, z.add(1))).add(atC(x, z.sub(1))).sub(h.mul(4));
      const vel = h.sub(hp).mul(float(1).sub(dampU));
      const out = h.add(vel).add(lap.mul(c2dt2U)).toVar();

      // 扰动注入：半径内二次衰减抬升/压低
      const xf = x.toFloat(), zf = z.toFloat();
      Loop({ start: int(0), end: dCountU, type: 'int', condition: '<' }, ({ i: di }: any) => {
        const dp = dPosU.element(di); // 格坐标
        const dv = dValU.element(di); // x=强度 y=半径(格)
        const dist = vec2(xf.sub(dp.x), zf.sub(dp.y)).length();
        const w = clamp(float(1).sub(dist.div(dv.y)), float(0), float(1));
        out.addAssign(dv.x.mul(w.mul(w)));
      });

      If(edge, () => {
        // reflect：复制内邻（Neumann）；absorb：内邻半值强阻尼吸收
        next.element(i).assign(
          reflectB
            ? atC(clamp(x, int(1), int(Nm2)), clamp(z, int(1), int(Nm2)))
            : h.mul(0.5),
        );
      }).Else(() => { next.element(i).assign(out); });

      // 泡沫：波速度大处注入（封顶），整体缓慢衰减
      const f = foamBuf.element(i);
      f.assign(clamp(f.mul(0.985).add(clamp(vel.abs().mul(6), float(0), float(0.08))), float(0), float(1)));
    })().compute(NN);

    const steps = [mkStep(a, b, c), mkStep(b, c, a), mkStep(c, a, b)];

    // 导出：把「下一步」缓冲（step 写入的 next）写进高度/泡沫纹理供材质采样。
    const mkExport = (next: any) => Fn(() => {
      const i = instanceIndex.toInt();
      const x = i.mod(Ni), z = i.div(Ni);
      textureStore(this.heightTex, ivec2(x, z), vec4(next.element(i), 0, 0, 0));
      textureStore(this.foamTex, ivec2(x, z), vec4(foamBuf.element(i), 0, 0, 0));
    })().compute(NN);
    // ring r 的 step 写 next=heightBuffers[(r+2)%3]，导出同一缓冲
    this.computes = { step: steps, export: [mkExport(c), mkExport(a), mkExport(b)] };
  }

  /** 世界坐标处注入扰动。strength 正=抬升 负=压低（米），radius 米 */
  addDisturbance(worldX: number, worldZ: number, strength: number, radiusMeters: number) {
    if (this.disturbCount >= MAX_DISTURB) return;
    const gx = (worldX - this.origin.value.x) / this.dx + this.N / 2;
    const gz = (worldZ - this.origin.value.y) / this.dx + this.N / 2;
    if (gx < 1 || gx >= this.N - 1 || gz < 1 || gz >= this.N - 1) return;
    const k = this.disturbCount++;
    (this.dPosU as any).array[k].set(gx, gz);
    (this.dValU as any).array[k].set(strength, Math.max(radiusMeters / this.dx, 1.5));
  }

  /** 网格跟随目标（船/相机），整格吸附避免重采样游移；平移出域的旧波形被钳制丢弃 */
  follow(targetX: number, targetZ: number) {
    const sx = Math.round(targetX / this.dx) * this.dx;
    const sz = Math.round(targetZ / this.dx) * this.dx;
    this.origin.value.set(sx, sz);
  }

  update(renderer: THREE.WebGPURenderer, _dt: number) {
    // CFL 稳定性：c²dt²/dx² ≤ 0.4（固定子步 1/60s，留余量于 0.5 临界）
    const c2dt2 = (this.waveSpeed * this.waveSpeed * (1 / 60) ** 2) / (this.dx * this.dx);
    this.c2dt2U.value = Math.min(c2dt2, 0.4);
    this.dCountU.value = this.disturbCount;
    renderer.compute(this.computes.step[this.ring]);
    renderer.compute(this.computes.export[this.ring]);
    this.ring = (this.ring + 1) % 3;
    this.disturbCount = 0; // 扰动一次性消费
  }

  /** 当前高度所在 instancedArray（供 HeightSampler 回读）：step 后刚写入的 next 即最新。
   * update 末尾 ring 已自增，故最新缓冲为 (ring+1)%3。 */
  get currentBuffer() { return this.heightBuffers[(this.ring + 1) % 3]; }

  dispose() {
    // compute 节点显式 dispose，避免场景/GUI 重建时 VRAM 堆积（与 FFTCascade 同纪律）
    for (const s of this.computes.step) s.dispose();
    for (const e of this.computes.export) e.dispose();
    this.heightTex.dispose();
    this.foamTex.dispose();
  }
}

function makeTex(N: number): THREE.StorageTexture {
  const t = new THREE.StorageTexture(N, N);
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; // 交互网格非平铺，越界钳到边缘
  t.generateMipmaps = false;
  return t;
}
