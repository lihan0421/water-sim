// tests/rigidbody.test.ts
import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { RigidBody } from '../src/physics/RigidBody';

describe('RigidBody', () => {
  it('无力时匀速直线运动', () => {
    const rb = new RigidBody(10, new Vector3(1, 1, 1));
    rb.velocity.set(2, 0, 0);
    for (let i = 0; i < 60; i++) rb.step(1 / 60);
    expect(rb.position.x).toBeCloseTo(2, 1);
  });
  it('恒力产生加速度 F=ma', () => {
    const rb = new RigidBody(10, new Vector3(1, 1, 1));
    for (let i = 0; i < 60; i++) { rb.applyForce(new Vector3(10, 0, 0)); rb.step(1 / 60); }
    expect(rb.velocity.x).toBeCloseTo(1, 1); // a=1m/s² × 1s
  });
  it('偏心力产生角速度', () => {
    const rb = new RigidBody(10, new Vector3(1, 1, 1));
    rb.applyForceAtPoint(new Vector3(0, 0, 10), new Vector3(1, 0, 0)); // +X 处施 +Z 力 → 绕 Y 转
    rb.step(1 / 60);
    expect(Math.abs(rb.angularVelocity.y)).toBeGreaterThan(0);
  });
});
