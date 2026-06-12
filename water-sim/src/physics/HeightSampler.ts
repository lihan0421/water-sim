// src/physics/HeightSampler.ts
// GPU 高度回读 + CPU 双线性采样，供浮力物理使用。
// FFT 高度缓冲布局：arr[z*N+x] = 经 (-1)^(x+z) 置换后的最终空间高度（与 displacementTex.y 相同）。
// 交互层高度缓冲：同布局但非平铺，网格覆盖区域外返回 0。
// 注意：CPU 回读仅反映垂直高度位移；FFT choppy 水平偏移在 GPU 顶点着色器中才体现，
// 浮力计算用垂直高度近似，与 GPU 视觉结果存在水平重映射差异。

import * as THREE from 'three/webgpu';

/** 模块级 wrap 辅助函数：将 v 折叠到 [0, s) */
const wrapMod = (v: number, s: number): number => ((v % s) + s) % s;

/**
 * CPU 双线性采样（ClampToEdge 语义）。arr 布局：arr[z*N+x]，x/z 为连续浮点网格坐标（允许越界，钳到边缘）。
 * 用于交互层（非平铺），越界坐标由上层判断处理。
 */
export function bilinearSample(arr: Float32Array, N: number, x: number, z: number): number {
  // 钳到 [0, N-1]：等价于 ClampToEdge 边界
  const cx = Math.min(Math.max(x, 0), N - 1);
  const cz = Math.min(Math.max(z, 0), N - 1);
  const x0 = Math.floor(cx), z0 = Math.floor(cz);
  const x1 = Math.min(x0 + 1, N - 1), z1 = Math.min(z0 + 1, N - 1);
  const fx = cx - x0, fz = cz - z0;
  return (
    arr[z0 * N + x0] * (1 - fx) * (1 - fz) +
    arr[z0 * N + x1] * fx * (1 - fz) +
    arr[z1 * N + x0] * (1 - fx) * fz +
    arr[z1 * N + x1] * fx * fz
  );
}

/**
 * CPU 双线性采样（RepeatWrapping 语义）。用于 FFT 平铺层。
 * x/z 为连续浮点网格坐标（已减去 0.5 texel-center 偏移）；越界坐标通过 wrap 折叠。
 * 匹配 GPU 侧 texture(tex, uv) with RepeatWrapping + LinearFilter。
 */
export function bilinearSampleWrap(arr: Float32Array, N: number, x: number, z: number): number {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const x1 = ((x0 + 1) % N + N) % N;
  const z1 = ((z0 + 1) % N + N) % N;
  const wx0 = ((x0 % N) + N) % N;
  const wz0 = ((z0 % N) + N) % N;
  const fx = x - x0;
  const fz = z - z0;
  return (
    arr[wz0 * N + wx0] * (1 - fx) * (1 - fz) +
    arr[wz0 * N + x1]  * fx * (1 - fz) +
    arr[z1  * N + wx0] * (1 - fx) * fz +
    arr[z1  * N + x1]  * fx * fz
  );
}

/** 网格映射描述：世界坐标 → 连续网格坐标（原点居中） */
export interface GridMapping {
  originX: number;   // 网格中心世界 X 坐标
  originZ: number;   // 网格中心世界 Z 坐标
  sizeMeters: number; // 网格覆盖边长（米）
  /** 参考分辨率，用于 worldToGrid 换算。高度采样时始终以 mirror.N 为准，此字段可选。 */
  N: number;
}

/**
 * 世界坐标 → 连续网格坐标。原点居中：(originX, originZ) 映射到 (N-1)/2。
 * 注意：返回值可能超出 [0, N-1]，越界判断由调用方处理。
 */
export function worldToGrid(wx: number, wz: number, m: GridMapping): { x: number; z: number } {
  const half = (m.N - 1) / 2; // 中心格坐标（整数分辨率居中）
  return {
    x: ((wx - m.originX) / m.sizeMeters) * m.N + half,
    z: ((wz - m.originZ) / m.sizeMeters) * m.N + half,
  };
}

/**
 * GPU float 缓冲的 CPU 镜像。异步回读，1 帧延迟。
 * 回读失败时保留上帧数据（失败保底：平水为 0，浮力计算仍可正常运行）。
 * 每帧调用 refresh()，fire-and-forget，不阻塞渲染循环。
 */
export class GpuHeightMirror {
  /** CPU 侧最新高度数据（可能落后 1 帧） */
  data: Float32Array;
  private inFlight = false;
  private warnedOnce = false;

