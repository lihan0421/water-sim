import * as THREE from 'three/webgpu';
import {
  Fn, texture, uniform, vec2, vec3, vec4, float, positionLocal, positionWorld,
  normalize, mix, max, dot, pow, reflect, cameraPosition, clamp,
} from 'three/tsl';
import { skyColor, SUN_DIR } from './skyNode';
import type { FFTWaves } from '../../sim/fft/FFTWaves';

// 交互波动层（Task 7）注入的高度/泡沫贴图。Task 6 仅 FFT，此处保留接口占位。
export interface InteractiveMaps {
  heightTex: THREE.StorageTexture;            // r=高度
  foamTex: THREE.StorageTexture;              // r=泡沫
  origin: ReturnType<typeof uniform>;         // vec2 网格世界原点（中心）
  sizeMeters: number;
}

export interface WaterMaterialOpts {
  fft?: FFTWaves | null;
  interactive?: InteractiveMaps | null;
  deepColor?: THREE.Color;
  shallowColor?: THREE.Color;
}

/**
 * 水面 TSL 材质：顶点采样 3 级联位移纹理叠加做世界空间排水；片元用级联法线 + Jacobian
 * 泡沫做着色：深水体色 + 菲涅尔反射天空 + 太阳高光 + 泡沫盖白。光照全部手写，故用 Basic 基类。
 */
export function createWaterMaterial(o: WaterMaterialOpts) {
  const mat = new THREE.MeshBasicNodeMaterial();
  const deep = uniform(new THREE.Color(o.deepColor ?? new THREE.Color(0x06283d)));
  const shallow = uniform(new THREE.Color(o.shallowColor ?? new THREE.Color(0x1a7a8a)));
  const fftFade = uniform(1); // 河流场景可调低 FFT 贡献

  // 交互层高度采样（仅在网格范围内有效，边缘软裁剪避免越界拉伸）
  const sampleInteractiveH = (wp: any) => {
    if (!o.interactive) return float(0);
    const i = o.interactive;
    const uvI = wp.xz.sub(i.origin).div(i.sizeMeters).add(0.5);
    const inside = uvI.x.greaterThan(0.002).and(uvI.x.lessThan(0.998))
      .and(uvI.y.greaterThan(0.002)).and(uvI.y.lessThan(0.998));
    return texture(i.heightTex, uvI).r.mul(inside.select(1, 0));
  };

  // —— 顶点位移：世界 XZ / domainSize 作 UV，3 级联位移求和 ——
  const displacedPos = Fn(() => {
    const wp = positionWorld;
    let disp: any = vec3(0);
    if (o.fft) for (const c of o.fft.cascades) {
      const uvC = wp.xz.div(c.domainSize);
      disp = disp.add(texture(c.displacementTex, uvC).xyz.mul(fftFade));
    }
    disp = disp.add(vec3(0, sampleInteractiveH(wp), 0));
    return positionLocal.add(disp);
  })();
  mat.positionNode = displacedPos;

  // —— 片元着色 ——
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    // 法线：各级联斜率叠加（x/z 相加，y 固定 1 后归一），泡沫通道累积
    let n: any = vec3(0, 1, 0);
    let foam: any = float(0);
    if (o.fft) for (const c of o.fft.cascades) {
      const nf = texture(c.normalFoamTex, wp.xz.div(c.domainSize));
      n = normalize(vec3(n.x.add(nf.x.mul(fftFade)), 1, n.z.add(nf.z.mul(fftFade))));
      // 三级联各贡献最多 foamBias 量；除以级联数归一，防三叠后全场饱和为白色
      foam = foam.add(nf.w.mul(fftFade).div(float(o.fft.cascades.length)));
    }
    if (o.interactive) {
      const i = o.interactive;
      const uvI = wp.xz.sub(i.origin).div(i.sizeMeters).add(0.5);
      // 仅在网格范围内采样：越界时 ClampToEdge 读边缘陈旧值，会给全场景添加伪法线/泡沫
      const inside = uvI.x.greaterThan(0.002).and(uvI.x.lessThan(0.998))
        .and(uvI.y.greaterThan(0.002)).and(uvI.y.lessThan(0.998));
      const mask = inside.select(float(1), float(0));
      const e = 1.5 / i.sizeMeters;
      const hl = texture(i.heightTex, uvI.sub(vec2(e, 0))).r, hr = texture(i.heightTex, uvI.add(vec2(e, 0))).r;
      const hb = texture(i.heightTex, uvI.sub(vec2(0, e))).r, ht = texture(i.heightTex, uvI.add(vec2(0, e))).r;
      n = normalize(vec3(n.x.add(hl.sub(hr).mul(2).mul(mask)), 1, n.z.add(hb.sub(ht).mul(2).mul(mask))));
      foam = foam.add(texture(i.foamTex, uvI).r.mul(mask));
    }
    foam = clamp(foam, 0, 1);

    const V = normalize(cameraPosition.sub(wp));
    // Schlick 菲涅尔：掠射角反射强、垂直入射弱
    const fres = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(n, V), 0)), 5)));
    const refl = skyColor(reflect(V.negate(), n));
    // 体色：浪高处偏散射青绿
    const heightTint = clamp(wp.y.mul(0.15).add(0.2), 0, 1);
    const body = mix(deep, shallow, heightTint);
    // 太阳高光（半角向量，窄高次幂）；方向与天空盘共用 SUN_DIR
    const sun = normalize(vec3(SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]));
    const spec = pow(max(dot(n, normalize(V.add(sun))), 0), 360).mul(2);
    let col: any = mix(body, refl, fres).add(vec3(1, 0.95, 0.85).mul(spec));
    col = mix(col, vec3(0.95), clamp(foam.mul(1.4), 0, 1)); // 泡沫盖白
    return vec4(col, 1);
  })();

  return { material: mat, uniforms: { fftFade, deep, shallow } };
}
