import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatDate, formatINR } from '../../lib/format';
import { useMe } from '../../hooks/queries';
import { useSeo } from '../../hooks/useSeo';
import { adminQuery, ErrorNote, FilterSelect, Loading, PageHead, Pager, RupeeField, StatusBadge, Table, Td, paiseToRupees, toPaise, useAction } from '../../components/admin/kit';
import { Alert, Badge, SelectField, TextField } from '../../components/ui';

interface Coupon { id: string; code: string; type: 'percent' | 'fixed'; value: number; minOrderPaise: number; maxDiscountPaise?: number; startsAt: string; endsAt: string; usageLimit?: number; usedCount: number; perUserLimit: number; active: boolean }
const iso = (local: string) => (local ? new Date(local).toISOString() : '');
export function Promotions() {
  useSeo({ title: 'Promotions', noindex: true });
  const act = useAction(); const q = adminQuery<{ items: Coupon[] }>(['coupons'], '/admin/coupons');
  const [f, setF] = useState({ code: '', type: 'percent', value: '10', min: '', max: '', startsAt: '', endsAt: '', limit: '', perUser: '1' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const create = async () => {
    const value = f.type === 'percent' ? Number(f.value) : toPaise(f.value);
    const r = await act.run(() => api('/admin/coupons', { method: 'POST', body: { code: f.code, type: f.type, value, ...(toPaise(f.min) ? { minOrderPaise: toPaise(f.min) } : {}), ...(toPaise(f.max) ? { maxDiscountPaise: toPaise(f.max) } : {}), startsAt: iso(f.startsAt), endsAt: iso(f.endsAt), ...(f.limit ? { usageLimit: Number(f.limit) } : {}), perUserLimit: Number(f.perUser || 1) } }), 'Promo code created');
    if (r) setF({ code: '', type: 'percent', value: '10', min: '', max: '', startsAt: '', endsAt: '', limit: '', perUser: '1' });
  };
  const now = Date.now();
  return (
    <>
      <PageHead title="Promotions" sub="Discounts are funded from platform margin and never reduce a creator's agreed amount. A code that would make an item's margin negative is refused at checkout." />
      <section className="card mb-8 p-5" aria-labelledby="nc"><h2 id="nc" className="font-sans text-lg font-semibold">New promo code</h2>
        {act.error && <div className="mt-3"><Alert>{act.error}</Alert></div>}
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label="Code" value={f.code} onChange={set('code')} hint="Letters, numbers, - or _" />
          <SelectField label="Type" value={f.type} onChange={set('type')}><option value="percent">Percentage off</option><option value="fixed">Fixed amount off</option></SelectField>
          {f.type === 'percent' ? <TextField label="Percent (1 to 100)" inputMode="numeric" value={f.value} onChange={set('value')} /> : <RupeeField label="Amount off" value={f.value} onChange={(v) => setF({ ...f, value: v })} />}
          <RupeeField label="Minimum order (optional)" value={f.min} onChange={(v) => setF({ ...f, min: v })} />
          <RupeeField label="Maximum discount (optional)" value={f.max} onChange={(v) => setF({ ...f, max: v })} />
          <TextField label="Starts" type="datetime-local" value={f.startsAt} onChange={set('startsAt')} /><TextField label="Ends" type="datetime-local" value={f.endsAt} onChange={set('endsAt')} />
          <TextField label="Total uses (optional)" inputMode="numeric" value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value.replace(/\D/g, '') })} /><TextField label="Uses per customer" inputMode="numeric" value={f.perUser} onChange={(e) => setF({ ...f, perUser: e.target.value.replace(/\D/g, '') })} /></div>
        <p className="mt-3 text-xs text-muted">Code, type and value can't be changed after creation. Create a new code instead.</p>
        <button className="btn btn-primary mt-4" disabled={act.busy || !f.code || !f.startsAt || !f.endsAt} onClick={create}>Create code</button></section>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : <Table head={['Code', 'Discount', 'Window', 'Used', 'State', '']} empty={q.data.items.length ? undefined : 'No promo codes yet.'}>
        {q.data.items.map((c) => { const live = c.active && new Date(c.startsAt).getTime() <= now && new Date(c.endsAt).getTime() >= now; return <tr key={c.id}><Td><strong>{c.code}</strong></Td><Td>{c.type === 'percent' ? `${c.value}% off` : `${formatINR(c.value)} off`}{c.maxDiscountPaise ? ` (max ${formatINR(c.maxDiscountPaise)})` : ''}{c.minOrderPaise ? ` · min ${formatINR(c.minOrderPaise)}` : ''}</Td><Td>{formatDate(c.startsAt)} to {formatDate(c.endsAt)}</Td><Td>{c.usedCount}{c.usageLimit ? ` / ${c.usageLimit}` : ''}</Td><Td>{live ? <Badge>Live</Badge> : c.active ? <Badge tone="muted">Scheduled or ended</Badge> : <Badge tone="rose">Off</Badge>}</Td>
          <Td right><button className="link" disabled={act.busy} onClick={() => act.run(() => api(`/admin/coupons/${c.id}`, { method: 'PATCH', body: { active: !c.active } }), c.active ? 'Code turned off' : 'Code turned on')}>{c.active ? 'Turn off' : 'Turn on'}</button></Td></tr>; })}</Table>}
    </>
  );
}

