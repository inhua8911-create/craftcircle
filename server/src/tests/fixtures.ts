import { Types } from 'mongoose';
import { Order, OrderItem, CreatorProfile, User, Category, Product } from '../models/index.js';
import { priceOrder } from '../services/pricing.js';

export async function makeCreator(name = 'Asha') {
  const user = await User.create({ name, email: `${name.toLowerCase()}${new Types.ObjectId()}@example.com`, passwordHash: 'x', role: 'creator' });
  return CreatorProfile.create({ user: user._id, slug: `${name.toLowerCase()}-${new Types.ObjectId()}`, displayName: name });
}

export async function makeProduct(creatorId: Types.ObjectId, o: { selling?: number; creator?: number; stock?: number; status?: any } = {}) {
  const cat = (await Category.findOne({ slug: 'jewellery' })) ?? (await Category.create({ name: 'Jewellery', slug: 'jewellery' }));
  return Product.create({
    creator: creatorId, name: 'Sample piece', slug: `p-${new Types.ObjectId()}`, description: 'Sample data', category: cat._id,
    stock: o.stock ?? 10, status: o.status ?? 'published', sellingPricePaise: o.selling ?? 59900, creatorAmountPaise: o.creator ?? 40000,
    platformMarginPaise: (o.selling ?? 59900) - (o.creator ?? 40000), pricingVersion: 1, isSample: true,
  });
}

/** Creates a PAID order directly (bypasses checkout) with the given lines. */
export async function makePaidOrder(lines: { creatorId: Types.ObjectId; unit: number; creatorAmt: number; qty: number }[], opts: { discount?: number; shipping?: number; simulated?: boolean } = {}) {
  const priced = priceOrder({
    lines: lines.map((l, i) => ({ key: String(i), unitPricePaise: l.unit, creatorAmountPerUnitPaise: l.creatorAmt, quantity: l.qty })),
    discountPaise: opts.discount, shippingPaise: opts.shipping,
  });
  const order = await Order.create({
    orderNumber: `CC-${new Types.ObjectId().toHexString().slice(-8).toUpperCase()}`, customerEmail: 'c@example.com', customerName: 'Cust',
    shippingAddress: { fullName: 'Cust', phone: '9999999999', line1: '1 Street', city: 'Hyderabad', state: 'Telangana', postalCode: '500001', country: 'India' },
    status: 'paid', paymentStatus: 'paid', isSimulated: opts.simulated ?? true,
    subtotalPaise: priced.subtotalPaise, discountPaise: priced.discountPaise, shippingPaise: priced.shippingPaise, taxPaise: 0, totalPaise: priced.totalPaise,
  });
  const items = [];
  for (const [i, l] of priced.lines.entries()) {
    const src = lines[i]!;
    items.push(await OrderItem.create({
      order: order._id, product: new Types.ObjectId(), creator: src.creatorId, productName: `Item ${i}`, quantity: l.quantity,
      unitPricePaise: l.unitPricePaise, creatorAmountPerUnitPaise: l.creatorAmountPerUnitPaise, platformMarginPerUnitPaise: l.unitPricePaise - l.creatorAmountPerUnitPaise,
      pricingVersion: 1, discountAllocatedPaise: l.discountAllocatedPaise, shippingAllocatedPaise: l.shippingAllocatedPaise, lineTotalPaise: l.lineTotalPaise,
    }));
  }
  return { order, items, priced };
}
