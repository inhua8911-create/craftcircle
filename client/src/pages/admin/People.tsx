import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatDate, statusLabel } from '../../lib/format';
import { useSeo } from '../../hooks/useSeo';
import { adminQuery, ErrorNote, FilterSelect, Loading, Money, PageHead, Pager, Stat, StatusBadge, Table, Td, useAction } from '../../components/admin/kit';
import { Alert, TextArea } from '../../components/ui';

interface App { id: string; status: string; fullName?: string; email?: string; phone?: string; city?: string; state?: string; categories?: string[]; bio?: string; links?: string[]; monthlyCapacity?: number; sampleImages: string[]; decisions: { status: string; note: string; at: string }[]; updatedAt: string }

export function Applications() {
  useSeo({ title: 'Creator applications', noindex: true });
  const [sp, setSp] = useSearchParams(); const status = sp.get('status') ?? 'submitted'; const page = Number(sp.get('page') ?? 1);
  const [open, setOpen] = useState<string | null>(null); const [note, setNote] = useState(''); const act = useAction();
  const q = adminQuery<{ items: App[]; total: number }>(['apps', status, page], `/admin/applications?status=${status}&page=${page}`);
  const decide = async (id: string, s: string) => { const r = await act.run(() => api(`/admin/applications/${id}/decision`, { method: 'POST', body: { status: s, ...(note ? { note } : {}) } }), `Application ${statusLabel(s).toLowerCase()}`); if (r) { setNote(''); setOpen(null); } };
  return (
    <>
      <PageHead title="Creator applications" sub="Approval creates the creator profile and gives the applicant access to creator tools."><FilterSelect label="Status" value={status} onChange={(v) => setSp({ status: v })} options={[['submitted', 'Submitted'], ['under_review', 'Under review'], ['more_info_requested', 'More info requested'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['draft', 'Drafts']]} /></PageHead>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : (
        <>
          <Table head={['Applicant', 'Location', 'Crafts', 'Status', 'Updated', '']} empty={q.data.items.length ? undefined : 'No applications in this state.'}>
            {q.data.items.flatMap((a) => [
              <tr key={a.id}><Td><strong>{a.fullName ?? '(no name)'}</strong><span className="block text-xs text-muted">{a.email}</span></Td><Td>{[a.city, a.state].filter(Boolean).join(', ')}</Td><Td>{a.categories?.join(', ')}</Td><Td><StatusBadge s={a.status} /></Td><Td>{formatDate(a.updatedAt)}</Td>
                <Td right><button className="link" aria-expanded={open === a.id} onClick={() => { setOpen(open === a.id ? null : a.id); setNote(''); act.clear(); }}>{open === a.id ? 'Close' : 'Review'}</button></Td></tr>,
              open === a.id && <tr key={a.id + 'd'}><td colSpan={6} className="bg-cream/60 px-4 py-5"><div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
                <div className="space-y-3 text-sm"><p>{a.bio}</p><dl className="grid grid-cols-2 gap-x-6 gap-y-1"><dt className="text-muted">Phone</dt><dd>{a.phone}</dd><dt className="text-muted">Capacity</dt><dd>{a.monthlyCapacity ?? '—'} pieces/month</dd></dl>
                  {!!a.links?.length && <ul className="space-y-1">{a.links.map((l) => <li key={l}><a className="link break-all" href={l} rel="noopener noreferrer" target="_blank">{l}</a></li>)}</ul>}
                  <ul className="flex flex-wrap gap-3">{a.sampleImages.map((u) => <li key={u}><a href={u} target="_blank" rel="noopener noreferrer"><img src={u} alt={`Work sample from ${a.fullName}`} className="h-24 w-24 rounded-sm object-cover" /></a></li>)}</ul>
                  {!!a.decisions.length && <ol className="border-l-2 border-line pl-4 text-xs text-muted">{a.decisions.map((d, i) => <li key={i}>{statusLabel(d.status)} · {formatDate(d.at)}{d.note ? ` · “${d.note}”` : ''}</li>)}</ol>}</div>
                <div className="space-y-3">{act.error && <Alert>{act.error}</Alert>}
                  {['submitted', 'under_review'].includes(a.status) ? (<><TextArea label="Note to applicant (required to reject or ask for more)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} />
                    <div className="flex flex-wrap gap-2">{a.status === 'submitted' && <button className="btn btn-outline" disabled={act.busy} onClick={() => decide(a.id, 'under_review')}>Start review</button>}
                      <button className="btn btn-primary" disabled={act.busy} onClick={() => decide(a.id, 'approved')}>Approve</button>
                      <button className="btn btn-outline" disabled={act.busy} onClick={() => decide(a.id, 'more_info_requested')}>Request info</button>
                      <button className="btn btn-outline text-terracotta" disabled={act.busy} onClick={() => decide(a.id, 'rejected')}>Reject</button></div></>) : <p className="text-sm text-muted">No actions available for this status.</p>}</div></div></td></tr>,
            ]).filter(Boolean)}
          </Table><Pager page={page} total={q.data.total} onPage={(p) => setSp({ status, page: String(p) })} /></>)}
    </>
  );
}

