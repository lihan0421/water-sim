const request = require('supertest');
const app = require('../src/app');

describe('POST /api/auth/login', () => {
  it('returns 400 when code is missing', async () => {
    const res = await request(app).post('/api/auth/login').send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe(400);
  });
});