export function Reports() {
  useSeo({ title: 'Reports', noindex: true });
  const [sp, setSp] = useSearchParams(); const type = sp.get('type') ?? 'orders'; const from = sp.get('from') ?? ''; const to = sp.get('to') ?? '';
  const list = adminQuery<{ reports: string[] }>(['report-list'], '/admin/reports');
  const qs = new URLSearchParams({ ...(from && { from }), ...(to && { to }) });
  const q = adminQuery<{ columns: string[]; rows: (string | number)[][]; total: number }>(['report', type, from, to], `/admin/reports/${type}?${qs}`);
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  const label = (r: string) => r.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
  const needsRange = type !== 'inventory';
  return (
    <>
      <PageHead title="Reports" sub="CSV exports for accounting and operations. Customer names, emails, phones and street addresses are never included; every export is recorded in the audit log." />
      <div className="mb-5 flex flex-wrap items-end gap-3">
        <FilterSelect label="Report" value={type} onChange={(v) => set({ type: v })} options={(list.data?.reports ?? [type]).map((r) => [r, label(r)] as [string, string])} />
        {needsRange && <><label className="text-sm">From <input type="date" className="input !w-auto" value={from} onChange={(e) => set({ from: e.target.value })} /></label><label className="text-sm">To <input type="date" className="input !w-auto" value={to} onChange={(e) => set({ to: e.target.value })} /></label></>}
        <a className="btn btn-primary" href={`/api/v1/admin/reports/${type}?${new URLSearchParams({ ...Object.fromEntries(qs), format: 'csv' })}`}>Download CSV</a></div>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : <><p className="mb-2 text-sm text-muted" aria-live="polite">{q.data.total} row{q.data.total === 1 ? '' : 's'}{q.data.total > q.data.rows.length ? `, showing the first ${q.data.rows.length}. The CSV has everything.` : ''}</p>
        <Table head={q.data.columns} empty={q.data.rows.length ? undefined : 'No data for this period.'}>{q.data.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <Td key={j} right={typeof c === 'number'}>{String(c)}</Td>)}</tr>)}</Table></>}
    </>
  );
}

