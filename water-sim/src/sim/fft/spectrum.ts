const G = 9.81;

export interface SpectrumParams {
  windSpeed: number;      // m/s
  windDirection: number;  // 弧度，0 = +X
  fetch: number;          // 风区长度 m
  amplitudeScale: number; // 总体幅度缩放（GUI 浪高）
}

export function peakOmega(U: number, F: number): number {
  return 22 * Math.pow((G * G) / (U * F), 1 / 3);
}

/** JONSWAP 频率谱 S(ω) */
export function jonswap(omega: number, U: number, F: number): number {
  if (omega <= 0) return 0;
  const wp = peakOmega(U, F);
  const alpha = 0.076 * Math.pow((U * U) / (F * G), 0.22);
  const gamma = 3.3;
  const sigma = omega <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((omega - wp) ** 2) / (2 * sigma * sigma * wp * wp));
  return ((alpha * G * G) / omega ** 5) * Math.exp(-1.25 * (wp / omega) ** 4) * Math.pow(gamma, r);
}

/** cos² 方向扩散，归一化 ∫D dθ = 1，逆风留 2% 防止完全死寂 */
export function directionalSpread(theta: number, windDir: number): number {
  let d = theta - windDir;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const forward = Math.abs(d) < Math.PI / 2 ? (2 / Math.PI) * Math.cos(d) ** 2 : 0;
  return forward * 0.98 + 0.02 / (2 * Math.PI);
}

/**
 * 初始频谱 h0。布局：N×N 网格，像素 (ix,iz) 对应波矢
 * k = 2π/L * (ix - N/2, iz - N/2)。每像素 4 个 float：
 * [h0(k).re, h0(k).im, h0(-k)*.re, h0(-k)*.im]，同时输出 ω(k)。
 * rng: 返回 [0,1) 的随机源（测试时可注入定值）。
 */
export function generateInitialSpectrum(
  N: number, L: number, p: SpectrumParams, rng: () => number = Math.random,
): { h0: Float32Array; omega: Float32Array } {
  const h0 = new Float32Array(N * N * 4);
  const omega = new Float32Array(N * N);
  const dk = (2 * Math.PI) / L;
  // 高斯随机（Box-Muller）
  const gauss = () => {
    const u1 = Math.max(rng(), 1e-9), u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const amp = (kx: number, kz: number) => {
    const k = Math.hypot(kx, kz);
    if (k < 1e-6) return 0;
    const w = Math.sqrt(G * k);            // 深水色散
    const theta = Math.atan2(kz, kx);
    // S(k,θ) = S(ω)·D(θ)·dω/dk / k，dω/dk = g/(2ω)
    const Sk = (jonswap(w, p.windSpeed, p.fetch) * directionalSpread(theta, p.windDirection) * (G / (2 * w))) / k;
    // Tessendorf (2001) Eq.4: |h̃₀(k)| = (1/√2)·ξ·√(2S)·Δk；(1/√2) 因子在调用处乘入
    return Math.sqrt(2 * Sk) * dk * p.amplitudeScale;
  };
  for (let iz = 0; iz < N; iz++) {
    for (let ix = 0; ix < N; ix++) {
      const kx = dk * (ix - N / 2), kz = dk * (iz - N / 2);
      const i = iz * N + ix;
      omega[i] = Math.sqrt(G * Math.hypot(kx, kz));
      const a = amp(kx, kz), b = amp(-kx, -kz);
      const inv = Math.SQRT1_2;
      if (a === 0) {
        h0[i * 4 + 0] = 0;
        h0[i * 4 + 1] = 0;
      } else {
        h0[i * 4 + 0] = inv * gauss() * a;
        h0[i * 4 + 1] = inv * gauss() * a;
      }
      if (b === 0) {
        h0[i * 4 + 2] = 0;
        h0[i * 4 + 3] = 0;
      } else {
        h0[i * 4 + 2] = inv * gauss() * b;    // h0(-k) 的实部
        h0[i * 4 + 3] = -inv * gauss() * b;   // 共轭 → 虚部取负
      }
    }
  }
  return { h0, omega };
}
