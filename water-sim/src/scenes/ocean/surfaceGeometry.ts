import * as THREE from 'three/webgpu';

/**
 * 海面网格：内层 size×size 米、res×res 段密集平面（XZ 平面）承载 FFT 位移细节；
 * 外层放大 20 倍的低密度裙边把海面延伸到地平线，避免可见边缘。
 */
export function createOceanGeometry(size = 512, res = 512) {
  const inner = new THREE.PlaneGeometry(size, size, res, res);
  inner.rotateX(-Math.PI / 2);
  const outer = new THREE.PlaneGeometry(size * 20, size * 20, 64, 64);
  outer.rotateX(-Math.PI / 2);
  return { inner, outer, cellSize: size / res }; // cellSize 供相机吸附跟随用
}