interface Settings { announcement: { enabled: boolean; text?: string; link?: string }; shipping: { flatRatePaise: number; freeAboveCartPaise: number | null }; taxEnabled: boolean; taxRatePercent: number; settlementHoldDays: number; lowStockThreshold: number; requireSecondPayoutApprover: boolean; contact: { email?: string; phone?: string; address?: string }; socialLinks: { label: string; url: string }[] }
export function SettingsPage() {
  useSeo({ title: 'Store settings', noindex: true });
  const act = useAction(); const q = adminQuery<{ settings: Settings }>(['settings'], '/admin/settings');
  const [s, setS] = useState<Settings | null>(null); const [flat, setFlat] = useState(''); const [free, setFree] = useState('');
  useEffect(() => { if (q.data) { setS(q.data.settings); setFlat(paiseToRupees(q.data.settings.shipping.flatRatePaise)); setFree(paiseToRupees(q.data.settings.shipping.freeAboveCartPaise)); } }, [q.data]);
  if (q.isPending || !s) return <Loading />; if (q.isError) return <ErrorNote e={q.error} />;
  const up = (patch: Partial<Settings>) => setS({ ...s, ...patch });
  const save = () => act.run(() => api('/admin/settings', { method: 'PUT', body: {
    announcement: { enabled: s.announcement.enabled, ...(s.announcement.text ? { text: s.announcement.text } : {}), ...(s.announcement.link ? { link: s.announcement.link } : {}) },
    shipping: { flatRatePaise: toPaise(flat) ?? 0, freeAboveCartPaise: free === '' ? null : toPaise(free) ?? null },
    taxEnabled: s.taxEnabled, taxRatePercent: s.taxRatePercent, settlementHoldDays: s.settlementHoldDays, lowStockThreshold: s.lowStockThreshold, requireSecondPayoutApprover: s.requireSecondPayoutApprover,
    contact: Object.fromEntries(Object.entries(s.contact).filter(([, v]) => v)), socialLinks: s.socialLinks.filter((l) => l.label && l.url) } }), 'Settings saved');
  return (
    <>
      <PageHead title="Store settings" sub="Changes apply to the storefront immediately and are recorded in the audit log." />
      {act.error && <div className="mb-4"><Alert>{act.error}</Alert></div>}
      <div className="max-w-3xl space-y-8">
        <fieldset className="card space-y-4 p-5"><legend className="px-1 font-sans text-lg font-semibold">Announcement bar</legend>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" checked={s.announcement.enabled} onChange={(e) => up({ announcement: { ...s.announcement, enabled: e.target.checked } })} /> Show the announcement bar</label>
          <TextField label="Message" maxLength={200} value={s.announcement.text ?? ''} onChange={(e) => up({ announcement: { ...s.announcement, text: e.target.value } })} /><TextField label="Link (optional site path)" placeholder="/shop" value={s.announcement.link ?? ''} onChange={(e) => up({ announcement: { ...s.announcement, link: e.target.value } })} /></fieldset>
        <fieldset className="card grid gap-4 p-5 sm:grid-cols-2"><legend className="px-1 font-sans text-lg font-semibold">Shipping and tax</legend>
          <RupeeField label="Flat shipping rate" value={flat} onChange={setFlat} /><RupeeField label="Free shipping above (blank = never)" value={free} onChange={setFree} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" checked={s.taxEnabled} onChange={(e) => up({ taxEnabled: e.target.checked })} /> Add tax to orders</label>
          <TextField label="Tax rate (%)" inputMode="decimal" value={String(s.taxRatePercent)} onChange={(e) => up({ taxRatePercent: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 })} />
          <p className="text-sm text-muted sm:col-span-2">Cash on delivery: <Badge tone="muted">Not available</Badge> It isn't built yet, so it can't be switched on.</p></fieldset>
        <fieldset className="card grid gap-4 p-5 sm:grid-cols-2"><legend className="px-1 font-sans text-lg font-semibold">Creator settlement</legend>
          <TextField label="Return window (days) before earnings become payable" inputMode="numeric" value={String(s.settlementHoldDays)} onChange={(e) => up({ settlementHoldDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          <TextField label="Low-stock warning at (units)" inputMode="numeric" value={String(s.lowStockThreshold)} onChange={(e) => up({ lowStockThreshold: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
          <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-forest" checked={s.requireSecondPayoutApprover} onChange={(e) => up({ requireSecondPayoutApprover: e.target.checked })} /> Require a different admin to approve each payout (two-person control)</label></fieldset>
        <fieldset className="card grid gap-4 p-5 sm:grid-cols-2"><legend className="px-1 font-sans text-lg font-semibold">Contact and social links</legend>
          <TextField label="Support email" value={s.contact.email ?? ''} onChange={(e) => up({ contact: { ...s.contact, email: e.target.value } })} /><TextField label="Phone" value={s.contact.phone ?? ''} onChange={(e) => up({ contact: { ...s.contact, phone: e.target.value } })} />
          <TextField className="sm:col-span-2" label="Address" value={s.contact.address ?? ''} onChange={(e) => up({ contact: { ...s.contact, address: e.target.value } })} />
          {s.socialLinks.map((l, i) => <div key={i} className="grid gap-2 sm:col-span-2 sm:grid-cols-[10rem_1fr_auto] sm:items-end"><TextField label="Label" value={l.label} onChange={(e) => up({ socialLinks: s.socialLinks.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)) })} /><TextField label="https link" value={l.url} onChange={(e) => up({ socialLinks: s.socialLinks.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} /><button type="button" className="btn btn-ghost" onClick={() => up({ socialLinks: s.socialLinks.filter((_, j) => j !== i) })}>Remove</button></div>)}
          {s.socialLinks.length < 8 && <button type="button" className="btn btn-outline sm:col-span-2 sm:w-fit" onClick={() => up({ socialLinks: [...s.socialLinks, { label: '', url: '' }] })}>Add a social link</button>}</fieldset>
        <button className="btn btn-primary" disabled={act.busy} onClick={save}>Save settings</button>
      </div>
    </>
  );
}

interface U { id: string; name: string; email: string; role: string; status: string; createdAt: string }
export function Users() {
  useSeo({ title: 'Users', noindex: true });
  const { data: me } = useMe(); const [sp, setSp] = useSearchParams(); const role = sp.get('role') ?? ''; const page = Number(sp.get('page') ?? 1); const act = useAction();
  const q = adminQuery<{ items: U[]; total: number }>(['users', role, page], `/admin/users?${new URLSearchParams({ ...(role && { role }), page: String(page) })}`);
  const isSuper = me?.role === 'super_admin';
  return (
    <>
      <PageHead title="Users" sub="Roles can only be changed by a super admin, never on your own account. Changes are audited and sign the person out everywhere."><FilterSelect label="Role" value={role} onChange={(v) => setSp(v ? { role: v } : {})} options={[['', 'All roles'], ['customer', 'Customers'], ['creator', 'Creators'], ['admin', 'Admins'], ['super_admin', 'Super admins']]} /></PageHead>
      {act.error && <div className="mb-4"><Alert>{act.error}</Alert></div>}
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : <><Table head={['Name', 'Email', 'Role', 'Status', 'Joined', 'Actions']} empty={q.data.items.length ? undefined : 'No users.'}>
        {q.data.items.map((u) => { const self = u.id === me?.id; return <tr key={u.id}><Td><strong>{u.name}</strong>{self && <span className="ml-2 text-xs text-muted">(you)</span>}</Td><Td>{u.email}</Td>
          <Td>{isSuper && !self ? <select aria-label={`Role for ${u.name}`} className="input !w-auto !min-h-9 !py-1" value={u.role} onChange={(e) => { if (confirm(`Change ${u.name} to ${e.target.value.replace('_', ' ')}? They will be signed out everywhere.`)) act.run(() => api(`/admin/users/${u.id}/role`, { method: 'PATCH', body: { role: e.target.value } }), 'Role changed'); }}>{['customer', 'creator', 'admin', 'super_admin'].map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}</select> : u.role.replace('_', ' ')}</Td>
          <Td><StatusBadge s={u.status} /></Td><Td>{formatDate(u.createdAt)}</Td>
          <Td>{self ? '—' : <button className={`link ${u.status === 'active' ? 'text-terracotta' : ''}`} disabled={act.busy} onClick={() => { if (confirm(u.status === 'active' ? `Suspend ${u.name}? They will be signed out and blocked.` : `Reactivate ${u.name}?`)) act.run(() => api(`/admin/users/${u.id}/status`, { method: 'PATCH', body: { status: u.status === 'active' ? 'suspended' : 'active' } }), u.status === 'active' ? 'User suspended' : 'User reactivated'); }}>{u.status === 'active' ? 'Suspend' : 'Reactivate'}</button>}</Td></tr>; })}</Table>
        <Pager page={page} total={q.data.total} onPage={(p) => setSp({ ...(role && { role }), page: String(p) })} /></>}
    </>
  );
}

interface A { id: string; action: string; entityType: string; entityId: string | null; actorRole?: string; before?: unknown; after?: unknown; note?: string; at: string }
export function AuditLog() {
  useSeo({ title: 'Audit log', noindex: true });
  const [sp, setSp] = useSearchParams(); const action = sp.get('action') ?? ''; const page = Number(sp.get('page') ?? 1);
  const q = adminQuery<{ items: A[]; total: number }>(['audit', action, page], `/admin/audit?${new URLSearchParams({ ...(action && { action }), page: String(page) })}`);
  return (
    <>
      <PageHead title="Audit log" sub="A permanent, read-only record of sensitive actions. Entries cannot be edited or deleted."><input aria-label="Filter by action" className="input !w-56" placeholder="Action starts with… e.g. payout." value={action} onChange={(e) => setSp(e.target.value ? { action: e.target.value } : {})} /></PageHead>
      {q.isPending ? <Loading /> : q.isError ? <ErrorNote e={q.error} /> : <><Table head={['When', 'Action', 'Entity', 'By', 'Details']} empty={q.data.items.length ? undefined : 'No matching entries.'}>
        {q.data.items.map((a) => <tr key={a.id}><Td className="whitespace-nowrap">{new Date(a.at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })}</Td><Td><strong>{a.action}</strong></Td><Td>{a.entityType}</Td><Td>{a.actorRole ?? 'system'}</Td>
          <Td>{a.note && <p>{a.note}</p>}{(a.before != null || a.after != null) && <details className="text-xs text-muted"><summary className="cursor-pointer">Before / after</summary><pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap">{JSON.stringify({ before: a.before, after: a.after }, null, 1)}</pre></details>}</Td></tr>)}</Table>
        <Pager page={page} total={q.data.total} limit={50} onPage={(p) => setSp({ ...(action && { action }), page: String(p) })} /></>}
    </>
  );
}
