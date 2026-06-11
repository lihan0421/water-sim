import { describe, it, expect } from 'vitest';
import { jonswap, peakOmega, generateInitialSpectrum } from '../src/sim/fft/spectrum';

describe('jonswap', () => {
  const U = 10, F = 100_000; // 风速 m/s，风区 m
  it('峰值频率附近能量最大', () => {
    const wp = peakOmega(U, F);
    const sPeak = jonswap(wp, U, F);
    expect(sPeak).toBeGreaterThan(jonswap(wp * 0.7, U, F));
    expect(sPeak).toBeGreaterThan(jonswap(wp * 1.5, U, F));
  });
  it('能量非负且 ω→0 趋于 0', () => {
    expect(jonswap(0.01, U, F)).toBeGreaterThanOrEqual(0);
    expect(jonswap(0.01, U, F)).toBeLessThan(jonswap(peakOmega(U, F), U, F) * 1e-3);
  });
});

describe('generateInitialSpectrum', () => {
  it('输出尺寸正确且 k=0 处为零（无直流分量）', () => {
    const N = 16, L = 100;
    const { h0 } = generateInitialSpectrum(N, L, { windSpeed: 10, windDirection: 0, fetch: 1e5, amplitudeScale: 1 }, () => 0.5);
    expect(h0.length).toBe(N * N * 4);
    // k=0 位于 (N/2, N/2)（k 以中心对称排布）
    const idx = ((N / 2) * N + N / 2) * 4;
    expect(h0[idx]).toBe(0); expect(h0[idx + 1]).toBe(0);
  });
  it('逆风方向能量远小于顺风', () => {
    const N = 32, L = 200;
    const { h0 } = generateInitialSpectrum(N, L, { windSpeed: 12, windDirection: 0, fetch: 1e5, amplitudeScale: 1 }, () => 0.5);
    // 顺风 +kx 与逆风 -kx 同距离点比较振幅
    const at = (ix: number, iz: number) => { const i = (iz * N + ix) * 4; return Math.hypot(h0[i], h0[i + 1]); };
    expect(at(N / 2 + 6, N / 2)).toBeGreaterThan(at(N / 2 - 6, N / 2) * 3);
  });
});
