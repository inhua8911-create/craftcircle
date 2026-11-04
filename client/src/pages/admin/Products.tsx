import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatDate, formatINR } from '../../lib/format';
import { useSeo } from '../../hooks/useSeo';
import { adminQuery, ErrorNote, FilterSelect, Loading, Money, PageHead, Pager, RupeeField, StatusBadge, Table, Td, paiseToRupees, toPaise, useAction } from '../../components/admin/kit';
import { Alert, TextArea } from '../../components/ui';

interface P { id: string; name: string; status: string; description: string; story?: string; materials?: string[]; dimensions?: string; stock: number; reserved: number; madeToOrder: boolean; featured: boolean; requiresReapproval: boolean; suggestedPricePaise?: number; proposedCreatorAmountPaise?: number; approvedSellingPricePaise?: number; approvedCreatorAmountPaise?: number; platformMarginPaise?: number; pricingVersion: number; images: string[]; creator?: { id: string; name: string; status: string }; pricingHistory: { version: number; sellingPricePaise: number; creatorAmountPaise: number; platformMarginPaise: number; reason?: string; at: string }[]; reviewFeedback: { note: string; at: string }[]; updatedAt: string }

export function Products() {
  useSeo({ title: 'Products', noindex: true });
  const [sp, setSp] = useSearchParams(); const tab = sp.get('tab') ?? 'pending'; const status = sp.get('status') ?? ''; const qs = sp.get('q') ?? ''; const page = Number(sp.get('page') ?? 1);
  const path = tab === 'pending' ? '/admin/products/pending' : '/admin/products';
  const q = adminQuery<{ items: P[]; total: number }>(['products', tab, status, qs, page], `${path}?${new URLSearchParams({ ...(tab !== 'pending' && status && { status }), ...(qs && { q: qs }), page: String(page) })}`);
  const tabBtn = (k: string, l: string) => <button role="tab" aria-selected={tab === k} onClick={() => setSp({ tab: k })} className={`px-4 py-2 text-sm ${tab === k ? 'bg-forest text-ivory' : 'bg-white'}`}>{l}</button>;
  return (
    <>
      <PageHead title="Products" sub="Creators propose a price; you set the final selling price and the agreed creator amount.">
        <div role="tablist" className="inline-flex overflow-hidden rounded-sm border border-line">{tabBtn('pending', 'Needs review')}{tabBtn('all', 'All products')}</div></PageHead>
      <div className="mb-4 flex flex-wrap gap-2"><input aria-label="Search products" placeholder="Search by name" className="input !w-56" value={qs} onChange={(e) => setSp({ tab, q: e.target.value })} />
        {tab === 'all' && <FilterSelect label="Status" value={status} onChange={(v) => setSp({ tab, ...(v && { status: v }) })} options={[['', 'All statuses'], ['published', 'Published'], ['approved', 'Approved'], ['paused', 'Paused'], ['changes_requested', 'Changes requested'], ['rejected', 'Rejected'], ['draft', 'Draft'], ['archived', 'Archived']]} />}</div>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : <><Table head={['Product', 'Creator', 'Status', 'Price', 'Stock', 'Updated', '']} empty={q.data.items.length ? undefined : tab === 'pending' ? 'Nothing is waiting for review.' : 'No products found.'}>
        {q.data.items.map((p) => <tr key={p.id}><Td><span className="flex items-center gap-3"><img src={p.images[0]} alt="" className="h-10 w-10 rounded-sm object-cover" /><span><strong>{p.name}</strong>{p.requiresReapproval && <span className="block text-xs text-terracotta">Edited: needs re-approval</span>}</span></span></Td><Td>{p.creator?.name}</Td><Td><StatusBadge s={p.status} /></Td>
          <Td>{p.approvedSellingPricePaise != null ? <Money paise={p.approvedSellingPricePaise} /> : p.suggestedPricePaise != null ? <span className="text-muted">suggested <Money paise={p.suggestedPricePaise} /></span> : '—'}</Td><Td>{p.madeToOrder ? 'Made to order' : p.stock}</Td><Td>{formatDate(p.updatedAt)}</Td><Td right><Link className="link" to={`/admin/products/${p.id}`}>{['submitted', 'under_review'].includes(p.status) ? 'Review' : 'Open'}</Link></Td></tr>)}</Table>
        <Pager page={page} total={q.data.total} onPage={(n) => setSp({ tab, ...(status && { status }), page: String(n) })} /></>}
    </>
  );
}

