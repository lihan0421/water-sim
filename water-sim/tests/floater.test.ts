// tests/floater.test.ts
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { RigidBody } from '../src/physics/RigidBody';
import { Floater } from '../src/physics/Floater';

describe('Floater', () => {
  it('密度 0.5 的箱子在静水中平衡于半浸没', () => {
    // 1m³ 箱子 500kg → 理论平衡：浸没 0.5m
    const rb = new RigidBody(500, new Vector3(1, 1, 1));
    rb.position.set(0, 0, 0); // 从水线开始
    const fl = new Floater(rb, {
      points: [new Vector3(-0.4, -0.5, -0.4), new Vector3(0.4, -0.5, -0.4), new Vector3(-0.4, -0.5, 0.4), new Vector3(0.4, -0.5, 0.4)],
      crossSectionArea: 1,   // 总水线面积 m²
      maxDraft: 1,           // 完全浸没深度
      linearDrag: 4, angularDrag: 2,
    });
    const still = () => 0; // 静水
    for (let i = 0; i < 1200; i++) { fl.applyForces(still, 1 / 60); rb.applyForce(new Vector3(0, -9.81 * 500, 0)); rb.step(1 / 60); }
    // 平衡时箱底 y = -0.5 浸没深度 = 0.5 → 质心 y = 0
    expect(rb.position.y).toBeCloseTo(0, 1);
    expect(rb.velocity.length()).toBeLessThan(0.05);
  });
  it('完全在空中无浮力', () => {
    const rb = new RigidBody(500, new Vector3(1, 1, 1));
    rb.position.set(0, 10, 0);
    const fl = new Floater(rb, { points: [new Vector3(0, -0.5, 0)], crossSectionArea: 1, maxDraft: 1, linearDrag: 4, angularDrag: 2 });
    fl.applyForces(() => 0, 1 / 60);
    rb.step(1 / 60);
    expect(rb.velocity.y).toBe(0); // 未加重力时不动
  });
});
