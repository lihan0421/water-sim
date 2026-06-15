import * as THREE from 'three/webgpu';
import {
  Fn, instancedArray, instanceIndex, uniform, uniformArray,
  float, int, vec2, vec4, ivec2, textureStore, If, Loop, clamp,
} from 'three/tsl';

// 交互波动层 GPU 实现（Task 7）。波动方程部分与 waveKernel.ts 一致（CPU 测试即回归基准）：
// 显式波动方程 next = h + (h-prev)(1-damp) + c²dt²∇²h，边缘按 boundary 处理。
// 在此基础上叠加（无 CPU 覆盖）：扰动注入（点击/船尾迹）、泡沫累积、网格整格吸附跟随；
// 平流项：半拉格朗日平流，flow=0 时退化为直接元素访问（海洋/水槽兼容）。
export interface InteractiveOpts {
  N?: number;             // 网格分辨率，默认 512
  sizeMeters: number;     // 网格覆盖边长
  boundary: 'absorb' | 'reflect';
  waveSpeed?: number;     // m/s，默认 6
  damping?: number;       // 默认 0.015
}

const MAX_DISTURB = 16;
const FOAM_DECAY = 0.985;     // 每子步泡沫保留率
const FOAM_VEL_GAIN = 6;      // |波速度|→泡沫注入增益
const FOAM_MAX_INJECT = 0.08; // 单子步泡沫注入上限
const STEP = 1 / 60;          // 固定物理子步（秒），波速不随帧率变化
const MAX_SUBSTEPS = 4;       // 单帧子步上限，防卡顿后追帧雪崩

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
  private flowU = uniform(new THREE.Vector2(0, 0)); // 水平流速（m/s），供半拉格朗日平流
  private boundaryReflect: number;
  // 扰动暂存：先存世界坐标，update 时（follow 更新 origin 之后）再换算格坐标，避免用过期 origin
  private pending = Array.from({ length: MAX_DISTURB }, () => ({ x: 0, z: 0, strength: 0, radius: 0 }));
  private pendingCount = 0;
  // 物理参数
  private waveSpeed: number; private dx: number;
  private ring = 0;
  private acc = 0; // 子步时间累加器

  constructor(o: InteractiveOpts) {
    this.N = o.N ?? 512;
    this.sizeMeters = o.sizeMeters;
    this.dx = o.sizeMeters / this.N;
    this.waveSpeed = o.waveSpeed ?? 6;
    this.dampU = uniform(o.damping ?? 0.015);
    this.boundaryReflect = o.boundary === 'reflect' ? 1 : 0;
    // CFL 稳定性：c²dt²/dx² ≤ 0.4（固定子步下为常量，留余量于 0.5 临界）
    this.c2dt2U.value = Math.min((this.waveSpeed * this.waveSpeed * STEP * STEP) / (this.dx * this.dx), 0.4);

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
    const flowU = this.flowU;
    const flowScale = STEP / this.dx; // 固定子步/格距，JS 预算；shader 只乘流速 uniform

    // 三缓冲轮换：prev/curr/next 三角色各建一个 step compute。
    const mkStep = (prev: any, curr: any, next: any) => Fn(() => {
      const i = instanceIndex.toInt();
      const x = i.mod(Ni), z = i.div(Ni);
      const edge = x.equal(0).or(x.equal(Nm1)).or(z.equal(0)).or(z.equal(Nm1));
      const xf = x.toFloat(), zf = z.toFloat();

      // 半拉格朗日反追踪：flow=0 → back=(xf,zf) → floor 整数 frac=0 → bilinear = direct access
      const back = vec2(xf.sub(flowU.x.mul(flowScale)), zf.sub(flowU.y.mul(flowScale)));
      const x0 = back.x.floor(), z0 = back.y.floor();
      const fx = back.x.fract(), fz = back.y.fract();
      const g = (buf: any, xx: any, zz: any) =>
        buf.element(clamp(zz, float(0), float(Nm1)).toInt().mul(Ni).add(clamp(xx, float(0), float(Nm1)).toInt()));
      const bil = (buf: any) =>
        g(buf, x0, z0).mul(fx.oneMinus()).mul(fz.oneMinus())
        .add(g(buf, x0.add(1), z0).mul(fx).mul(fz.oneMinus()))
        .add(g(buf, x0, z0.add(1)).mul(fx.oneMinus()).mul(fz))
        .add(g(buf, x0.add(1), z0.add(1)).mul(fx).mul(fz));

      // 拉普拉斯邻格：直接取当前 curr（非平流），与平流中心项形成 Eulerian 空间差分
      const atC = (xx: any, zz: any) =>
        curr.element(clamp(zz, int(0), int(Nm1)).mul(Ni).add(clamp(xx, int(0), int(Nm1))));
      const h = bil(curr), hp = bil(prev);
      const lap = atC(x.add(1), z).add(atC(x.sub(1), z)).add(atC(x, z.add(1))).add(atC(x, z.sub(1))).sub(h.mul(4));
      const vel = h.sub(hp).mul(float(1).sub(dampU));
      const out = h.add(vel).add(lap.mul(c2dt2U)).toVar();

      // 扰动注入：半径内二次衰减
      Loop({ start: int(0), end: dCountU, type: 'int', condition: '<' }, ({ i: di }: any) => {
        const dp = dPosU.element(di);
        const dv = dValU.element(di);
        const dist = vec2(xf.sub(dp.x), zf.sub(dp.y)).length();
        const w = clamp(float(1).sub(dist.div(dv.y)), float(0), float(1));
        out.addAssign(dv.x.mul(w.mul(w)));
      });

      If(edge, () => {
        next.element(i).assign(
          reflectB
            ? atC(clamp(x, int(1), int(Nm2)), clamp(z, int(1), int(Nm2)))
            : h.mul(0.5),
        );
      }).Else(() => { next.element(i).assign(out); });

      const f = foamBuf.element(i);
      f.assign(clamp(f.mul(FOAM_DECAY).add(clamp(vel.abs().mul(FOAM_VEL_GAIN), float(0), float(FOAM_MAX_INJECT))), float(0), float(1)));
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

  /** 世界坐标处注入扰动。strength 正=抬升 负=压低（米），radius 米。
   * 丢弃条件：单帧超过 MAX_DISTURB 条直接丢弃；落在网格边界外的在 update 换算时丢弃。 */
  addDisturbance(worldX: number, worldZ: number, strength: number, radiusMeters: number) {
    if (this.pendingCount >= MAX_DISTURB) return;
    const p = this.pending[this.pendingCount++];
    p.x = worldX; p.z = worldZ; p.strength = strength; p.radius = radiusMeters;
  }

  /** 设置水平流速（m/s）。河流场景用；flow=(0,0) 时等价于无流（默认）。 */
  setFlow(vx: number, vz: number) { this.flowU.value.set(vx, vz); }

  /** 网格跟随目标，整格吸附避免重采样游移。
   * 注意：缓冲内容不随 origin 滚动搬运，已有波形会随网格整体平移——
   * 跟随点须选缓变锚（OrbitControls.target / 船位），勿用旋转中的相机位置。 */
  follow(targetX: number, targetZ: number) {
    const sx = Math.round(targetX / this.dx) * this.dx;
    const sz = Math.round(targetZ / this.dx) * this.dx;
    this.origin.value.set(sx, sz);
  }

  update(renderer: THREE.WebGPURenderer, dt: number) {
    // 按真实 dt 累积、固定 1/60s 子步推进：帧率高低不改变波速与泡沫衰减节奏
    this.acc += dt;
    let steps = Math.floor(this.acc / STEP);
    if (steps > MAX_SUBSTEPS) { steps = MAX_SUBSTEPS; this.acc = 0; }
    else this.acc -= steps * STEP;
    if (steps === 0) return; // 扰动保留到下一帧消费

    // 此刻 origin 已由 follow 更新，再换算扰动格坐标；仅注入第一子步
    let n = 0;
    for (let k = 0; k < this.pendingCount; k++) {
      const p = this.pending[k];
      const gx = (p.x - this.origin.value.x) / this.dx + (this.N - 1) / 2;
      const gz = (p.z - this.origin.value.y) / this.dx + (this.N - 1) / 2;
      if (gx < 1 || gx >= this.N - 1 || gz < 1 || gz >= this.N - 1) continue;
      (this.dPosU as any).array[n].set(gx, gz);
      (this.dValU as any).array[n].set(p.strength, Math.max(p.radius / this.dx, 1.5));
      n++;
    }
    this.pendingCount = 0;
    this.dCountU.value = n;

    for (let s = 0; s < steps; s++) {
      renderer.compute(this.computes.step[this.ring]);
      this.ring = (this.ring + 1) % 3;
      this.dCountU.value = 0; // 每次 renderer.compute 单独提交，子步间改 uniform 安全
    }
    // 导出最后一子步写入的缓冲（其 step 的 ring 序号为当前 ring-1）
    renderer.compute(this.computes.export[(this.ring + 2) % 3]);
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
