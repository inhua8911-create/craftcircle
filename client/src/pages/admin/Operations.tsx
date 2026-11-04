import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatDate, formatINR, statusLabel } from '../../lib/format';
import type { Order } from '../../lib/types';
import { useSeo } from '../../hooks/useSeo';
import { adminQuery, ErrorNote, FilterSelect, Loading, Money, PageHead, Pager, RupeeField, StatusBadge, Table, Td, toPaise, useAction } from '../../components/admin/kit';
import { Alert, Badge, TextField } from '../../components/ui';

const ORDER_STATUSES = ['pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'payment_failed', 'cancelled', 'partially_refunded', 'refunded', 'return_requested', 'returned'];
export function Orders() {
  useSeo({ title: 'Orders', noindex: true });
  const [sp, setSp] = useSearchParams(); const status = sp.get('status') ?? ''; const qs = sp.get('q') ?? ''; const page = Number(sp.get('page') ?? 1);
  const q = adminQuery<{ items: { id: string; orderNumber: string; status: string; paymentStatus: string; simulated: boolean; customerName: string; totalPaise: number; createdAt: string }[]; total: number }>(['orders', status, qs, page], `/admin/orders?${new URLSearchParams({ ...(status && { status }), ...(qs && { q: qs }), page: String(page) })}`);
  return (
    <>
      <PageHead title="Orders"><input aria-label="Search orders" placeholder="Order number, name or email" className="input !w-60" value={qs} onChange={(e) => setSp({ ...(status && { status }), q: e.target.value })} />
        <FilterSelect label="Status" value={status} onChange={(v) => setSp({ ...(v && { status: v }) })} options={[['', 'All statuses'], ...ORDER_STATUSES.map((s) => [s, statusLabel(s)] as [string, string])]} /></PageHead>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : <><Table head={['Order', 'Customer', 'Status', 'Payment', 'Total', 'Placed', '']} empty={q.data.items.length ? undefined : 'No orders found.'}>
        {q.data.items.map((o) => <tr key={o.id}><Td><strong>{o.orderNumber}</strong>{o.simulated && <span className="ml-2"><Badge tone="rose">Simulated</Badge></span>}</Td><Td>{o.customerName}</Td><Td><StatusBadge s={o.status} /></Td><Td><StatusBadge s={o.paymentStatus} /></Td><Td right><Money paise={o.totalPaise} /></Td><Td>{formatDate(o.createdAt)}</Td><Td right><Link className="link" to={`/admin/orders/${o.id}`}>Open</Link></Td></tr>)}</Table>
        <Pager page={page} total={q.data.total} onPage={(p) => setSp({ ...(status && { status }), ...(qs && { q: qs }), page: String(p) })} /></>}
    </>
  );
}

