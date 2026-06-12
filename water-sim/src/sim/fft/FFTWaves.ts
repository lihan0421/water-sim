import * as THREE from 'three/webgpu';
import {
  Fn, instancedArray, attributeArray, instanceIndex, uniform,
  float, int, vec2, vec4, ivec2, textureStore, textureLoad,
} from 'three/tsl';
import { generateInitialSpectrum, type SpectrumParams } from './spectrum';
import { createButterflyData } from './butterfly';

export interface CascadeConfig {
  domainSize: number; // 米
}

const FOAM_JACOBIAN_BIAS = 0.6; // J < 0.6 起沫（波峰挤压判据）

/**
 * 单级联 GPU FFT 海浪管线。每帧流程：
 * ① 频谱时变 h(k,t)，并打包位移谱 P = Dx + i·Dz
 * ② 横向 log₂N + 纵向 log₂N 个蝶形 pass（ping-pong）
 * ③ (-1)^(x+z) 置换 → 写位移纹理 + 高度 storage buffer
 * ④ 有限差分法线 + Jacobian 泡沫 → 写第二张纹理
 *
 * 每级联 2 路 IFFT 打包在 vec4：xy=高度 h 复数，zw=位移 P=Dx+i·Dz 复数。
 */
export class FFTCascade {
  readonly displacementTex: THREE.StorageTexture; // rgba16f: xyz=位移(dx,h,dz), w=高度备份
  readonly normalFoamTex: THREE.StorageTexture;   // rgba16f: xyz=法线, w=泡沫(Jacobian)
  readonly heightBuffer: ReturnType<typeof instancedArray>; // float，供后续物理回读
  readonly domainSize: number;

  private computes: { update: any; passes: any[]; output: any; normals: any };
  private timeU = uniform(0);
  private choppyU: any;