export function ProductDetail() {
  const { id } = useParams(); const act = useAction(); const q = adminQuery<{ product: P }>(['product', id], `/admin/products/${id}`);
  const p = q.data?.product;
  const [selling, setSelling] = useState<string | null>(null); const [creatorAmt, setCreatorAmt] = useState<string | null>(null); const [note, setNote] = useState(''); const [stock, setStock] = useState<string | null>(null);
  useSeo({ title: p?.name ?? 'Product', noindex: true });
  if (q.isPending) return <Loading />; if (q.isError || !p) return <ErrorNote e={q.error} />;
  const sellStr = selling ?? paiseToRupees(p.approvedSellingPricePaise ?? p.suggestedPricePaise); const crStr = creatorAmt ?? paiseToRupees(p.approvedCreatorAmountPaise ?? p.proposedCreatorAmountPaise);
  const s = toPaise(sellStr); const c = toPaise(crStr); const margin = s != null && c != null ? s - c : undefined; const bad = margin == null || margin <= 0 || c === 0;
  const reviewing = ['submitted', 'under_review'].includes(p.status); const live = ['published', 'paused'].includes(p.status);
  const review = (action: string, extra: object = {}, msg = 'Saved') => act.run(() => api(`/admin/products/${p.id}/review`, { method: 'POST', body: { action, ...(note ? { note } : {}), ...extra } }), msg).then((r) => { if (r) setNote(''); });
  return (
    <>
      <p className="mb-2 text-sm"><Link to="/admin/products" className="link">All products</Link></p>
      <PageHead title={p.name} sub={`by ${p.creator?.name ?? 'unknown'}${p.creator?.status === 'suspended' ? ' (suspended)' : ''}`}><StatusBadge s={p.status} /></PageHead>
      {act.error && <div className="mb-4"><Alert>{act.error}</Alert></div>}
      <div className="grid gap-8 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <ul className="flex flex-wrap gap-3">{p.images.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt={`${p.name} photo`} className="h-36 w-36 rounded-sm object-cover" /></a></li>)}</ul>
          <p className="whitespace-pre-line">{p.description}</p>{p.story && <p className="whitespace-pre-line text-muted">{p.story}</p>}
          <dl className="card grid grid-cols-[9rem_1fr] gap-y-2 p-4 text-sm"><dt className="text-muted">Materials</dt><dd>{p.materials?.join(', ') || '—'}</dd><dt className="text-muted">Dimensions</dt><dd>{p.dimensions || '—'}</dd><dt className="text-muted">Stock</dt><dd>{p.madeToOrder ? 'Made to order' : `${p.stock} on hand, ${p.reserved} reserved`}</dd><dt className="text-muted">Creator proposal</dt><dd>retail {p.suggestedPricePaise != null ? formatINR(p.suggestedPricePaise) : '—'}, wants {p.proposedCreatorAmountPaise != null ? formatINR(p.proposedCreatorAmountPaise) : '—'} per unit</dd></dl>
          {!!p.reviewFeedback.length && <section><h2 className="text-lg">Feedback history</h2><ul className="mt-2 space-y-1 text-sm">{p.reviewFeedback.map((f, i) => <li key={i} className="text-muted">{formatDate(f.at)}: “{f.note}”</li>)}</ul></section>}
          {!!p.pricingHistory.length && <section><h2 className="text-lg">Pricing history</h2><div className="mt-2"><Table head={['Version', 'Selling', 'Creator', 'Margin', 'Reason', 'Date']}>{p.pricingHistory.map((h) => <tr key={h.version}><Td>v{h.version}</Td><Td><Money paise={h.sellingPricePaise} /></Td><Td><Money paise={h.creatorAmountPaise} /></Td><Td><Money paise={h.platformMarginPaise} /></Td><Td>{h.reason}</Td><Td>{formatDate(h.at)}</Td></tr>)}</Table></div><p className="mt-2 text-xs text-muted">Existing orders keep the terms they were bought under.</p></section>}
        </div>
        <aside className="space-y-5" aria-label="Moderation">
          {(reviewing || p.status === 'approved' || live) && (
            <section className="card space-y-4 p-5"><h2 className="font-sans text-lg font-semibold">{reviewing ? 'Set terms and decide' : live ? 'Commercial terms' : 'Terms'}</h2>
              <RupeeField label="Final selling price" value={sellStr} onChange={setSelling} /><RupeeField label="Agreed creator amount per unit" value={crStr} onChange={setCreatorAmt} />
              <p className={`rounded-sm px-3 py-2 text-sm ${bad ? 'bg-terracotta-50 text-terracotta' : 'bg-forest-50 text-forest'}`} role="status">{margin == null ? 'Enter both amounts.' : margin <= 0 ? 'The selling price must be higher than the creator amount.' : <>Platform margin <strong>{formatINR(margin)}</strong> per unit ({s ? Math.round((margin / s) * 100) : 0}%) before discounts and costs.</>}</p>
              <p className="text-xs text-muted">Preview only: the server calculates and validates these figures. Discounts come out of the platform margin, never the creator amount.</p>
              {reviewing && <TextArea label="Note to creator (required to reject or request changes)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}
              {reviewing && <div className="flex flex-wrap gap-2">{p.status === 'submitted' && <button className="btn btn-outline" disabled={act.busy} onClick={() => review('start_review', {}, 'Review started')}>Start review</button>}
                <button className="btn btn-primary" disabled={act.busy || bad} onClick={() => review('approve', { sellingPricePaise: s, creatorAmountPaise: c, publish: true }, 'Approved and published')}>Approve and publish</button>
                <button className="btn btn-outline" disabled={act.busy || bad} onClick={() => review('approve', { sellingPricePaise: s, creatorAmountPaise: c }, 'Approved')}>Approve only</button>
                <button className="btn btn-outline" disabled={act.busy} onClick={() => review('request_changes', {}, 'Changes requested')}>Request changes</button>
                <button className="btn btn-outline text-terracotta" disabled={act.busy} onClick={() => review('reject', {}, 'Rejected')}>Reject</button></div>}
              {p.status === 'approved' && <div className="flex gap-2"><button className="btn btn-primary" disabled={act.busy} onClick={() => act.run(() => api(`/admin/products/${p.id}/publish`, { method: 'POST' }), 'Published')}>Publish</button></div>}
              {live && <><TextArea label="Reason for changing terms" rows={2} value={note} onChange={(e) => setNote(e.target.value)} /><button className="btn btn-outline" disabled={act.busy || bad || note.trim().length < 3} onClick={() => act.run(() => api(`/admin/products/${p.id}/pricing`, { method: 'PATCH', body: { sellingPricePaise: s, creatorAmountPaise: c, reason: note } }), 'New pricing version saved').then(() => setNote(''))}>Save new pricing version</button></>}
            </section>)}
          {p.status !== 'archived' && (
            <section className="card space-y-3 p-5"><h2 className="font-sans text-lg font-semibold">Merchandising</h2>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" checked={p.featured} onChange={(e) => act.run(() => api(`/admin/products/${p.id}/merchandising`, { method: 'PATCH', body: { featured: e.target.checked } }), e.target.checked ? 'Featured on the homepage' : 'Removed from featured')} /> Featured on the homepage</label>
              {!p.madeToOrder && <div className="flex items-end gap-2"><label className="text-sm"><span className="mb-1 block font-medium">Stock on hand</span><input inputMode="numeric" className="input !w-28" value={stock ?? String(p.stock)} onChange={(e) => setStock(e.target.value.replace(/\D/g, ''))} /></label><button className="btn btn-outline" disabled={act.busy || stock == null || stock === ''} onClick={() => act.run(() => api(`/admin/products/${p.id}/merchandising`, { method: 'PATCH', body: { stock: Number(stock) } }), 'Stock updated').then(() => setStock(null))}>Update</button></div>}
              <button className="btn btn-outline text-terracotta" disabled={act.busy} onClick={() => { if (confirm('Archive this listing? It will be removed from the store.')) act.run(() => api(`/admin/products/${p.id}/archive`, { method: 'POST', body: { note: 'archived by admin' } }), 'Archived'); }}>Archive listing</button></section>)}
        </aside>
      </div>
    </>
  );
}