export function Creators() {
  useSeo({ title: 'Creators', noindex: true });
  const [sp, setSp] = useSearchParams(); const status = sp.get('status') ?? ''; const qs = sp.get('q') ?? ''; const page = Number(sp.get('page') ?? 1);
  const q = adminQuery<{ items: { id: string; slug: string; name: string; city?: string; status: string; createdAt: string }[]; total: number }>(['creators', status, qs, page], `/admin/creators?${new URLSearchParams({ ...(status && { status }), ...(qs && { q: qs }), page: String(page) })}`);
  return (
    <>
      <PageHead title="Creators"><input aria-label="Search creators" placeholder="Search by name" className="input !w-48" value={qs} onChange={(e) => setSp({ ...(status && { status }), q: e.target.value })} />
        <FilterSelect label="Status" value={status} onChange={(v) => setSp({ ...(v && { status: v }) })} options={[['', 'All'], ['active', 'Active'], ['suspended', 'Suspended']]} /></PageHead>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : <><Table head={['Creator', 'City', 'Status', 'Joined', '']} empty={q.data.items.length ? undefined : 'No creators found.'}>
        {q.data.items.map((c) => <tr key={c.id}><Td><strong>{c.name}</strong></Td><Td>{c.city ?? '—'}</Td><Td><StatusBadge s={c.status} /></Td><Td>{formatDate(c.createdAt)}</Td><Td right><Link className="link" to={`/admin/creators/${c.id}`}>Open</Link></Td></tr>)}</Table><Pager page={page} total={q.data.total} onPage={(p) => setSp({ ...(status && { status }), page: String(p) })} /></>}
    </>
  );
}

