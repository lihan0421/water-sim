# Rust Demo 设计文档

**日期：** 2026-06-02  
**项目路径：** `D:\code\SJTU\rustdemo\`  
**目标用户：** Rust 零基础，C++ / Python 均有基础

---

## 目标

创建一个单文件教程式 Rust 项目，边学边跑，展示 Rust 相比 C++ 和 Python 的核心独特性。代码中附大量中文注释，对比三种语言的做法和权衡。

---

## 项目结构

```
D:\code\SJTU\rustdemo\
├── Cargo.toml
├── src/
│   └── main.rs        # 全部教程代码 + 主程序（约 350 行）
└── data/
    ├── file1.txt      # 示例英文文本
    ├── file2.txt
    └── file3.txt
```

---

## main.rs 章节结构

每章节格式：
1. 章节标题注释（`// === 第N章：XXX ===`）
2. 中文说明：这个特性是什么、为什么 Rust 这样设计
3. C++ 做法对比（注释中伪代码）
4. Python 做法对比（注释中伪代码）
5. Rust 代码演示（可独立理解的函数或代码块）

### 第 1 章：所有权与移动语义（Ownership & Move）
- 演示变量赋值后原变量失效（move）
- 对比 C++ 深拷贝 / Python 引用共享
- 演示 `Clone` 显式拷贝

### 第 2 章：借用与引用（Borrowing & References）
- 演示不可变借用（`&T`）与可变借用（`&mut T`）
- 演示借用检查器如何在编译期阻止数据竞争
- 对比 C++ 裸指针（运行时崩溃）、Python 无借用概念

### 第 3 章：无 GC 的内存安全
- 演示 `String` 在离开作用域时自动释放（Drop trait）
- 对比 C++ RAII（需要手写）、Python GC（有循环引用泄漏风险）
- 演示编译器阻止 use-after-free

### 第 4 章：枚举与模式匹配（Enum & match）
- 定义带数据的枚举（`enum FileResult`）
- 用 `match` 穷举所有分支，编译器保证不遗漏
- 对比 C++ `enum`+`switch`（不带数据、可落空）、Python 类模拟

### 第 5 章：Result / Option 错误处理
- 演示 `Option<T>`（替代 null）
- 演示 `Result<T, E>` + `?` 操作符链式传播错误
- 对比 C++ 错误码 / 异常、Python `try/except`

### 第 6 章：无畏并发（Arc + Mutex + 线程 + channel）
- 演示 `std::thread::spawn`
- 演示 `Arc<Mutex<T>>` 共享状态（编译器阻止未加锁访问）
- 演示 `mpsc::channel` 线程间通信
- 对比 C++ 手动加锁（运行时数据竞争）、Python GIL（伪并发）

---

## 主程序逻辑（串联所有特性）

```
main()
  ├── 读取 data/ 目录下所有 .txt 文件路径
  ├── 为每个文件 spawn 一个线程（第6章）
  │     ├── 读取文件内容（第5章 Result 错误处理）
  │     └── 统计词频 → HashMap<String, usize>
  ├── 通过 channel 将各线程结果发回主线程
  ├── 主线程用 Arc<Mutex<HashMap>> 合并所有结果
  └── 输出 Top 10 高频词
```

---

## 依赖

仅使用 Rust 标准库（`std`），无第三方 crate，确保 `cargo run` 即可直接运行。

---

## 成功标准

- `cargo run` 无错误，输出 Top 10 词频
- 每个章节的示例代码有独立的函数，可单独阅读理解
- 注释覆盖所有关键 Rust 概念，包含 C++ / Python 对比