  constructor(
    private renderer: THREE.WebGPURenderer,
    /**
     * 返回 instancedArray TSL 节点的提供函数（调用 .value 取 StorageBufferAttribute）。
     * 使用函数而非直接节点，是为了支持交互层三缓冲环形轮换：每次 refresh() 调用时
     * 取最新 currentBuffer，而不是构造时固定的某个缓冲。
     * 静态 FFT heightBuffer 直接传 () => cascade.heightBuffer 即可。
     */
    private bufferNode: () => any,
    readonly N: number,
  ) {
    this.data = new Float32Array(N * N);
  }

  /** 每帧调用一次；fire-and-forget，不阻塞 */
  refresh() {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      const node = this.bufferNode();
      const ab_promise: Promise<ArrayBuffer> = (this.renderer as any).getArrayBufferAsync(node.value);
      ab_promise
        .then((ab: ArrayBuffer) => {
          const expected = this.N * this.N * 4;
          if (ab.byteLength !== expected) {
            if (!this.warnedOnce) {
              console.warn(
                `[GpuHeightMirror] byteLength mismatch: got ${ab.byteLength}, expected ${expected}. Keeping last data.`,
              );
              this.warnedOnce = true;
            }
            return;
          }
          this.data = new Float32Array(ab);
        })
        .catch(() => {
          if (!this.warnedOnce) {
            console.warn('[GpuHeightMirror] getArrayBufferAsync failed; keeping last data (silent thereafter).');
            this.warnedOnce = true;
          }
          // 回读失败：保留上帧数据，浮力退化为平水计算
        })
        .finally(() => { this.inFlight = false; });
    } catch (e) {
      // 同步抛出（如 getArrayBufferAsync 不存在）：释放 inFlight，warn-once
      this.inFlight = false;
      if (!this.warnedOnce) {
        console.warn('[GpuHeightMirror] refresh() threw synchronously; keeping last data (silent thereafter).', e);
        this.warnedOnce = true;
      }
    }
  }

  /** 按世界坐标采样高度（使用当前 CPU 镜像） */
  sampleWorld(wx: number, wz: number, m: GridMapping): number {
    const g = worldToGrid(wx, wz, m);
    return bilinearSample(this.data, this.N, g.x, g.z);
  }
}

/**
 * 组合采样器：叠加 FFT 级联高度（平铺 RepeatWrapping）+ 交互层高度（钳制，越界返回 0）。
 * FFT 级联高度缓冲已存储经 (-1)^(x+z) 置换后的最终空间高度。
 * 注意：CPU 采样仅含垂直位移，与 GPU 顶点着色器的 choppy 水平重映射存在差异，属预期偏差。
 * 仅回读 cascade0 + cascade1（大/中尺度主导浮力），cascade2（15m 细波）忽略以节省带宽。
 */
export class WaterHeightField {
  constructor(
    private layers: Array<{
      mirror: GpuHeightMirror;
      mapping: () => GridMapping;
      /** true = FFT 平铺（RepeatWrapping），false = 交互层钳制（ClampToEdge，越界 skip） */
      tiling: boolean;
    }>,
  ) {}

  /** 查询世界坐标 (wx, wz) 处的水面高度（米） */
  height(wx: number, wz: number): number {
    let h = 0;
    for (const l of this.layers) {
      const m = l.mapping();
      // 分辨率始终取 mirror 的实际缓冲大小，不依赖 mapping.N
      const N = l.mirror.N;
      if (l.tiling) {
        // FFT 平铺：匹配 GPU texture(tex, wp.xz/domainSize) with RepeatWrapping+LinearFilter
        // GPU texel-i 中心对应 uv=(i+0.5)/N，即连续 texel 坐标 = frac*N - 0.5
        const gx = (wrapMod(wx, m.sizeMeters) / m.sizeMeters) * N - 0.5;
        const gz = (wrapMod(wz, m.sizeMeters) / m.sizeMeters) * N - 0.5;
        h += bilinearSampleWrap(l.mirror.data, N, gx, gz);
      } else {
        // 交互层：越界则跳过（贡献 0，不加浮力）
        const g = worldToGrid(wx, wz, m);
        if (g.x < 0 || g.x > N - 1 || g.z < 0 || g.z > N - 1) continue;
        h += bilinearSample(l.mirror.data, N, g.x, g.z);
      }
    }
    return h;
  }

  /** 每帧调用：向 GPU 发起所有层的异步回读请求 */
  refresh() {
    for (const l of this.layers) l.mirror.refresh();
  }
}