interface CD { creator: { id: string; slug: string; name: string; status: string; city?: string; state?: string; email?: string; phone?: string; payoutDetails: Record<string, string> | null }; products: Record<string, number>; balances: { pendingPaise: number; availablePaise: number; onHoldPaise: number; paidPaise: number; grossEarnedPaise: number; adjustmentsPaise: number }; sales: { unitsSold: number; confirmedSalesPaise: number }; payouts: { id: string; batchNumber: string; amountPaise: number; status: string; paymentReference?: string }[] }
export function CreatorDetail() {
  const { id } = useParams(); const [note, setNote] = useState(''); const act = useAction();
  const q = adminQuery<CD>(['creator', id], `/admin/creators/${id}`);
  useSeo({ title: q.data?.creator.name ?? 'Creator', noindex: true });
  if (q.isPending) return <Loading />; if (q.isError) return <ErrorNote e={q.error} />;
  const { creator: c, balances: b } = q.data; const suspended = c.status === 'suspended';
  return (
    <>
      <p className="mb-2 text-sm"><Link to="/admin/creators" className="link">All creators</Link></p>
      <PageHead title={c.name} sub={[c.city, c.state].filter(Boolean).join(', ')}><StatusBadge s={c.status} />{c.status === 'active' && <Link className="btn btn-outline" to={`/creators/${c.slug}`}>Public page</Link>}</PageHead>
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><Stat label="Units sold (net)" value={q.data.sales.unitsSold} /><Stat label="Confirmed sales" value={<Money paise={q.data.sales.confirmedSalesPaise} />} /><Stat label="Available to pay" value={<Money paise={b.availablePaise} />} hint="Eligible, unpaid" tone={b.availablePaise < 0 ? 'warn' : undefined} /><Stat label="Paid out" value={<Money paise={b.paidPaise} />} />
        <Stat label="Pending (return window)" value={<Money paise={b.pendingPaise} />} /><Stat label="On hold" value={<Money paise={b.onHoldPaise} />} /><Stat label="Refund adjustments" value={<Money paise={b.adjustmentsPaise} />} /><Stat label="Products" value={Object.entries(q.data.products).map(([s, n]) => `${n} ${statusLabel(s).toLowerCase()}`).join(', ') || 'None'} /></section>
      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="ct"><h2 id="ct" className="text-xl">Contact and payout details</h2>
          <dl className="card mt-3 grid grid-cols-[8rem_1fr] gap-y-2 p-4 text-sm"><dt className="text-muted">Email</dt><dd>{c.email}</dd><dt className="text-muted">Phone</dt><dd>{c.phone ?? '—'}</dd>
            {c.payoutDetails ? <><dt className="text-muted">Account holder</dt><dd>{c.payoutDetails.accountHolder}</dd><dt className="text-muted">Bank</dt><dd>{c.payoutDetails.bankName ?? '—'}</dd><dt className="text-muted">Account</dt><dd>{c.payoutDetails.accountLast4 ? `•••• ${c.payoutDetails.accountLast4}` : '—'}</dd><dt className="text-muted">IFSC</dt><dd>{c.payoutDetails.ifsc ?? '—'}</dd><dt className="text-muted">UPI</dt><dd>{c.payoutDetails.upiId ?? '—'}</dd></> : <><dt className="text-muted">Payout details</dt><dd className="text-terracotta">Not provided yet</dd></>}</dl></section>
        <section aria-labelledby="ac"><h2 id="ac" className="text-xl">{suspended ? 'Reactivate' : 'Suspend'} creator</h2>
          <div className="card mt-3 space-y-3 p-4">{act.error && <Alert>{act.error}</Alert>}<p className="text-sm text-muted">{suspended ? 'Their products return to the store and held earnings become eligible again.' : 'Their products disappear from the store, portal access is closed and unpaid earnings are put on hold (not forfeited).'}</p>
            <TextArea label="Reason (recorded in the audit log and sent to the creator)" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            <button className={`btn ${suspended ? 'btn-primary' : 'btn-outline text-terracotta'}`} disabled={act.busy || note.trim().length < 3} onClick={async () => { if (await act.run(() => api(`/admin/creators/${id}/status`, { method: 'POST', body: { action: suspended ? 'reactivate' : 'suspend', note } }), suspended ? 'Creator reactivated' : 'Creator suspended')) setNote(''); }}>{suspended ? 'Reactivate creator' : 'Suspend creator'}</button></div></section>
      </div>
      <section className="mt-8" aria-labelledby="pp"><div className="flex items-baseline justify-between"><h2 id="pp" className="text-xl">Payouts</h2><Link to="/admin/payouts" className="link text-sm">Manage payouts</Link></div>
        <div className="mt-3"><Table head={['Batch', 'Amount', 'Status', 'Bank reference']} empty={q.data.payouts.length ? undefined : 'No payouts yet.'}>{q.data.payouts.map((p) => <tr key={p.id}><Td>{p.batchNumber}</Td><Td><Money paise={p.amountPaise} /></Td><Td><StatusBadge s={p.status} /></Td><Td>{p.paymentReference ?? '—'}</Td></tr>)}</Table></div></section>
    </>
  );
}
