// src/sim/fft/butterfly.ts

export function bitReverse(i: number, bits: number): number {
  let r = 0;
  for (let b = 0; b < bits; b++) { r = (r << 1) | (i & 1); i >>= 1; }
  return r;
}

/**
 * 蝶形查找表：stages × N 个条目，每条 4 float：
 * [twiddle.re, twiddle.im, indexA, indexB]
 * 任意 wing 统一公式 out[i] = in[A] + W·in[B]（逆变换 W = e^{+2πik/N}）。
 */
export function createButterflyData(N: number): Float32Array {
  const stages = Math.log2(N);
  const data = new Float32Array(stages * N * 4);
  for (let s = 0; s < stages; s++) {
    const span = 1 << s;            // 蝶形半宽
    const seg = span << 1;          // 蝶形全宽
    for (let i = 0; i < N; i++) {
      const k = ((i * N) / seg) % N;            // 旋转因子序号（下翼自动相差 N/2 → 取负）
      const wr = Math.cos((2 * Math.PI * k) / N);
      const wi = Math.sin((2 * Math.PI * k) / N); // 逆变换取 +sin
      const top = i % seg < span;
      let a: number, b: number;
      if (s === 0) { a = top ? bitReverse(i, stages) : bitReverse(i - 1, stages);
                     b = top ? bitReverse(i + 1, stages) : bitReverse(i, stages); }
      else         { a = top ? i : i - span;  b = top ? i + span : i; }
      const o = (s * N + i) * 4;
      data[o] = wr; data[o + 1] = wi; data[o + 2] = a; data[o + 3] = b;
    }
  }
  return data;
}

/** CPU 参考：用蝶形表跑 1D IFFT（与 GPU kernel 逐 pass 等价，用于测试） */
export function ifft1DWithButterfly(re: Float32Array, im: Float32Array, bf: Float32Array, N: number) {
  const stages = Math.log2(N);
  let curR = Float32Array.from(re), curI = Float32Array.from(im);
  for (let s = 0; s < stages; s++) {
    const nxtR = new Float32Array(N), nxtI = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const o = (s * N + i) * 4;
      const wr = bf[o], wi = bf[o + 1], a = bf[o + 2], b = bf[o + 3];
      nxtR[i] = curR[a] + wr * curR[b] - wi * curI[b];
      nxtI[i] = curI[a] + wr * curI[b] + wi * curR[b];
    }
    curR = nxtR; curI = nxtI;
  }
  return { re: curR, im: curI };
}
