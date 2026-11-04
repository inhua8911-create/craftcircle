import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDate, formatINR, statusLabel } from '../../lib/format';
import { useSeo } from '../../hooks/useSeo';
import { creatorQuery, ErrorNote, FilterSelect, Loading, Money, PageHead, Pager, Stat, StatusBadge, Table, Td } from '../../components/admin/kit';
import { NotificationsList, useNotifications } from '../../components/creator/Layout';
import { Alert, Badge } from '../../components/ui';

interface Dash { products: { published: number; pendingReview: number; changesRequested: number; draft: number }; inventory: { unitsOnHand: number; lowStockProducts: number }; sales: { unitsSold: number; confirmedSalesPaise: number }; earnings: { pendingPaise: number; availablePaise: number; onHoldPaise: number; paidOutPaise: number; adjustmentsPaise: number };
  topProducts: { productId: string; name: string; units: number; salesPaise: number }[]; recentOrders: { orderNumber: string; status: string; productName: string; quantity: number; createdAt: string }[]; recentPayouts: { id: string; batchNumber: string; amountPaise: number; status: string; paymentReference?: string; paidAt?: string }[]; definitions: Record<string, string> }

export function Dashboard() {
  useSeo({ title: 'Creator dashboard', noindex: true });
  const q = creatorQuery<Dash>(['dashboard'], '/creator/dashboard'); const prof = creatorQuery<{ payoutDetails: unknown }>(['profile'], '/creator/profile'); const notes = useNotifications();
  if (q.isPending) return <Loading />; if (q.isError) return <ErrorNote e={q.error} />;
  const d = q.data; const todo: { to: string; text: string }[] = [];
  if (d.products.changesRequested) todo.push({ to: '/creator/products?status=changes_requested', text: `${d.products.changesRequested} product${d.products.changesRequested > 1 ? 's need' : ' needs'} changes before approval` });
  if (d.inventory.lowStockProducts) todo.push({ to: '/creator/products', text: `${d.inventory.lowStockProducts} product${d.inventory.lowStockProducts > 1 ? 's are' : ' is'} low on stock` });
  if (prof.data && !prof.data.payoutDetails) todo.push({ to: '/creator/profile', text: 'Add your payout details so we can pay you' });
  if (d.earnings.availablePaise > 0) todo.push({ to: '/creator/earnings', text: `${formatINR(d.earnings.availablePaise)} is ready for the next payout batch` });
  if (notes.data?.unread) todo.push({ to: '/creator/notifications', text: `${notes.data.unread} unread notification${notes.data.unread > 1 ? 's' : ''}` });
  return (
    <>
      <PageHead title="Dashboard" sub="Every figure comes from verified orders and your earnings statement." />
      {todo.length > 0 && <section aria-labelledby="todo" className="mb-8"><h2 id="todo" className="mb-2 text-xl">Needs your attention</h2><ul className="card divide-y divide-line">{todo.map((t) => <li key={t.text}><Link to={t.to} className="flex justify-between px-4 py-3 text-sm hover:bg-cream">{t.text}<span aria-hidden>→</span></Link></li>)}</ul></section>}
      <section aria-label="Products" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Live products" value={d.products.published} /><Stat label="In review" value={d.products.pendingReview} /><Stat label="Drafts" value={d.products.draft} /><Stat label="Units in stock" value={d.inventory.unitsOnHand} hint={d.inventory.lowStockProducts ? `${d.inventory.lowStockProducts} low on stock` : undefined} /></section>
      <h2 className="mb-3 mt-10 text-2xl">Sales</h2>
      <section aria-label="Sales" className="grid gap-3 sm:grid-cols-2"><Stat label="Units sold" value={d.sales.unitsSold} hint="After refunds. Cancelled and failed orders never count." /><Stat label="Confirmed sales" value={<Money paise={d.sales.confirmedSalesPaise} />} hint={d.definitions.confirmedSales} /></section>
      <h2 className="mb-1 mt-10 text-2xl">Your earnings</h2><p className="mb-3 text-sm text-muted">{d.definitions.earnings}</p>
      <section aria-label="Earnings" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Pending" value={<Money paise={d.earnings.pendingPaise} />} hint={d.definitions.pending} /><Stat label="Available" value={<Money paise={d.earnings.availablePaise} />} hint={d.definitions.available} /><Stat label="Paid out" value={<Money paise={d.earnings.paidOutPaise} />} hint={d.definitions.paidOut} /><Stat label="Refund adjustments" value={<Money paise={d.earnings.adjustmentsPaise} />} hint="Deducted when an order is refunded." /></section>
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="tp"><h2 id="tp" className="mb-3 text-xl">Best sellers</h2><Table head={['Product', 'Units', 'Sales']} empty={d.topProducts.length ? undefined : 'No sales yet.'}>{d.topProducts.map((p) => <tr key={p.productId}><Td>{p.name}</Td><Td right>{p.units}</Td><Td right><Money paise={p.salesPaise} /></Td></tr>)}</Table></section>
        <section aria-labelledby="ro"><h2 id="ro" className="mb-3 text-xl">Recent orders</h2><Table head={['Order', 'Item', 'Qty', 'Date']} empty={d.recentOrders.length ? undefined : 'No orders yet.'}>{d.recentOrders.map((o) => <tr key={o.orderNumber + o.productName}><Td>{o.orderNumber}</Td><Td>{o.productName}</Td><Td right>{o.quantity}</Td><Td>{formatDate(o.createdAt)}</Td></tr>)}</Table><p className="mt-2 text-xs text-muted">Customer details are never shown to creators.</p></section>
      </div>
      <section className="mt-10" aria-labelledby="rp"><div className="mb-3 flex items-baseline justify-between"><h2 id="rp" className="text-xl">Recent payouts</h2><Link to="/creator/earnings" className="link text-sm">Full statement</Link></div>
        <Table head={['Batch', 'Amount', 'Status', 'Bank reference']} empty={d.recentPayouts.length ? undefined : 'No payouts yet.'}>{d.recentPayouts.map((p) => <tr key={p.id}><Td>{p.batchNumber}</Td><Td><Money paise={p.amountPaise} /></Td><Td><StatusBadge s={p.status} /></Td><Td>{p.paymentReference ?? '—'}</Td></tr>)}</Table></section>
    </>
  );
}

