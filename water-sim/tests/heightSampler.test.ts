// tests/heightSampler.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { bilinearSample, bilinearSampleWrap, worldToGrid, WaterHeightField } from '../src/physics/HeightSampler';
import type { GpuHeightMirror, GridMapping } from '../src/physics/HeightSampler';

describe('bilinearSample', () => {
  // 2×2 网格：[0,1; 2,3]，布局 arr[z*N+x]
  const arr = new Float32Array([0, 1, 2, 3]);

  it('整点取值精确', () => {
    expect(bilinearSample(arr, 2, 0, 0)).toBe(0);
    expect(bilinearSample(arr, 2, 1, 0)).toBe(1);
    expect(bilinearSample(arr, 2, 0, 1)).toBe(2);
    expect(bilinearSample(arr, 2, 1, 1)).toBe(3);
  });

  it('中心插值 = 平均', () => {
    // (0+1+2+3)/4 = 1.5
    expect(bilinearSample(arr, 2, 0.5, 0.5)).toBeCloseTo(1.5);
  });

  it('x 方向中点（z=0）= 0.5', () => {
    // arr[0*2+0]=0, arr[0*2+1]=1 → 中点 0.5
    expect(bilinearSample(arr, 2, 0.5, 0)).toBeCloseTo(0.5);
  });

  it('越界 clamp 到边缘', () => {
    expect(bilinearSample(arr, 2, -5, 0)).toBe(0);   // x<0 → x=0
    expect(bilinearSample(arr, 2, 5, 5)).toBe(3);    // 右下角
    expect(bilinearSample(arr, 2, 5, 0)).toBe(1);    // x 越界 → x=1
    expect(bilinearSample(arr, 2, 0, 5)).toBe(2);    // z 越界 → z=1
  });

  it('4×4 网格内部双线性值', () => {
    // 4×4 均匀线性斜面：arr[z*4+x] = x + z
    const a4 = new Float32Array(16);
    for (let z = 0; z < 4; z++) for (let x = 0; x < 4; x++) a4[z * 4 + x] = x + z;
    // 在 (1.5, 1.5) 处 = (1+1.5) + (1+0.5)·0 …实际双线性 = 1.5+1.5 = 3
    expect(bilinearSample(a4, 4, 1.5, 1.5)).toBeCloseTo(3.0);
    expect(bilinearSample(a4, 4, 0.5, 0.5)).toBeCloseTo(1.0);
  });
});

describe('bilinearSampleWrap', () => {
  // 4×4 网格，常值 = index，arr[z*4+x] = z*4+x
  const N = 4;
  const arr4 = new Float32Array(16);
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) arr4[z * N + x] = z * N + x;

  it('整点取值精确（内部）', () => {
    expect(bilinearSampleWrap(arr4, N, 1, 2)).toBeCloseTo(arr4[2 * N + 1]); // z=2,x=1 → 9
    expect(bilinearSampleWrap(arr4, N, 0, 0)).toBeCloseTo(arr4[0]);
    expect(bilinearSampleWrap(arr4, N, 3, 3)).toBeCloseTo(arr4[3 * N + 3]);
  });

  it('接缝插值：x=N-0.5 在 texel N-1 和 texel 0 之间（wrap）', () => {
    // N=4, x=3.5（offset by texel-center: 实际连续坐标 3.5）
    // x0=3, x1=(3+1)%4=0 → wrap seam
    // 简单行：arr[0*4+x]: 0,1,2,3
    const row = new Float32Array([10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40]);
    // z=0 整行，x=3.5 → 插值 texel3(40) 和 texel0(10) 各 0.5 → 25
    expect(bilinearSampleWrap(row, N, 3.5, 0)).toBeCloseTo(25);
  });

  it('接缝插值：z=N-0.5 在 texel N-1 和 texel 0 之间（wrap）', () => {
    // 每列 z 方向：arr[z*4+0] = z*4 → 0,4,8,12
    // z=3.5 → 插值 texel-z=3(12) 和 texel-z=0(0) 各 0.5 → 6
    const col = new Float32Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    for (let z = 0; z < N; z++) col[z * N + 0] = z * 4;
    expect(bilinearSampleWrap(col, N, 0, 3.5)).toBeCloseTo(6);
  });

  it('整点偏移验证：世界坐标在 texel-i 中心处精确还原值', () => {
    // texel-i 中心对应连续坐标 i（不含 0.5 偏移；0.5 偏移已在 height() 中减去后传入）
    // 对每个整数坐标，bilinearSampleWrap 应精确返回对应格值
    for (let z = 0; z < N; z++) {
      for (let x = 0; x < N; x++) {
        expect(bilinearSampleWrap(arr4, N, x, z)).toBeCloseTo(arr4[z * N + x], 5);
      }
    }
  });

  it('负坐标正确 wrap（-0.5 = N-0.5）', () => {
    // x=-0.5 应与 x=N-0.5 等价（接缝另一侧）
    const row = new Float32Array([10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40, 10, 20, 30, 40]);
    // x=-0.5 → x0=floor(-0.5)=-1 → wraps to N-1=3, x1=(-1+1)%N=0
    // fx = -0.5 - (-1) = 0.5 → lerp(40, 10, 0.5) = 25
    expect(bilinearSampleWrap(row, N, -0.5, 0)).toBeCloseTo(25);
  });
});

