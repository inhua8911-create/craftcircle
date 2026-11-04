import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';
describe('webhook endpoint when real payments are not configured', () => {
  it('is disabled (503), never silently accepting events', async () => {
    const r = await request(createApp()).post('/api/v1/payments/webhooks/razorpay').set('content-type', 'application/json').send('{}');
    expect(r.status).toBe(503);
  });
});
