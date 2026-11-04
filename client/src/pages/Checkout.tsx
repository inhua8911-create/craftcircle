import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError, fieldErrors } from '../lib/api';
import { idempotencyKey } from '../lib/format';
import type { Address, Order, PaymentIntent, Quote } from '../lib/types';
import { useCart, useMe } from '../hooks/queries';
import { useSeo } from '../hooks/useSeo';
import { Alert, EmptyState, Price, Skeleton, SelectField, TextField } from '../components/ui';
import { PaymentPanel } from '../components/PaymentPanel';
import { STATES } from '../lib/states';

const schema = z.object({
  name: z.string().trim().min(1, 'Enter your name'), email: z.string().trim().min(1, 'Enter your email').pipe(z.email('Enter a valid email')),
  phone: z.string().trim().regex(/^[+0-9 -]{7,20}$/, 'Enter a valid phone number'),
  line1: z.string().trim().min(1, 'Enter your address'), line2: z.string().trim().optional(), city: z.string().trim().min(1, 'Enter your city'),
  state: z.string().min(1, 'Choose your state'), postalCode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'), saveAddress: z.boolean(),
});
type Form = z.infer<typeof schema>;

export default function Checkout() {
  useSeo({ title: 'Checkout', noindex: true });
  const nav = useNavigate(); const qc = useQueryClient(); const { data: me } = useMe(); const cart = useCart(); const [sp] = useSearchParams();
  const [coupon, setCoupon] = useState(''); const [couponInput, setCouponInput] = useState(''); const [err, setErr] = useState('');
  const [placed, setPlaced] = useState<{ order: Order; payment: PaymentIntent } | null>(null);
  const saved = useQuery({ queryKey: ['addresses'], queryFn: () => api<{ items: Address[] }>('/addresses') });
  const quote = useQuery({ queryKey: ['quote', coupon, cart.data?.items.map((l) => `${l.productId}:${l.quantity}`).join(',')], enabled: !!cart.data?.items.length && !placed, queryFn: () => api<Quote>('/checkout/quote', { method: 'POST', body: coupon ? { couponCode: coupon } : {} }) });
  const f = useForm<Form>({ resolver: zodResolver(schema), defaultValues: { name: me?.name ?? '', email: me?.email ?? '', phone: me?.phone ?? '', state: '', saveAddress: true } });
  const def = saved.data?.items.find((a) => a.isDefault) ?? saved.data?.items[0];
  useEffect(() => { if (def && !f.formState.isDirty) f.reset({ name: def.fullName, email: me?.email ?? '', phone: def.phone, line1: def.line1, line2: def.line2 ?? '', city: def.city, state: def.state, postalCode: def.postalCode, saveAddress: false }); }, [def?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const useAddress = (a: Address) => f.reset({ name: a.fullName, email: me?.email ?? '', phone: a.phone, line1: a.line1, line2: a.line2 ?? '', city: a.city, state: a.state, postalCode: a.postalCode, saveAddress: false });

  const place = useMutation({
    mutationFn: async (v: Form) => {
      const body = { customer: { name: v.name, email: v.email, phone: v.phone }, address: { fullName: v.name, phone: v.phone, line1: v.line1, ...(v.line2 ? { line2: v.line2 } : {}), city: v.city, state: v.state, postalCode: v.postalCode, country: 'India' }, ...(quote.data?.coupon ? { couponCode: quote.data.coupon } : {}) };
      // Identical submissions reuse the same key, so a double-click or retry can never create two orders.
      const key = await idempotencyKey({ body, cart: cart.data?.items.map((l) => [l.productId, l.quantity]) });
      const r = await api<{ order: Order; payment: PaymentIntent }>('/checkout', { method: 'POST', body, headers: { 'Idempotency-Key': key } });
      if (v.saveAddress) await api('/addresses', { method: 'POST', body: body.address }).catch(() => {});
      return r;
    },
    onSuccess: (r) => { setPlaced(r); setErr(''); qc.invalidateQueries({ queryKey: ['cart'] }); qc.invalidateQueries({ queryKey: ['addresses'] }); },
    onError: (e) => { const fe = fieldErrors(e); const map: Record<string, keyof Form> = { 'address.postalCode': 'postalCode', 'address.phone': 'phone', 'customer.email': 'email', 'address.line1': 'line1' }; Object.entries(map).forEach(([k, v]) => fe[k] && f.setError(v, { message: fe[k] })); setErr(e instanceof ApiError && !Object.keys(fe).length ? e.message : ''); },
  });
  const issues = useMemo(() => quote.data?.issues ?? [], [quote.data]);

  if (placed) return (
    <div className="container-page max-w-2xl py-10"><h1 className="text-3xl">Almost there</h1>
      <p className="mt-2 text-muted">Order <strong>{placed.order.orderNumber}</strong> is reserved for you{placed.order.reservedUntil ? ' for a short time' : ''}. Complete payment to confirm it.</p>
      <div className="mt-6"><PaymentPanel order={placed.order} payment={placed.payment} onPaid={() => nav(`/checkout/success?order=${placed.order.id}`)} /></div>
      <p className="mt-6 text-sm"><Link to="/checkout/cancel?order=" onClick={(e) => { e.preventDefault(); nav(`/checkout/cancel?order=${placed.order.id}`); }} className="link">Pay later</Link></p>
    </div>
  );
  if (cart.isPending) return <div className="container-page py-10"><Skeleton className="h-96" /></div>;
  if (!cart.data?.items.length) return <div className="container-page"><EmptyState title="Your cart is empty" action={{ to: '/shop', label: 'Browse the shop' }} /></div>;
  const q = quote.data;
  return (
    <div className="container-page py-10">
      <h1 className="text-4xl">Checkout</h1>
      <form onSubmit={f.handleSubmit((v) => place.mutate(v))} noValidate className="mt-8 grid gap-10 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-8">
          {(err || sp.get('expired')) && <Alert>{err || 'Your reservation expired. Please check out again.'}</Alert>}
          {!!saved.data?.items.length && <section aria-labelledby="sa"><h2 id="sa" className="font-sans text-lg font-semibold">Saved addresses</h2><ul className="mt-3 flex flex-wrap gap-2">{saved.data.items.map((a) => <li key={a.id}><button type="button" className="btn btn-outline text-sm" onClick={() => useAddress(a)}>{a.label ?? a.line1}, {a.city}</button></li>)}</ul></section>}
          <fieldset className="grid gap-4 sm:grid-cols-2"><legend className="mb-3 font-sans text-lg font-semibold">Contact and delivery</legend>
            <TextField label="Full name" autoComplete="name" error={f.formState.errors.name?.message} {...f.register('name')} />
            <TextField label="Phone" type="tel" autoComplete="tel" error={f.formState.errors.phone?.message} {...f.register('phone')} />
            <TextField className="sm:col-span-2" label="Email" type="email" autoComplete="email" hint="We'll send your order updates here." error={f.formState.errors.email?.message} {...f.register('email')} />
            <TextField className="sm:col-span-2" label="Address" autoComplete="address-line1" error={f.formState.errors.line1?.message} {...f.register('line1')} />
            <TextField className="sm:col-span-2" label="Apartment, landmark (optional)" autoComplete="address-line2" {...f.register('line2')} />
            <TextField label="City" autoComplete="address-level2" error={f.formState.errors.city?.message} {...f.register('city')} />
            <SelectField label="State" autoComplete="address-level1" error={f.formState.errors.state?.message} {...f.register('state')}><option value="">Select state</option>{STATES.map((s) => <option key={s}>{s}</option>)}</SelectField>
            <TextField label="PIN code" inputMode="numeric" autoComplete="postal-code" error={f.formState.errors.postalCode?.message} {...f.register('postalCode')} />
            <TextField label="Country" value="India" readOnly hint="We currently deliver within India only." onChange={() => {}} />
            <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-forest" {...f.register('saveAddress')} /> Save this address for next time</label>
          </fieldset>
        </div>
        <aside className="card h-fit space-y-5 p-6" aria-labelledby="os"><h2 id="os" className="font-sans text-lg font-semibold">Order summary</h2>
          <ul className="space-y-3 text-sm">{cart.data.items.map((l) => <li key={l.productId} className="flex justify-between gap-3"><span>{l.product?.name} × {l.quantity}</span>{!l.issue && <Price paise={l.lineTotalPaise} />}</li>)}</ul>
          <div><label htmlFor="coupon" className="mb-1 block text-sm font-medium">Promo code</label>
            <div className="flex gap-2"><input id="coupon" className="input" value={couponInput} onChange={(e) => setCouponInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); setCoupon(couponInput.trim()); } }} /><button type="button" className="btn btn-outline" onClick={() => setCoupon(couponInput.trim())}>Apply</button></div>
            {q?.couponError && <p className="mt-1 text-sm text-[#a63a2a]" role="alert">{q.couponError}</p>}{q?.coupon && <p className="mt-1 text-sm text-forest" role="status">Code {q.coupon} applied.</p>}</div>
          {quote.isPending ? <Skeleton className="h-28" /> : q && (
            <dl className="space-y-2 border-t border-line pt-4 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd><Price paise={q.subtotalPaise} /></dd></div>
              {q.discountPaise > 0 && <div className="flex justify-between text-forest"><dt>Discount</dt><dd>−<Price paise={q.discountPaise} /></dd></div>}
              <div className="flex justify-between"><dt>Shipping</dt><dd>{q.shippingPaise === 0 ? 'Free' : <Price paise={q.shippingPaise} />}</dd></div>
              {q.taxPaise > 0 && <div className="flex justify-between"><dt>Tax</dt><dd><Price paise={q.taxPaise} /></dd></div>}
              <div className="flex justify-between border-t border-line pt-3 text-base font-semibold"><dt>Total</dt><dd><Price paise={q.totalPaise} /></dd></div>
            </dl>)}
          {issues.length > 0 && <Alert>Some items are unavailable or low in stock. <Link to="/cart" className="underline">Review your cart</Link>.</Alert>}
          <button className="btn btn-primary w-full" disabled={place.isPending || quote.isPending || issues.length > 0}>{place.isPending ? 'Reserving your order…' : 'Continue to payment'}</button>
          <p className="text-xs text-muted">Your items are held for 30 minutes while you pay. By continuing you agree to our <Link to="/terms" className="link">terms</Link>.</p>
        </aside>
      </form>
    </div>
  );
}