type AO = Omit<Order, 'items'> & { customer: { name: string; email: string; phone?: string }; history: { from: string; to: string; note?: string; at: string }[]; items: (Order['items'][number] & { creatorAmountPerUnitPaise: number; platformMarginPerUnitPaise: number; discountAllocatedPaise: number; pricingVersion: number })[]; payments: { id: string; provider: string; simulated: boolean; status: string; amountPaise: number; providerPaymentId?: string; failureReason?: string }[] };
const SETTABLE = ['processing', 'shipped', 'delivered', 'cancelled', 'return_requested', 'returned'];
export function OrderDetail() {
  const { id } = useParams(); const act = useAction(); const q = adminQuery<{ order: AO; allowedNext: string[] }>(['order', id], `/admin/orders/${id}`);
  const [next, setNext] = useState(''); const [provider, setProvider] = useState(''); const [tracking, setTracking] = useState(''); const [note, setNote] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({}); const [reason, setReason] = useState(''); const [provRef, setProvRef] = useState(''); const [refundShip, setRefundShip] = useState(false); const [rkey, setRkey] = useState(() => crypto.randomUUID());
  useSeo({ title: q.data ? `Order ${q.data.order.orderNumber}` : 'Order', noindex: true });
  const o = q.data?.order;
  const lines = useMemo(() => (o?.items ?? []).map((i) => ({ orderItemId: i.id, quantity: Number(qty[i.id] || 0) })).filter((l) => l.quantity > 0), [o, qty]);
  if (q.isPending) return <Loading />; if (q.isError || !o) return <ErrorNote e={q.error} />;
  const options = q.data.allowedNext.filter((s) => SETTABLE.includes(s)); const canRefund = ['paid', 'partially_refunded'].includes(o.paymentStatus) || (['shipped', 'delivered', 'processing', 'returned', 'return_requested'].includes(o.status) && o.paymentStatus !== 'refunded');
  const refundable = Math.max(0, o.totalPaise - o.refundedPaise);
  return (
    <>
      <p className="mb-2 text-sm"><Link to="/admin/orders" className="link">All orders</Link></p>
      <PageHead title={`Order ${o.orderNumber}`} sub={`Placed ${formatDate(o.createdAt)}`}><StatusBadge s={o.status} /><StatusBadge s={o.paymentStatus} />{o.simulated && <Badge tone="rose">Simulated payment</Badge>}</PageHead>
      {act.error && <div className="mb-4"><Alert>{act.error}</Alert></div>}
      <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-8">
          <Table head={['Item', 'Qty', 'Unit', 'Discount', 'Creator amount', 'Margin / unit', 'Line total']}>{o.items.map((i) => <tr key={i.id}><Td>{i.name}<span className="block text-xs text-muted">terms v{i.pricingVersion}{i.refundedQuantity ? ` · ${i.refundedQuantity} refunded` : ''}</span></Td><Td right>{i.quantity}</Td><Td right><Money paise={i.unitPricePaise} /></Td><Td right><Money paise={i.discountAllocatedPaise} /></Td><Td right><Money paise={i.creatorAmountPerUnitPaise} /></Td><Td right><Money paise={i.platformMarginPerUnitPaise} /></Td><Td right><Money paise={i.lineTotalPaise} /></Td></tr>)}</Table>
          <dl className="ml-auto max-w-xs space-y-1.5 text-sm">{([['Subtotal', o.subtotalPaise], ['Discount', -o.discountPaise], ['Shipping', o.shippingPaise], ['Tax', o.taxPaise]] as [string, number][]).map(([l, v]) => <div key={l} className="flex justify-between"><dt>{l}</dt><dd><Money paise={v} /></dd></div>)}<div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd><Money paise={o.totalPaise} /></dd></div>{o.refundedPaise > 0 && <div className="flex justify-between text-terracotta"><dt>Refunded</dt><dd><Money paise={o.refundedPaise} /></dd></div>}</dl>
          <section aria-labelledby="pay"><h2 id="pay" className="mb-2 text-lg">Payments</h2><Table head={['Provider', 'Status', 'Amount', 'Reference']} empty={o.payments.length ? undefined : 'No payment attempts.'}>{o.payments.map((p) => <tr key={p.id}><Td>{p.provider}{p.simulated && <span className="ml-2"><Badge tone="rose">Simulated</Badge></span>}</Td><Td><StatusBadge s={p.status} />{p.failureReason && <span className="block text-xs text-terracotta">{p.failureReason}</span>}</Td><Td><Money paise={p.amountPaise} /></Td><Td>{p.providerPaymentId ?? '—'}</Td></tr>)}</Table></section>
          <section aria-labelledby="hist"><h2 id="hist" className="mb-2 text-lg">History</h2><ol className="space-y-1 border-l-2 border-line pl-4 text-sm">{o.history.map((h, i) => <li key={i}><strong>{statusLabel(h.to)}</strong> <span className="text-muted">· {formatDate(h.at)}{h.note ? ` · ${h.note}` : ''}</span></li>)}</ol></section>
        </div>
        <aside className="space-y-5">
          <section className="card p-5 text-sm"><h2 className="font-sans text-base font-semibold">Customer</h2><p className="mt-2">{o.customer.name}</p><p className="text-muted">{o.customer.email}{o.customer.phone ? ` · ${o.customer.phone}` : ''}</p>
            <address className="mt-3 not-italic text-muted">{o.shippingAddress.line1}{o.shippingAddress.line2 ? `, ${o.shippingAddress.line2}` : ''}<br />{o.shippingAddress.city}, {o.shippingAddress.state} {o.shippingAddress.postalCode}</address>
            {o.shipment?.trackingNumber && <p className="mt-3">Shipped via <strong>{o.shipment.provider}</strong> · {o.shipment.trackingNumber}</p>}</section>
          <section className="card space-y-3 p-5"><h2 className="font-sans text-base font-semibold">Update fulfilment</h2>
            {options.length ? <><label className="block text-sm"><span className="mb-1 block font-medium">Move to</span><select className="input" value={next} onChange={(e) => setNext(e.target.value)}><option value="">Choose a status</option>{options.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
              {next === 'shipped' && <><TextField label="Courier / provider" value={provider} onChange={(e) => setProvider(e.target.value)} /><TextField label="Tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} /><p className="text-xs text-muted">Both are required before an order can be marked shipped.</p></>}
              <TextField label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
              <button className="btn btn-primary" disabled={act.busy || !next || (next === 'shipped' && (!provider.trim() || !tracking.trim()))} onClick={() => act.run(() => api(`/admin/orders/${o.id}/status`, { method: 'PATCH', body: { status: next, ...(note && { note }), ...(next === 'shipped' && { shipment: { provider, trackingNumber: tracking } }) } }), `Order ${statusLabel(next).toLowerCase()}`).then((r) => { if (r) { setNext(''); setNote(''); setTracking(''); setProvider(''); } })}>Update status</button></> : <p className="text-sm text-muted">No fulfilment changes are available from “{statusLabel(o.status)}”. Payment states change only from verified payment events and refunds.</p>}</section>
          {canRefund && refundable > 0 && (
            <section className="card space-y-3 p-5"><h2 className="font-sans text-base font-semibold">Record a refund</h2>
              <p className="text-xs text-muted">{o.simulated ? 'Simulated order: no real money moves.' : 'This app does not send money. Refund in the payment provider first, then record its reference here.'}</p>
              {o.items.map((i) => { const left = i.quantity - i.refundedQuantity; return left > 0 ? <label key={i.id} className="flex items-center justify-between gap-3 text-sm"><span>{i.name} <span className="text-muted">(up to {left})</span></span><input aria-label={`Units to refund for ${i.name}`} inputMode="numeric" className="input !w-16" value={qty[i.id] ?? ''} onChange={(e) => setQty({ ...qty, [i.id]: e.target.value.replace(/\D/g, '').slice(0, 3) })} /></label> : null; })}
              {o.shippingPaise > 0 && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" checked={refundShip} onChange={(e) => setRefundShip(e.target.checked)} /> Also refund shipping ({formatINR(o.shippingPaise)}), together with the items above</label>}
              <TextField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />{!o.simulated && <TextField label="Provider refund reference" value={provRef} onChange={(e) => setProvRef(e.target.value)} />}
              <button className="btn btn-outline" disabled={act.busy || !lines.length || reason.trim().length < 3 || (!o.simulated && !provRef.trim())} onClick={() => act.run(() => api(`/admin/orders/${o.id}/refund`, { method: 'POST', headers: { 'Idempotency-Key': rkey }, body: { lines, ...(refundShip && { shippingRefundPaise: o.shippingPaise }), reason, ...(provRef && { providerRefundId: provRef }) } }), 'Refund recorded').then((r) => { if (r) { setQty({}); setReason(''); setProvRef(''); setRefundShip(false); setRkey(crypto.randomUUID()); } })}>Record refund</button>
              <p className="text-xs text-muted">Refundable balance: {formatINR(refundable)}. Retrying the same form never refunds twice.</p></section>)}
        </aside>
      </div>
    </>
  );
}

interface Pay { id: string; batchNumber: string; creatorId: string; creatorName?: string; amountPaise: number; status: string; paymentReference?: string; failureReason?: string; simulated: boolean; createdAt: string }
export function Payouts() {
  useSeo({ title: 'Payouts', noindex: true });
  const [status, setStatus] = useState(''); const act = useAction(); const [mode, setMode] = useState<{ id: string; kind: 'pay' | 'fail' } | null>(null); const [text, setText] = useState('');
  const bal = adminQuery<{ items: { creatorId: string; name?: string; pendingPaise: number; availablePaise: number; onHoldPaise: number; paidPaise: number }[] }>(['balances'], '/admin/payouts/balances');
  const list = adminQuery<{ items: Pay[] }>(['payouts', status], `/admin/payouts${status ? `?status=${status}` : ''}`);
  const post = (id: string, verb: string, body?: object, msg?: string) => act.run(() => api(`/admin/payouts/${id}/${verb}`, { method: 'POST', body }), msg).then((r) => { if (r) { setMode(null); setText(''); } });
  return (
    <>
      <PageHead title="Payouts" sub="Manual bank-transfer reconciliation. This app records transfers made outside it and never moves money itself." />
      {act.error && <div className="mb-4"><Alert>{act.error}</Alert></div>}
      <section aria-labelledby="bal"><h2 id="bal" className="mb-3 text-xl">Creator balances</h2>
        {bal.isPending ? <Loading /> : bal.isError ? <ErrorNote e={bal.error} /> : <Table head={['Creator', 'Pending', 'Available', 'On hold', 'Paid out', '']} empty={bal.data.items.length ? undefined : 'No earnings yet.'}>
          {bal.data.items.map((b) => <tr key={b.creatorId}><Td><Link className="link" to={`/admin/creators/${b.creatorId}`}>{b.name ?? b.creatorId}</Link></Td><Td right><Money paise={b.pendingPaise} /></Td><Td right><Money paise={b.availablePaise} /></Td><Td right><Money paise={b.onHoldPaise} /></Td><Td right><Money paise={b.paidPaise} /></Td>
            <Td right><button className="btn btn-outline !min-h-9 !py-1" disabled={act.busy || b.availablePaise <= 0} onClick={() => act.run(() => api('/admin/payouts', { method: 'POST', body: { creatorId: b.creatorId } }), 'Payout drafted')}>Create payout draft</button></Td></tr>)}</Table>}
        <p className="mt-2 text-xs text-muted">Pending = still inside the return window. Negative available = a refund after payout (recovered from the next payout).</p></section>
      <section className="mt-10" aria-labelledby="pl"><div className="mb-3 flex items-center justify-between"><h2 id="pl" className="text-xl">Payout batches</h2><FilterSelect label="Status" value={status} onChange={setStatus} options={[['', 'All'], ['draft', 'Draft'], ['approved', 'Approved'], ['paid', 'Paid'], ['failed', 'Failed'], ['cancelled', 'Cancelled']]} /></div>
        {list.isPending ? <Loading /> : list.isError ? <ErrorNote e={list.error} /> : <Table head={['Batch', 'Creator', 'Amount', 'Status', 'Reference', 'Actions']} empty={list.data.items.length ? undefined : 'No payouts.'}>
          {list.data.items.map((p) => <tr key={p.id}><Td>{p.batchNumber}<span className="block text-xs text-muted">{formatDate(p.createdAt)}</span></Td><Td>{p.creatorName ?? p.creatorId}</Td><Td right><Money paise={p.amountPaise} />{p.simulated && <span className="ml-2"><Badge tone="rose">Simulated</Badge></span>}</Td><Td><StatusBadge s={p.status} />{p.failureReason && <span className="block text-xs text-terracotta">{p.failureReason}</span>}</Td><Td>{p.paymentReference ?? '—'}</Td>
            <Td>{mode?.id === p.id ? <div className="flex items-end gap-2"><TextField label={mode.kind === 'pay' ? 'Bank transfer reference' : 'Failure reason'} value={text} onChange={(e) => setText(e.target.value)} /><button className="btn btn-primary !min-h-10" disabled={act.busy || text.trim().length < 3} onClick={() => post(p.id, mode.kind, mode.kind === 'pay' ? { reference: text } : { reason: text }, mode.kind === 'pay' ? 'Recorded as paid' : 'Marked failed')}>Save</button><button className="btn btn-ghost !min-h-10" onClick={() => setMode(null)}>Cancel</button></div> : (
              <div className="flex flex-wrap gap-x-4 gap-y-1">{p.status === 'draft' && <button className="link" disabled={act.busy} onClick={() => post(p.id, 'approve', undefined, 'Payout approved')}>Approve</button>}
                {p.status === 'approved' && <><button className="link" onClick={() => { setMode({ id: p.id, kind: 'pay' }); setText(''); }}>Mark paid</button><button className="link" onClick={() => { setMode({ id: p.id, kind: 'fail' }); setText(''); }}>Mark failed</button></>}
                {['draft', 'approved'].includes(p.status) && <button className="link text-terracotta" disabled={act.busy} onClick={() => post(p.id, 'cancel', {}, 'Payout cancelled')}>Cancel</button>}
                <a className="link" href={`/api/v1/admin/payouts/${p.id}/statement?format=csv`}>Statement (CSV)</a></div>)}</Td></tr>)}</Table>}</section>
    </>
  );
}
export { toPaise, RupeeField };
