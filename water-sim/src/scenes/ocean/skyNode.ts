import { Fn, vec3, max, dot, normalize, mix } from 'three/tsl';

// 太阳方向（归一化前的世界坐标）。天空背景与水面高光必须共用此常量，保证一致光照。
export const SUN_DIR = [0.4, 0.35, 0.6] as const;

/** 程序化渐变天空：dir 为单位方向向量节点 → 天空颜色（含太阳盘 + 辉光）。 */
export const skyColor = Fn(([dir]: any[]) => {
  const sun = normalize(vec3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]));
  const horizon = vec3(0.75, 0.85, 0.95);
  const zenith = vec3(0.18, 0.38, 0.66);
  const t = max(dir.y, 0).pow(0.55);            // 仰角越高越偏天顶色
  const base = mix(horizon, zenith, t);
  const sunAmount = max(dot(dir, sun), 0);
  // 高次幂窄太阳盘 + 低次幂宽辉光
  const disc = sunAmount.pow(2048).mul(20).add(sunAmount.pow(16).mul(0.25));
  return base.add(vec3(1.0, 0.9, 0.7).mul(disc));
});
