import { describe, it, expect } from 'vitest';
import { waveStep, type WaveParams } from '../src/sim/interactive/waveKernel';

const P: WaveParams = { c2dt2: 0.2, damping: 0.004, boundary: 'absorb', flowX: 0, flowZ: 0, dt: 1 / 60 };

function makeGrids(N: number) {
  return { prev: new Float32Array(N * N), curr: new Float32Array(N * N), next: new Float32Array(N * N) };
}

describe('waveStep', () => {
  it('中心脉冲产生四向对称波形', () => {
    const N = 33, g = makeGrids(N);
    g.curr[16 * N + 16] = 1; g.prev[16 * N + 16] = 1;
    for (let s = 0; s < 20; s++) {
      waveStep(g.prev, g.curr, g.next, N, P);
      [g.prev, g.curr, g.next] = [g.curr, g.next, g.prev];
    }
    const h = (x: number, z: number) => g.curr[z * N + x];
    expect(h(16 + 8, 16)).toBeCloseTo(h(16 - 8, 16), 5);
    expect(h(16, 16 + 8)).toBeCloseTo(h(16 + 8, 16), 5);
  });
  it('能量随时间衰减不发散', () => {
    const N = 33, g = makeGrids(N);
    g.curr[16 * N + 16] = 1;
    const energy = () => g.curr.reduce((a, v) => a + v * v, 0);
    for (let s = 0; s < 60; s++) { waveStep(g.prev, g.curr, g.next, N, P); [g.prev, g.curr, g.next] = [g.curr, g.next, g.prev]; }
    const e60 = energy();
    for (let s = 0; s < 240; s++) { waveStep(g.prev, g.curr, g.next, N, P); [g.prev, g.curr, g.next] = [g.curr, g.next, g.prev]; }
    expect(energy()).toBeLessThan(e60);
    expect(Number.isFinite(energy())).toBe(true);
  });
  it('reflect 边界：靠墙脉冲反射回来同号', () => {
    const N = 65, g = makeGrids(N);
    const P2 = { ...P, boundary: 'reflect' as const };
    g.curr[32 * N + 3] = 1; g.prev[32 * N + 3] = 1;
    let maxAt6 = -1;
    for (let s = 0; s < 80; s++) {
      waveStep(g.prev, g.curr, g.next, N, P2);
      [g.prev, g.curr, g.next] = [g.curr, g.next, g.prev];
      if (s > 20) maxAt6 = Math.max(maxAt6, g.curr[32 * N + 6]);
    }
    expect(maxAt6).toBeGreaterThan(0.01); // 反射波回到 x=6
  });
  it('CFL 稳定：c2dt2 在临界 0.5 以下不发散', () => {
    const N = 49, g = makeGrids(N);
    const P3 = { ...P, c2dt2: 0.49, damping: 0 };
    g.curr[24 * N + 24] = 1; g.prev[24 * N + 24] = 1;
    for (let s = 0; s < 300; s++) {
      waveStep(g.prev, g.curr, g.next, N, P3);
      [g.prev, g.curr, g.next] = [g.curr, g.next, g.prev];
    }
    const e = g.curr.reduce((a, v) => a + v * v, 0);
    expect(Number.isFinite(e)).toBe(true);
    expect(e).toBeLessThan(1e6); // 临界稳定，不指数爆炸
  });
  it('absorb 边界：边缘格被钳到内邻的半值（强阻尼吸收）', () => {
    const N = 17, g = makeGrids(N);
    // 给 x=0 边缘格一个已知值，下一步 absorb 应输出 curr*0.5
    g.curr[8 * N + 0] = 0.4;
    waveStep(g.prev, g.curr, g.next, N, P);
    expect(g.next[8 * N + 0]).toBeCloseTo(0.2, 6); // curr*0.5
  });
  it('平流：flowX>0 时脉冲质心沿 +x 漂移', () => {
    const N = 65;
    const Pf: WaveParams = { c2dt2: 0.05, damping: 0.02, boundary: 'absorb', flowX: 30, flowZ: 0, dt: 1 / 60 };
    const g = makeGrids(N);
    // 高斯包初始化，避免单点平流的双线性各向异性主导
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const r2 = (x - 32) ** 2 + (z - 32) ** 2;
      const v = Math.exp(-r2 / 8);
      g.curr[z * N + x] = v; g.prev[z * N + x] = v;
    }
    const centroidX = () => {
      let m = 0, mx = 0;
      for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
        const w = g.curr[z * N + x] ** 2; m += w; mx += w * x;
      }
      return mx / m;
    };
    const c0 = centroidX();
    for (let s = 0; s < 40; s++) {
      waveStep(g.prev, g.curr, g.next, N, Pf);
      [g.prev, g.curr, g.next] = [g.curr, g.next, g.prev];
    }
    expect(centroidX()).toBeGreaterThan(c0 + 0.5); // 质心被平流推向 +x
  });
});
