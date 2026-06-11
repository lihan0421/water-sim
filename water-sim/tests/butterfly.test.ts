import { describe, it, expect } from 'vitest';
import { bitReverse, createButterflyData, ifft1DWithButterfly } from '../src/sim/fft/butterfly';

/** 直接逆 DFT 参考：x[n] = Σ X[k]·e^{+2πi kn/N}（不除 N，与 GPU 实现一致） */
function directIdft(re: Float32Array, im: Float32Array): { re: Float32Array; im: Float32Array } {
  const N = re.length;
  const or_ = new Float32Array(N), oi = new Float32Array(N);
  for (let n = 0; n < N; n++) {
    for (let k = 0; k < N; k++) {
      const ph = (2 * Math.PI * k * n) / N;
      or_[n] += re[k] * Math.cos(ph) - im[k] * Math.sin(ph);
      oi[n] += re[k] * Math.sin(ph) + im[k] * Math.cos(ph);
    }
  }
  return { re: or_, im: oi };
}

describe('butterfly FFT', () => {
  it('bitReverse 正确', () => {
    expect(bitReverse(1, 3)).toBe(4);
    expect(bitReverse(3, 3)).toBe(6);
    expect(bitReverse(0, 4)).toBe(0);
  });
  it('蝶形驱动 IFFT 与直接 DFT 一致 (N=16, 随机谱)', () => {
    const N = 16;
    const re = new Float32Array(N), im = new Float32Array(N);
    for (let i = 0; i < N; i++) { re[i] = Math.sin(i * 1.7) * 2; im[i] = Math.cos(i * 0.9); }
    const bf = createButterflyData(N);
    const got = ifft1DWithButterfly(re, im, bf, N);
    const want = directIdft(re, im);
    for (let i = 0; i < N; i++) {
      expect(got.re[i]).toBeCloseTo(want.re[i], 3);
      expect(got.im[i]).toBeCloseTo(want.im[i], 3);
    }
  });
});
