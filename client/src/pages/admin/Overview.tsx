import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDate, statusLabel } from '../../lib/format';
import { useSeo } from '../../hooks/useSeo';
import { adminQuery, ErrorNote, Loading, Money, PageHead, Stat } from '../../components/admin/kit';
import { Alert } from '../../components/ui';

interface Side { orders: number; gmvPaise: number; refundsPaise: number; netSalesPaise: number; creatorPayablePaise: number; creatorSettledPaise: number; platformRevenuePaise: number }
interface Ov { counts: Record<string, number>; ordersByStatus: Record<string, number>; live: Side; simulated: Side; recentActivity: { id: string; action: string; entityType: string; actorRole?: string; note?: string; at: string }[]; definitions: Record<string, string> }

export default function Overview() {
  useSeo({ title: 'Admin overview', noindex: true });
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [view, setView] = useState<'live' | 'simulated' | null>(null);
  const q = adminQuery<Ov>(['overview', from, to], `/admin/overview?${new URLSearchParams({ ...(from && { from }), ...(to && { to }) })}`);
  if (q.isPending) return <Loading />; if (q.isError) return <ErrorNote e={q.error} />;
  const o = q.data; const side = view ?? (o.live.orders === 0 && o.simulated.orders > 0 ? 'simulated' : 'live'); const m = o[side];
  return (
    <>
      <PageHead title="Overview" sub="Every figure is calculated from verified payments and the financial ledger.">
        <label className="text-sm">From <input type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">To <input type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </PageHead>
      <section aria-label="Needs attention" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Link to="/admin/applications"><Stat label="Pending applications" value={o.counts.pendingApplications} tone={o.counts.pendingApplications ? 'warn' : undefined} /></Link>
        <Link to="/admin/products"><Stat label="Products awaiting approval" value={o.counts.productsAwaitingApproval} tone={o.counts.productsAwaitingApproval ? 'warn' : undefined} /></Link>
        <Stat label="Published products" value={o.counts.publishedProducts} /><Stat label="Active creators" value={o.counts.activeCreators} /><Stat label="Customers" value={o.counts.customers} />
      </section>
      <div className="mt-10 flex flex-wrap items-center justify-between gap-3"><h2 className="text-2xl">Financials</h2>
        <div role="tablist" aria-label="Money type" className="inline-flex overflow-hidden rounded-sm border border-line">
          {(['live', 'simulated'] as const).map((k) => <button key={k} role="tab" aria-selected={side === k} onClick={() => setView(k)} className={`px-4 py-2 text-sm ${side === k ? 'bg-forest text-ivory' : 'bg-white'}`}>{k === 'live' ? 'Live (real money)' : 'Simulated (demo)'} <span className="opacity-70">· {o[k].orders} orders</span></button>)}</div></div>
      {side === 'simulated' && <div className="mt-4"><Alert tone="info"><strong>Simulated.</strong> {o.definitions.simulated}</Alert></div>}
      <section aria-label="Financial metrics" className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Gross merchandise value" value={<Money paise={m.gmvPaise} />} hint={o.definitions.gmv} />
        <Stat label="Refunds" value={<Money paise={m.refundsPaise} />} />
        <Stat label="Net sales" value={<Money paise={m.netSalesPaise} />} hint={o.definitions.netSales} />
        <Stat label="Creator earnings payable" value={<Money paise={m.creatorPayablePaise} />} hint={o.definitions.creatorPayable} />
        <Stat label="Settled creator earnings" value={<Money paise={m.creatorSettledPaise} />} hint={o.definitions.creatorSettled} />
        <Stat label="Platform revenue (gross margin)" value={<Money paise={m.platformRevenuePaise} />} hint={o.definitions.platformRevenue} />
      </section>
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="obs"><h2 id="obs" className="text-2xl">Orders by status</h2>
          <ul className="card mt-3 divide-y divide-line">{Object.entries(o.ordersByStatus).length ? Object.entries(o.ordersByStatus).map(([s, n]) => <li key={s}><Link to={`/admin/orders?status=${s}`} className="flex justify-between px-4 py-2.5 text-sm hover:bg-cream"><span>{statusLabel(s)}</span><span className="tabular-nums">{n}</span></Link></li>) : <li className="px-4 py-6 text-center text-sm text-muted">No orders yet.</li>}</ul></section>
        <section aria-labelledby="ra"><div className="flex items-baseline justify-between"><h2 id="ra" className="text-2xl">Recent activity</h2><Link to="/admin/audit" className="link text-sm">Full audit log</Link></div>
          <ul className="card mt-3 divide-y divide-line">{o.recentActivity.length ? o.recentActivity.map((a) => <li key={a.id} className="px-4 py-2.5 text-sm"><span className="font-medium">{a.action}</span> <span className="text-muted">· {a.entityType}{a.actorRole ? ` · ${a.actorRole}` : ''}</span><span className="block text-xs text-muted">{formatDate(a.at)}{a.note ? ` · ${a.note}` : ''}</span></li>) : <li className="px-4 py-6 text-center text-sm text-muted">Nothing yet.</li>}</ul></section>
      </div>
    </>
  );
}
