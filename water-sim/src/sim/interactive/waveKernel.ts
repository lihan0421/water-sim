// 交互波动层 CPU 参考核（Task 7）。GPU 版 InteractiveWaves 的波动方程部分与此一致
//（此处测试即其回归基准）；平流仅 CPU（GPU 版留待河流任务），扰动/泡沫仅 GPU。
export interface WaveParams {
  c2dt2: number;     // c²·dt²/dx²，CFL 稳定性要求 < 0.5
  damping: number;   // 每步速度衰减系数
  boundary: 'absorb' | 'reflect';
  flowX: number; flowZ: number; // 平流速度（格/秒），河流用
  dt: number;
}

/** 一步显式波动方程。next = h + (h-prev)·(1-damp) + c²dt²∇²h，边缘按 boundary 处理 */
export function waveStep(prev: Float32Array, curr: Float32Array, next: Float32Array, N: number, p: WaveParams) {
  const at = (x: number, z: number) => {
    if (x < 0 || x >= N || z < 0 || z >= N) return 0;
    return curr[z * N + x];
  };
  for (let z = 0; z < N; z++) {
    for (let x = 0; x < N; x++) {
      const i = z * N + x;
      const edge = x === 0 || x === N - 1 || z === 0 || z === N - 1;
      if (edge) {
        if (p.boundary === 'reflect') {
          // Neumann BC：边格（非角）复制对应轴的内邻；角格取两轴内邻均值避免对角值导致相位奇点
          const isXEdge = x === 0 || x === N - 1;
          const isZEdge = z === 0 || z === N - 1;
          if (isXEdge && isZEdge) {
            next[i] = (at(Math.min(Math.max(x, 1), N - 2), z) + at(x, Math.min(Math.max(z, 1), N - 2))) / 2;
          } else {
            next[i] = at(Math.min(Math.max(x, 1), N - 2), Math.min(Math.max(z, 1), N - 2));
          }
        } else {
          next[i] = curr[i] * 0.5;  // absorb：强阻尼吸收
        }
        continue;
      }
      // 平流（半拉格朗日，双线性回溯）
      let h = curr[i], hp = prev[i];
      if (p.flowX !== 0 || p.flowZ !== 0) {
        const sx = x - p.flowX * p.dt, sz = z - p.flowZ * p.dt;
        const x0 = Math.floor(sx), z0 = Math.floor(sz), fx = sx - x0, fz = sz - z0;
        const bil = (a: Float32Array) => {
          const g = (xx: number, zz: number) => (xx < 0 || xx >= N || zz < 0 || zz >= N) ? 0 : a[zz * N + xx];
          return g(x0, z0) * (1 - fx) * (1 - fz) + g(x0 + 1, z0) * fx * (1 - fz)
               + g(x0, z0 + 1) * (1 - fx) * fz + g(x0 + 1, z0 + 1) * fx * fz;
        };
        h = bil(curr); hp = bil(prev);
      }
      // 拉普拉斯中心项用 curr[i]（非平流），避免 flow≠0 时混帧产生一阶导误差
      const lap = at(x + 1, z) + at(x - 1, z) + at(x, z + 1) + at(x, z - 1) - 4 * curr[i];
      const vel = (h - hp) * (1 - p.damping);
      next[i] = h + vel + p.c2dt2 * lap;
    }
  }
}
