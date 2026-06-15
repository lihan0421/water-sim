# water-sim

实时 WebGPU 海洋/河流/水槽仿真，基于 Three.js r0.180 TSL 计算着色器。

## 运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`（需要 Chrome 113+ 或 Edge 113+ 以获得 WebGPU 支持）。

## 操作说明

| 操作 | 效果 |
|------|------|
| 左键点击水面 | 在相机处投出球（GUI 可切换为箱） |
| Shift + 左键点击 | 投箱（覆盖 GUI 类型选择） |
| WASD | 控制船（海洋/河流场景） |
| 右键拖拽 / 滚轮 | 旋转/缩放视角 |
| GUI 顶部下拉 | 切换场景（ocean / river / tank） |

## 场景

### 海洋（Ocean）
GPU FFT 3 级联（250m / 60m / 15m 尺度叠加）+ 交互波动层 + 可驾驶船只。

GUI 参数：
- **风速 m/s**（2–25）：重建 JONSWAP 频谱，改变浪高与周期
- **风向°**（0–360）：重建频谱，改变主浪传播方向
- **浪高**（0.2–2.5）：振幅缩放，重建频谱
- **尖锐度**（0–2.5）：Stokes 横向位移强度，热更新
- **泡沫阈值**（0.1–1.5）：Jacobian < 阈值的区域起沫，热更新
- **投掷类型**：点击投球或投箱
- **清空物体**：回收所有漂浮物
- **跟船视角**：相机跟随船只

### 河流（River）
FFT 细纹 + 半拉格朗日平流（2.5 m/s 顺流）+ 自动漂流箱。

GUI 参数：
- **浪高**（0.05–0.5）：重建 FFT，改变河面小纹尺度
- **流速 m/s**（0–8）：热更新平流速度，影响波形漂移与物体顺流速度
- **投掷类型 / 清空**
- **跟船视角**

### 水槽（Tank）
纯交互波动层，反射边界，无 FFT。玻璃槽壁透射，可观察侧面水线。

GUI 参数：
- **波速 m/s**（0.5–4）：热更新 CFL 系数，改变涟漪传播速度
- **阻尼**（0.001–0.05）：热更新每子步衰减，控制波形持续时间
- **投掷类型 / 清空**

## 架构

```
water-sim/src/
├── core/           App 主循环、WaterScene 接口、SceneContext
├── sim/
│   ├── fft/        JONSWAP 频谱、蝶形 LUT、GPU FFT 3 级联（FFTCascade / FFTWaves）
│   └── interactive/交互波动方程 GPU 计算（半拉格朗日平流、扰动注入、泡沫累积）
├── physics/        RigidBody、Floater（多点浮力）、GpuHeightMirror 高度回读
├── entities/       Throwables（投掷物）、Boat（可驾驶船）
├── effects/        SplashParticles（GPU 粒子浪花，8192 粒子环形池）
└── scenes/
    ├── ocean/      OceanScene + 水面材质 + 程序化天空
    ├── river/      RiverScene
    └── tank/       TankScene
```

关键技术点：
- **GPU FFT**：ping-pong 蝶形 pass，每帧 2×log₂N 次 `renderer.compute()`，输出位移 + 法线 + Jacobian 泡沫纹理
- **波动方程**：`next = h + (h−prev)(1−damp) + c²dt²∇²h`，固定 1/60s 子步确保波速与帧率无关
- **CFL 约束**：`c²dt²/dx² ≤ 0.4`；水槽 N=128 给出精确 3 m/s，N≥256 被 CFL 限速
- **TSL 计算着色器**：全程 `Fn()` + `instancedArray` + `uniform`，无 GLSL 字符串

详细设计见 [`docs/superpowers/specs/2026-06-11-water-sim-design.md`](../docs/superpowers/specs/2026-06-11-water-sim-design.md)，
实现计划见 [`docs/superpowers/plans/2026-06-11-water-sim.md`](../docs/superpowers/plans/2026-06-11-water-sim.md)。

## 测试

```bash
npm run test
```

37 个单元测试覆盖：JONSWAP 频谱、蝶形 LUT 精度、波动方程 CPU 核、高度双线性采样、刚体积分、浮力稳态。