  constructor(N: number, cfg: CascadeConfig, params: SpectrumParams, choppyU: any) {
    this.domainSize = cfg.domainSize;
    this.choppyU = choppyU;

    const { h0, omega } = generateInitialSpectrum(N, cfg.domainSize, params);
    const h0Buf = attributeArray(h0, 'vec4');   // 静态只读
    const omegaBuf = attributeArray(omega, 'float');
    const bfData = createButterflyData(N);
    const bfBuf = attributeArray(bfData, 'vec4');

    const pingA = instancedArray(N * N, 'vec4'); // ping-pong 复数缓冲
    const pingB = instancedArray(N * N, 'vec4');
    this.heightBuffer = instancedArray(N * N, 'float');
    this.displacementTex = makeStorageTex(N);
    this.normalFoamTex = makeStorageTex(N);

    const NN = N * N;
    const log2N = Math.log2(N);
    const Ni = int(N);

    const timeU = this.timeU;
    const choppy = this.choppyU;
    const heightBuffer = this.heightBuffer;
    const displacementTex = this.displacementTex;
    const normalFoamTex = this.normalFoamTex;

    // ① 频谱时变 h(k,t) = h0(k)e^{iωt} + h0(-k)*e^{-iωt}；位移谱 P = Dx + i·Dz, D = -i·k̂·h
    const dk = (2 * Math.PI) / cfg.domainSize;
    const update = Fn(() => {
      const i = instanceIndex.toInt();
      const ix = i.mod(Ni);
      const iz = i.div(Ni);
      const h0v = h0Buf.element(i);
      const w = omegaBuf.element(i);
      const c = w.mul(timeU).cos();
      const s = w.mul(timeU).sin();
      // h(k,t).re/.im（h0(k) 部分旋 +ωt，h0(-k)* 部分旋 -ωt）
      const hr = h0v.x.mul(c).sub(h0v.y.mul(s)).add(h0v.z.mul(c).add(h0v.w.mul(s)));
      const hi = h0v.x.mul(s).add(h0v.y.mul(c)).add(h0v.w.mul(c).sub(h0v.z.mul(s)));
      const kx = float(ix).sub(N / 2).mul(dk);
      const kz = float(iz).sub(N / 2).mul(dk);
      const klen = vec2(kx, kz).length().max(1e-6);
      const nx = kx.div(klen);
      const nz = kz.div(klen);
      // P.re = hi·nx + hr·nz, P.im = -hr·nx + hi·nz
      const pr = hi.mul(nx).add(hr.mul(nz));
      const pi = hr.negate().mul(nx).add(hi.mul(nz));
      pingA.element(i).assign(vec4(hr, hi, pr, pi));
    })().compute(NN);

    // ② 蝶形 pass：dir=0 横向（行内），dir=1 纵向；每 stage 一个 compute 节点
    const passes: any[] = [];
    let src = pingA;
    let dst = pingB;
    for (let dir = 0; dir < 2; dir++) {
      for (let stage = 0; stage < log2N; stage++) {
        const sConst = stage;
        const dirConst = dir;
        const S = src;
        const D = dst;
        passes.push(Fn(() => {
          const i = instanceIndex.toInt();
          const ix = i.mod(Ni);
          const iz = i.div(Ni);
          const lane = dirConst === 0 ? ix : iz;
          const bf = bfBuf.element(int(sConst * N).add(lane));
          const a = bf.z.toInt();
          const b = bf.w.toInt();
          const idxA = dirConst === 0 ? iz.mul(Ni).add(a) : a.mul(Ni).add(ix);
          const idxB = dirConst === 0 ? iz.mul(Ni).add(b) : b.mul(Ni).add(ix);
          const va = S.element(idxA);
          const vb = S.element(idxB);
          const wr = bf.x;
          const wi = bf.y;
          // out = va + W·vb，两路复数（xy 与 zw）并行
          D.element(i).assign(vec4(
            va.x.add(wr.mul(vb.x)).sub(wi.mul(vb.y)),
            va.y.add(wr.mul(vb.y)).add(wi.mul(vb.x)),
            va.z.add(wr.mul(vb.z)).sub(wi.mul(vb.w)),
            va.w.add(wr.mul(vb.w)).add(wi.mul(vb.z)),
          ));
        })().compute(NN));
        const tmp = src; src = dst; dst = tmp;
      }
    }
    const finalBuf = src;

    // ③ (-1)^(x+z) 置换 + 写位移纹理 + 高度缓冲
    const output = Fn(() => {
      const i = instanceIndex.toInt();
      const ix = i.mod(Ni);
      const iz = i.div(Ni);
      const sign = float(1).sub(ix.add(iz).mod(int(2)).toFloat().mul(2));
      const v = finalBuf.element(i);
      const h = v.x.mul(sign);
      const dx = v.z.mul(sign).mul(choppy);
      const dz = v.w.mul(sign).mul(choppy);
      textureStore(displacementTex, ivec2(ix, iz), vec4(dx, h, dz, h));
      heightBuffer.element(i).assign(h);
    })().compute(NN);

    // ④ 法线 + Jacobian 泡沫（位移纹理有限差分，wrap 寻址）
    const texel = cfg.domainSize / N;
    const normals = Fn(() => {
      const i = instanceIndex.toInt();
      const ix = i.mod(Ni);
      const iz = i.div(Ni);
      const wrap = (v: any) => v.add(Ni).mod(Ni);
      const ld = (x: any, z: any) => textureLoad(displacementTex, ivec2(wrap(x), wrap(z)));
      const r = ld(ix.add(1), iz);
      const l = ld(ix.sub(1), iz);
      const t = ld(ix, iz.add(1));
      const b = ld(ix, iz.sub(1));
      const dhdx = r.y.sub(l.y).div(2 * texel);
      const dhdz = t.y.sub(b.y).div(2 * texel);
      const n = vec4(dhdx.negate(), 1, dhdz.negate(), 0).normalize();
      const jxx = float(1).add(r.x.sub(l.x).div(2 * texel));
      const jzz = float(1).add(t.z.sub(b.z).div(2 * texel));
      const jxz = t.x.sub(b.x).div(2 * texel);
      const jac = jxx.mul(jzz).sub(jxz.mul(jxz));
      const foam = float(FOAM_JACOBIAN_BIAS).sub(jac).max(0);
      textureStore(normalFoamTex, ivec2(ix, iz), vec4(n.x, n.y, n.z, foam));
    })().compute(NN);

    this.computes = { update, passes, output, normals };
  }

  update(renderer: THREE.WebGPURenderer, time: number) {
    this.timeU.value = time;
    renderer.compute(this.computes.update);
    for (const p of this.computes.passes) renderer.compute(p);
    renderer.compute(this.computes.output);
    renderer.compute(this.computes.normals);
  }

  dispose() {
    // compute 节点也要显式 dispose：靠 GC 释放 pipeline/storage 不及时，
    // 场景切换或 GUI rebuild 反复重建级联时会堆积 VRAM
    this.computes.update.dispose();
    for (const p of this.computes.passes) p.dispose();
    this.computes.output.dispose();
    this.computes.normals.dispose();
    this.displacementTex.dispose();
    this.normalFoamTex.dispose();
  }
}

function makeStorageTex(N: number): THREE.StorageTexture {
  const t = new THREE.StorageTexture(N, N);
  t.type = THREE.HalfFloatType;
  t.format = THREE.RGBAFormat;
  t.magFilter = t.minFilter = THREE.LinearFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.generateMipmaps = false;
  return t;
}

/**
 * 多级联 FFT 海浪：默认 3 级联（大/中/小尺度叠加）。
 * 共享 choppy uniform，每帧顺序调度所有级联的 compute。
 */
export class FFTWaves {
  readonly cascades: FFTCascade[];
  readonly choppyU = uniform(1.2);

  constructor(N: number, params: SpectrumParams, domains: number[] = [250, 60, 15]) {
    this.cascades = domains.map((d) => new FFTCascade(N, { domainSize: d }, params, this.choppyU));
  }

  update(renderer: THREE.WebGPURenderer, time: number) {
    for (const c of this.cascades) c.update(renderer, time);
  }

  dispose() {
    for (const c of this.cascades) c.dispose();
  }
}
