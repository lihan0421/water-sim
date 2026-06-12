// tests/heightSampler.test.ts
import { describe, it, expect } from 'vitest';
import { bilinearSample, worldToGrid } from '../src/physics/HeightSampler';

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
