import { describe, it, expect } from 'vitest';
import { allocateProportionally } from '../utils/money.js';
import { priceOrder, validateCommercialTerms, computeLineRefund, computeTaxPaise } from '../services/pricing.js';
import { canTransition, assertTransition } from '../services/orderStateMachine.js';

describe('allocateProportionally', () => {
  it('always sums exactly to the total', () => {
    for (const total of [0, 1, 7, 100, 9999, 12345]) {
      for (const w of [[1, 1, 1], [59900, 25000, 1], [3, 0, 7], [5]]) {
        expect(allocateProportionally(total, w).reduce((a, b) => a + b, 0)).toBe(total);
      }
    }
  });
});

describe('validateCommercialTerms', () => {
  it('derives margin: 599 - 400 = 199', () => {
    expect(validateCommercialTerms(59900, 40000).platformMarginPaise).toBe(19900);
  });
  it.each([[undefined, 100], [100, undefined], [100, 100], [100, 200], [100, 0]])('rejects %s/%s', (s, c) => {
    expect(() => validateCommercialTerms(s as any, c as any)).toThrow();
  });
});

describe('priceOrder', () => {
  it('never reduces creator amounts; discount comes out of margin', () => {
    const p = priceOrder({ lines: [{ key: 'a', unitPricePaise: 59900, creatorAmountPerUnitPaise: 40000, quantity: 2 }], discountPaise: 5000, shippingPaise: 4900 });
    expect(p.creatorPayablePaise).toBe(80000);
    expect(p.platformMarginPaise).toBe(39800 - 5000);
    expect(p.totalPaise).toBe(119800 - 5000 + 4900);
  });
  it('splits discount across creators proportionally and exactly', () => {
    const p = priceOrder({ lines: [
      { key: 'a', unitPricePaise: 60000, creatorAmountPerUnitPaise: 40000, quantity: 1 },
      { key: 'b', unitPricePaise: 30000, creatorAmountPerUnitPaise: 20000, quantity: 1 },
    ], discountPaise: 1000 });
    expect(p.lines.map((l) => l.discountAllocatedPaise)).toEqual([667, 333]);
    expect(p.lines.reduce((a, l) => a + l.discountAllocatedPaise, 0)).toBe(1000);
  });
  it('rejects a discount that would push margin below zero', () => {
    expect(() => priceOrder({ lines: [{ key: 'a', unitPricePaise: 50000, creatorAmountPerUnitPaise: 45000, quantity: 1 }], discountPaise: 6000 })).toThrow(/margin/i);
  });
  it('rejects discount above subtotal and non-integer money', () => {
    expect(() => priceOrder({ lines: [{ key: 'a', unitPricePaise: 100, creatorAmountPerUnitPaise: 10, quantity: 1 }], discountPaise: 101 })).toThrow();
    expect(() => priceOrder({ lines: [{ key: 'a', unitPricePaise: 100.5, creatorAmountPerUnitPaise: 10, quantity: 1 }] })).toThrow();
  });
  it('rounds tax half-up in integer paise', () => {
    expect(computeTaxPaise(10050, 5)).toBe(503); // 502.5 -> 503
  });
});

describe('computeLineRefund', () => {
  const base = { quantity: 3, lineTotalPaise: 10000, creatorAmountPerUnitPaise: 2000, alreadyRefundedQuantity: 0 };
  it('refunds sum exactly to the line total across unit-by-unit refunds', () => {
    let done = 0; let sum = 0;
    for (let i = 0; i < 3; i++) { sum += computeLineRefund({ ...base, alreadyRefundedQuantity: done, refundQuantity: 1 }).refundPaise; done++; }
    expect(sum).toBe(10000);
  });
  it('deducts the full agreed creator amount; platform absorbs the rest', () => {
    const r = computeLineRefund({ ...base, refundQuantity: 1 });
    expect(r.creatorAdjustmentPaise).toBe(2000);
    expect(r.platformMarginAdjustmentPaise).toBe(r.refundPaise - 2000);
  });
  it('rejects over-refund', () => {
    expect(() => computeLineRefund({ ...base, alreadyRefundedQuantity: 2, refundQuantity: 2 })).toThrow();
  });
});

describe('order state machine', () => {
  it('allows the happy path', () => {
    for (const [a, b] of [['pending_payment', 'paid'], ['paid', 'processing'], ['processing', 'shipped'], ['shipped', 'delivered']] as const) expect(canTransition(a, b)).toBe(true);
  });
  it('blocks skipping and reviving terminal states', () => {
    expect(canTransition('pending_payment', 'shipped')).toBe(false);
    expect(() => assertTransition('cancelled', 'paid')).toThrow();
    expect(canTransition('delivered', 'pending_payment')).toBe(false);
  });
});