interface Row { id: string; orderNumber: string; product: string; quantity: number; amountPerUnitPaise: number; grossPaise: number; adjustmentPaise: number; status: string; paidPaise: number; remainingPaise: number; payoutReference: string | null; simulated: boolean; date: string }
interface Pay { id: string; batchNumber: string; amountPaise: number; status: string; paymentReference: string | null; paidAt?: string; simulated: boolean }
export function Earnings() {
  useSeo({ title: 'Earnings', noindex: true });
  const [sp, setSp] = useSearchParams(); const status = sp.get('status') ?? ''; const page = Number(sp.get('page') ?? 1);
  const q = creatorQuery<{ items: Row[]; total: number; balances: { pendingPaise: number; availablePaise: number; onHoldPaise: number; paidPaise: number; grossEarnedPaise: number; adjustmentsPaise: number } }>(['earnings', status, page], `/creator/earnings?${new URLSearchParams({ ...(status && { status }), page: String(page) })}`);
  const pays = creatorQuery<{ items: Pay[] }>(['payouts'], '/creator/payouts');
  return (
    <>
      <PageHead title="Earnings" sub="One line per item sold. Earnings are your agreed per-unit amount, created only from verified payments."><a className="btn btn-outline" href={`/api/v1/creator/earnings?${new URLSearchParams({ ...(status && { status }), format: 'csv' })}`}>Download CSV</a></PageHead>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : (<>
        <section aria-label="Balances" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5"><Stat label="Gross earned" value={<Money paise={q.data.balances.grossEarnedPaise} />} /><Stat label="Pending" value={<Money paise={q.data.balances.pendingPaise} />} hint="Inside the return window" /><Stat label="Available" value={<Money paise={q.data.balances.availablePaise} />} /><Stat label="On hold" value={<Money paise={q.data.balances.onHoldPaise} />} /><Stat label="Paid out" value={<Money paise={q.data.balances.paidPaise} />} /></section>
        <div className="mb-3 mt-8 flex items-center justify-between"><h2 className="text-xl">Statement</h2><FilterSelect label="Status" value={status} onChange={(v) => setSp(v ? { status: v } : {})} options={[['', 'All statuses'], ['pending', 'Pending'], ['eligible', 'Eligible'], ['approved', 'Approved'], ['paid', 'Paid'], ['on_hold', 'On hold'], ['adjusted', 'Adjusted']]} /></div>
        <Table head={['Order', 'Product', 'Qty', 'Per unit', 'Gross', 'Adjustment', 'Status', 'Paid', 'Remaining', 'Reference']} empty={q.data.items.length ? undefined : 'No earnings yet.'}>
          {q.data.items.map((r) => <tr key={r.id}><Td>{r.orderNumber}<span className="block text-xs text-muted">{formatDate(r.date)}</span></Td><Td>{r.product}{r.simulated && <span className="ml-1"><Badge tone="rose">Demo</Badge></span>}</Td><Td right>{r.quantity}</Td><Td right><Money paise={r.amountPerUnitPaise} /></Td><Td right><Money paise={r.grossPaise} /></Td><Td right><Money paise={r.adjustmentPaise} /></Td><Td><StatusBadge s={r.status} /></Td><Td right><Money paise={r.paidPaise} /></Td><Td right><Money paise={r.remainingPaise} /></Td><Td>{r.payoutReference ?? '—'}</Td></tr>)}</Table>
        <Pager page={page} total={q.data.total} onPage={(p) => setSp({ ...(status && { status }), page: String(p) })} />
        <section className="mt-10" aria-labelledby="po"><h2 id="po" className="mb-3 text-xl">Payouts</h2>
          <Table head={['Batch', 'Amount', 'Status', 'Bank reference', 'Paid on', '']} empty={pays.data?.items.length ? undefined : 'No payouts yet.'}>{pays.data?.items.map((p) => <tr key={p.id}><Td>{p.batchNumber}{p.simulated && <span className="ml-1"><Badge tone="rose">Demo</Badge></span>}</Td><Td><Money paise={p.amountPaise} /></Td><Td><StatusBadge s={p.status} /></Td><Td>{p.paymentReference ?? '—'}</Td><Td>{p.paidAt ? formatDate(p.paidAt) : '—'}</Td><Td right><a className="link" href={`/api/v1/creator/payouts/${p.id}/statement?format=csv`}>Statement (CSV)</a></Td></tr>)}</Table>
          <p className="mt-2 text-xs text-muted">Payouts are bank transfers recorded by our team, with a reference you can match against your bank statement.</p></section></>)}
    </>
  );
}

