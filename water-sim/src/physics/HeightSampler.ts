// src/physics/HeightSampler.ts
// GPU 高度回读 + CPU 双线性采样，供浮力物理使用。
// FFT 高度缓冲布局：arr[z*N+x] = 经 (-1)^(x+z) 置换后的最终空间高度（与 displacementTex.y 相同）。
// 交互层高度缓冲：同布局但非平铺，网格覆盖区域外返回 0。

import * as THREE from 'three/webgpu';

/**
 * CPU 双线性采样。arr 布局：arr[z*N+x]，x/z 为连续浮点网格坐标（允许越界，钳到边缘）。
 * 与 GPU 侧 textureSample(RepeatWrapping/ClampToEdge) 不同：此函数不处理 wrap，
 * wrap 语义由上层（WaterHeightField）在调用前完成坐标折叠。
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

/** 网格映射描述：世界坐标 → 连续网格坐标（原点居中） */
export interface GridMapping {
  originX: number;   // 网格中心世界 X 坐标
  originZ: number;   // 网格中心世界 Z 坐标
  sizeMeters: number; // 网格覆盖边长（米）
  N: number;         // 网格分辨率（格数）
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

  constructor(
    private renderer: THREE.WebGPURenderer,
    /** instancedArray TSL 节点（heightBuffer / currentBuffer），调用 .value 取 StorageBufferAttribute */
    private bufferNode: any,
    readonly N: number,
  ) {
    this.data = new Float32Array(N * N);
  }

  /** 每帧调用一次；fire-and-forget，不阻塞 */
  refresh() {
    if (this.inFlight) return;
    this.inFlight = true;
    // three WebGPU: renderer.getArrayBufferAsync(StorageBufferAttribute) → ArrayBuffer
    // bufferNode.value 是底层 StorageBufferAttribute
    (this.renderer as any).getArrayBufferAsync(this.bufferNode.value)
      .then((ab: ArrayBuffer) => { this.data = new Float32Array(ab); })
      .catch(() => { /* 回读失败：保留上帧数据，浮力退化为平水计算 */ })
      .finally(() => { this.inFlight = false; });
  }

  /** 按世界坐标采样高度（使用当前 CPU 镜像） */
  sampleWorld(wx: number, wz: number, m: GridMapping): number {
    const g = worldToGrid(wx, wz, m);
    return bilinearSample(this.data, this.N, g.x, g.z);
  }
}

/**
 * 组合采样器：叠加 FFT 级联高度（平铺 RepeatWrapping）+ 交互层高度（钳制，越界返回 0）。
 * FFT 级联高度缓冲已存储经 (-1)^(x+z) 置换后的最终空间高度，与 GPU 顶点着色器采样值一致。
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
      if (l.tiling) {
        // FFT 平铺：世界坐标 mod domainSize，折叠到 [0, N) 网格坐标
        const wrap = (v: number, s: number) => ((v % s) + s) % s;
        const gx = (wrap(wx, m.sizeMeters) / m.sizeMeters) * m.N;
        const gz = (wrap(wz, m.sizeMeters) / m.sizeMeters) * m.N;
        h += bilinearSample(l.mirror.data, l.mirror.N, gx, gz);
      } else {
        // 交互层：越界则跳过（贡献 0，不加浮力）
        const g = worldToGrid(wx, wz, m);
        if (g.x < 0 || g.x > m.N - 1 || g.z < 0 || g.z > m.N - 1) continue;
        h += bilinearSample(l.mirror.data, l.mirror.N, g.x, g.z);
      }
    }
    return h;
  }

  /** 每帧调用：向 GPU 发起所有层的异步回读请求 */
  refresh() {
    for (const l of this.layers) l.mirror.refresh();
  }
}
