import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Order, PaymentIntent } from '../lib/types';
import { Alert, Price } from './ui';

declare global { interface Window { Razorpay?: new (o: Record<string, unknown>) => { open: () => void; on: (e: string, cb: () => void) => void } } }
const loadRazorpay = () => new Promise<boolean>((res) => {
  if (window.Razorpay) return res(true);
  const s = document.createElement('script'); s.src = 'https://checkout.razorpay.com/v1/checkout.js'; s.onload = () => res(true); s.onerror = () => res(false); document.body.appendChild(s);
});

/** Simulated gateway in demo mode (clearly labelled), Razorpay Checkout otherwise. The server decides what counts as paid. */
export function PaymentPanel({ order, payment, onPaid }: { order: Order; payment: PaymentIntent; onPaid: () => void }) {
  const qc = useQueryClient(); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const run = async (fn: () => Promise<void>) => { setBusy(true); setErr(''); try { await fn(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Payment could not be completed.'); } finally { setBusy(false); } };
  const done = async () => { await qc.invalidateQueries({ queryKey: ['cart'] }); await qc.invalidateQueries({ queryKey: ['orders'] }); onPaid(); };

  if (payment.provider === 'mock') return (
    <div className="card border-terracotta/40 bg-terracotta-50 p-6" aria-labelledby="sim">
      <p className="eyebrow">Demo mode</p><h2 id="sim" className="mt-1 font-sans text-lg font-semibold">Simulated payment of <Price paise={order.totalPaise} /></h2>
      <p className="mt-2 text-sm">No real payment gateway is connected. Choose an outcome to see what happens. <strong>No money is charged.</strong></p>
      {err && <div className="mt-4"><Alert>{err}</Alert></div>}
      <div className="mt-5 flex flex-wrap gap-3">
        <button className="btn btn-primary" disabled={busy} onClick={() => run(async () => { await api('/payments/mock/confirm', { method: 'POST', body: { orderId: order.id, outcome: 'success' } }); await done(); })}>Simulate successful payment</button>
        <button className="btn btn-outline" disabled={busy} onClick={() => run(async () => { await api('/payments/mock/confirm', { method: 'POST', body: { orderId: order.id, outcome: 'failure' } }); setErr('Simulated failure. Your order is still reserved; you can try again.'); })}>Simulate a failed payment</button>
      </div>
    </div>
  );
  return (
    <div className="card p-6">
      <h2 className="font-sans text-lg font-semibold">Pay <Price paise={order.totalPaise} /></h2>
      {err && <div className="mt-4"><Alert>{err}</Alert></div>}
      <button className="btn btn-primary mt-4" disabled={busy} onClick={() => run(async () => {
        if (!(await loadRazorpay()) || !window.Razorpay) throw new Error('The payment window could not be loaded.');
        const rzp = new window.Razorpay({ key: payment.keyId, order_id: payment.providerOrderId, amount: payment.amountPaise, currency: 'INR', name: 'CraftCircle', description: order.orderNumber,
          handler: (r: { razorpay_payment_id: string; razorpay_order_id: string; razorpay_signature: string }) => { void api('/payments/razorpay/verify', { method: 'POST', body: { orderId: order.id, ...r } }).then(done).catch((e) => setErr(e instanceof ApiError ? e.message : 'We could not confirm your payment yet. Check your orders shortly.')); } });
        rzp.on('payment.failed', () => setErr('The payment did not go through. You can try again.')); rzp.open();
      })}>Pay securely</button>
      <p className="mt-3 text-xs text-muted">Payments are processed by Razorpay. Card details never touch this site.</p>
    </div>
  );
}