interface Inc { campaignId: string; name: string; description: string; eligibility?: string; metric: 'units_sold' | 'gross_sales'; threshold: number; rewardPaise: number; startsAt: string; endsAt: string; progress: number; status: string; running: boolean }
export function Incentives() {
  useSeo({ title: 'Incentives', noindex: true });
  const q = creatorQuery<{ items: Inc[]; note: string }>(['incentives'], '/creator/incentives');
  return (
    <>
      <PageHead title="Incentives" sub="Optional bonuses with published rules." />
      <div className="mb-6"><Alert tone="info">{q.data?.note ?? 'Incentives are optional bonuses with the rules shown. They are not guaranteed earnings.'}</Alert></div>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : !q.data.items.length ? <p className="text-muted">No incentive campaigns are running right now.</p> : (
        <ul className="grid gap-4 lg:grid-cols-2">{q.data.items.map((c) => { const money = c.metric === 'gross_sales'; const pct = Math.min(100, Math.round((c.progress / c.threshold) * 100)); const show = (n: number) => (money ? formatINR(n) : `${n} units`);
          return <li key={c.campaignId} className="card p-5"><div className="flex items-start justify-between gap-3"><h2 className="font-sans text-lg font-semibold">{c.name}</h2><StatusBadge s={c.status} /></div>
            <p className="mt-2 text-sm">{c.description}</p><dl className="mt-3 grid grid-cols-[8rem_1fr] gap-y-1 text-sm"><dt className="text-muted">Goal</dt><dd>{show(c.threshold)} sold</dd><dt className="text-muted">Reward</dt><dd>{formatINR(c.rewardPaise)}</dd><dt className="text-muted">Period</dt><dd>{formatDate(c.startsAt)} to {formatDate(c.endsAt)}{c.running ? '' : ' (not running)'}</dd>{c.eligibility && <><dt className="text-muted">Who qualifies</dt><dd>{c.eligibility}</dd></>}</dl>
            <div className="mt-4"><div className="flex justify-between text-sm"><span>Progress</span><span className="tabular-nums">{show(c.progress)} of {show(c.threshold)}</span></div><div className="mt-1 h-2 rounded-sm bg-cream" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={`${c.name} progress`}><div className="h-2 rounded-sm bg-forest" style={{ width: `${pct}%` }} /></div></div>
            {c.status === 'earned' && <p className="mt-3 text-sm text-forest">You've reached the goal. Our team confirms and pays bonuses separately.</p>}</li>; })}</ul>)}
    </>
  );
}
export function NotificationsPage() { useSeo({ title: 'Notifications', noindex: true }); return <><PageHead title="Notifications" /><NotificationsList /></>; }
export { statusLabel };