describe('worldToGrid', () => {
  it('原点居中映射', () => {
    // 网格 256 格覆盖 100m，中心 (10, 20)
    const g = worldToGrid(10, 20, { originX: 10, originZ: 20, sizeMeters: 100, N: 256 });
    expect(g.x).toBeCloseTo(127.5); // (N-1)/2 居中
    expect(g.z).toBeCloseTo(127.5);
  });

  it('边缘世界坐标映射到网格边界', () => {
    // 覆盖 100m，N=100，中心 (0, 0)，左边缘 wx = -50 → 格坐标 0 附近
    const m = { originX: 0, originZ: 0, sizeMeters: 100, N: 100 };
    const left = worldToGrid(-50, 0, m);
    expect(left.x).toBeCloseTo(-0.5); // 恰好到左端（允许略超出 grid）
    const right = worldToGrid(50, 0, m);
    expect(right.x).toBeCloseTo(99.5);
  });

  it('偏移中心后坐标正确', () => {
    const m = { originX: 5, originZ: -3, sizeMeters: 200, N: 128 };
    // wx = 5 (中心) → 格坐标 = (N-1)/2 = 63.5
    const g = worldToGrid(5, -3, m);
    expect(g.x).toBeCloseTo(63.5);
    expect(g.z).toBeCloseTo(63.5);
  });
});

// ---- Fake-mirror helpers ----
/** Cast a plain {data, N} as GpuHeightMirror for unit-testing WaterHeightField */
function fakeMirror(data: Float32Array, N: number): GpuHeightMirror {
  return { data, N } as unknown as GpuHeightMirror;
}

describe('WaterHeightField.height() — fake mirrors', () => {
  // 4×4 grid, domain 4 m covering [0,4)×[0,4), tiling layer
  const N = 4;
  const size = 4; // sizeMeters = 4 matches N so texels are 1 m apart

  // Build a tiling layer with known values
  // arr[z*N+x] = (z*N+x) as a unique fingerprint
  function makeArr(n: number, fill: (z: number, x: number) => number): Float32Array {
    const a = new Float32Array(n * n);
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) a[z * n + x] = fill(z, x);
    return a;
  }

  it('(a) multi-layer summation: two tiling layers add up', () => {
    // Layer 1: all 1.0; Layer 2: all 2.0 → height = 3.0 everywhere
    const m1 = fakeMirror(new Float32Array(N * N).fill(1), N);
    const m2 = fakeMirror(new Float32Array(N * N).fill(2), N);
    const mapping = (): GridMapping => ({ originX: 0, originZ: 0, sizeMeters: size, N });
    const field = new WaterHeightField([
      { mirror: m1, mapping, tiling: true },
      { mirror: m2, mapping, tiling: true },
    ]);
    expect(field.height(0, 0)).toBeCloseTo(3.0);
    expect(field.height(1.5, 2.7)).toBeCloseTo(3.0);
  });

  it('(b) negative world coords wrap correctly on tiling layer', () => {
    // Layer: linear ramp arr[z*N+x] = x  (rows are identical)
    // World x=-1 should wrap to world x=size-1=3, texel coord = (3/4)*4 - 0.5 = 2.5
    const arr = makeArr(N, (_z, x) => x);
    const m = fakeMirror(arr, N);
    const mapping = (): GridMapping => ({ originX: 0, originZ: 0, sizeMeters: size, N });
    const field = new WaterHeightField([{ mirror: m, mapping, tiling: true }]);
    // wx=-1 → wrap to 3 m → gx=(3/4)*4-0.5=2.5 → bilinearWrap between texel2(2) and texel3(3) → 2.5
    expect(field.height(-1, 0)).toBeCloseTo(2.5, 4);
    // wx=0 → gx=(0/4)*4-0.5=-0.5 → bilinearWrap(-0.5): x0=-1→3, x1=0, fx=0.5 → (3+0)/2=1.5
    expect(field.height(0, 0)).toBeCloseTo(1.5, 4);
  });

  it('(c) interactive layer returns 0 contribution outside grid', () => {
    const arr = makeArr(N, () => 5); // all 5s
    const m = fakeMirror(arr, N);
    // Grid centered at (0,0), 4 m wide → outside is |wx| or |wz| > 2
    const mapping = (): GridMapping => ({ originX: 0, originZ: 0, sizeMeters: size, N });
    const field = new WaterHeightField([{ mirror: m, mapping, tiling: false }]);
    expect(field.height(100, 0)).toBe(0);   // far outside
    expect(field.height(-100, 0)).toBe(0);  // far outside
    expect(field.height(0, 100)).toBe(0);   // far outside
  });

  it('(d) interactive layer offset origin sampling', () => {
    // Grid centered at (10, 20), 4 m wide, N=4
    // arr: all values 7.0 except center slightly higher
    const arr = makeArr(N, () => 7);
    const m = fakeMirror(arr, N);
    const mapping = (): GridMapping => ({ originX: 10, originZ: 20, sizeMeters: size, N });
    const field = new WaterHeightField([{ mirror: m, mapping, tiling: false }]);
    // Querying the center of the grid → should return 7
    expect(field.height(10, 20)).toBeCloseTo(7);
    // Just outside: origin ± 3 m → outside [origin ± 2 m] boundary
    expect(field.height(10 + 3, 20)).toBe(0);
    expect(field.height(10, 20 - 3)).toBe(0);
  });
});
