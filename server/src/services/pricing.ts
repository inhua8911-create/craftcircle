import { allocateProportionally, assertPaise, type Paise } from '../utils/money.js';
import { AppError } from '../utils/errors.js';

/**
 * Commercial terms for one product. Margin is ALWAYS derived, never supplied.
 * Rule: selling price must exceed the agreed creator amount (margin > 0).
 */
export function validateCommercialTerms(sellingPricePaise: Paise | undefined, creatorAmountPaise: Paise | undefined) {
  if (sellingPricePaise == null || creatorAmountPaise == null) {
    throw new AppError(422, 'PRICING_INCOMPLETE', 'Selling price and creator amount must both be set before publishing');
  }
  assertPaise(sellingPricePaise, 'sellingPrice');
  assertPaise(creatorAmountPaise, 'creatorAmount');
  if (creatorAmountPaise <= 0) throw new AppError(422, 'PRICING_INVALID', 'Creator amount must be greater than zero');
  if (sellingPricePaise <= creatorAmountPaise) {
    throw new AppError(422, 'PRICING_INVALID', 'Selling price must be greater than the creator amount (platform margin must be positive)');
  }
  return { platformMarginPaise: sellingPricePaise - creatorAmountPaise };
}

export interface LineInput {
  key: string; // caller's id for the line (e.g. product id)
  unitPricePaise: Paise;
  creatorAmountPerUnitPaise: Paise;
  quantity: number;
}
export interface PricedLine extends LineInput {
  subtotalPaise: Paise;
  discountAllocatedPaise: Paise;
  shippingAllocatedPaise: Paise;
  lineTotalPaise: Paise; // subtotal - discount
  creatorTotalPaise: Paise; // creator amount x qty; NEVER reduced by discounts
  platformMarginPaise: Paise; // lineTotal - creatorTotal (after discount)
}
export interface OrderPricing {
  lines: PricedLine[];
  subtotalPaise: Paise;
  discountPaise: Paise;
  shippingPaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;
  creatorPayablePaise: Paise;
  platformMarginPaise: Paise;
}

/**
 * Discount-allocation rule (documented, deterministic):
 *  1. Discounts are funded from PLATFORM margin. Creator agreed amounts are never reduced.
 *  2. The order discount is split across lines proportionally to line subtotal (largest remainder, exact).
 *  3. If any line's margin would go negative, the discount is rejected.
 * Shipping is allocated the same way (informational; it is not creator or margin income).
 */
export function priceOrder(input: { lines: LineInput[]; discountPaise?: Paise; shippingPaise?: Paise; taxPaise?: Paise }): OrderPricing {
  const { lines } = input;
  if (lines.length === 0) throw new AppError(422, 'EMPTY_ORDER', 'Order has no items');
  const discount = input.discountPaise ?? 0;
  const shipping = input.shippingPaise ?? 0;
  const tax = input.taxPaise ?? 0;
  [discount, shipping, tax].forEach((n) => assertPaise(n));
  if (discount < 0 || shipping < 0 || tax < 0) throw new AppError(422, 'PRICING_INVALID', 'Discount, shipping and tax cannot be negative');

  for (const l of lines) {
    assertPaise(l.unitPricePaise);
    assertPaise(l.creatorAmountPerUnitPaise);
    if (!Number.isInteger(l.quantity) || l.quantity < 1) throw new AppError(422, 'PRICING_INVALID', 'Quantity must be a positive integer');
  }
  const subtotals = lines.map((l) => l.unitPricePaise * l.quantity);
  const subtotal = subtotals.reduce((a, b) => a + b, 0);
  if (discount > subtotal) throw new AppError(422, 'DISCOUNT_TOO_LARGE', 'Discount cannot exceed the order subtotal');

  const discAlloc = allocateProportionally(discount, subtotals);
  const shipAlloc = allocateProportionally(shipping, subtotals);

  const priced: PricedLine[] = lines.map((l, i) => {
    const subtotalPaise = subtotals[i]!;
    const discountAllocatedPaise = discAlloc[i]!;
    const lineTotalPaise = subtotalPaise - discountAllocatedPaise;
    const creatorTotalPaise = l.creatorAmountPerUnitPaise * l.quantity;
    const platformMarginPaise = lineTotalPaise - creatorTotalPaise;
    if (platformMarginPaise < 0) {
      throw new AppError(422, 'DISCOUNT_EXCEEDS_MARGIN', 'This discount would reduce platform margin below zero for an item; creator amounts cannot be reduced', { line: l.key });
    }
    return { ...l, subtotalPaise, discountAllocatedPaise, shippingAllocatedPaise: shipAlloc[i]!, lineTotalPaise, creatorTotalPaise, platformMarginPaise };
  });

  return {
    lines: priced,
    subtotalPaise: subtotal,
    discountPaise: discount,
    shippingPaise: shipping,
    taxPaise: tax,
    totalPaise: subtotal - discount + shipping + tax,
    creatorPayablePaise: priced.reduce((a, l) => a + l.creatorTotalPaise, 0),
    platformMarginPaise: priced.reduce((a, l) => a + l.platformMarginPaise, 0),
  };
}

/** Integer tax, rounded half-up, applied to (subtotal - discount). */
export function computeTaxPaise(taxableBasePaise: Paise, ratePercent: number): Paise {
  if (!(ratePercent >= 0 && ratePercent <= 100)) throw new AppError(422, 'PRICING_INVALID', 'Invalid tax rate');
  return Math.floor((taxableBasePaise * Math.round(ratePercent * 100) + 5000) / 10000);
}

export interface RefundItemInput {
  quantity: number; // units ordered
  lineTotalPaise: Paise;
  creatorAmountPerUnitPaise: Paise;
  alreadyRefundedQuantity: number;
  refundQuantity: number; // units to refund now
}
export interface RefundResult {
  refundPaise: Paise; // customer money returned for this line
  creatorAdjustmentPaise: Paise; // positive number = amount deducted from creator earnings
  platformMarginAdjustmentPaise: Paise; // positive number = deducted from platform margin
}

/**
 * Refund of q units returns the proportional share of what the customer actually paid for the line
 * (cumulative floor method; the final unit absorbs rounding so the full refund equals lineTotal exactly).
 * The creator loses their full agreed amount for returned units; the platform absorbs the remainder.
 */
export function computeLineRefund(i: RefundItemInput): RefundResult {
  const { quantity, lineTotalPaise, alreadyRefundedQuantity: done, refundQuantity: q } = i;
  if (!Number.isInteger(q) || q < 1) throw new AppError(422, 'REFUND_INVALID', 'Refund quantity must be a positive integer');
  if (done + q > quantity) throw new AppError(422, 'REFUND_EXCEEDS_ORDER', 'Cannot refund more units than were purchased');
  const cum = (n: number) => (n === quantity ? lineTotalPaise : Math.floor((lineTotalPaise * n) / quantity));
  const refundPaise = cum(done + q) - cum(done);
  const creatorAdjustmentPaise = i.creatorAmountPerUnitPaise * q;
  return { refundPaise, creatorAdjustmentPaise, platformMarginAdjustmentPaise: refundPaise - creatorAdjustmentPaise };
}
