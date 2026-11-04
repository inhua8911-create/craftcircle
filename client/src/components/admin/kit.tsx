import { useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../lib/api';
import { formatINR, rupeesToPaise, statusLabel } from '../../lib/format';
import { useLogout, useMe } from '../../hooks/queries';
import { useToast } from '../Toast';
import { Alert, Badge, Skeleton } from '../ui';
import { brand } from '../../config/brand';

export const adminQuery = <T,>(key: unknown[], path: string, enabled = true) => useQuery({ queryKey: ['admin', ...key], queryFn: () => api<T>(path), enabled });
export const creatorQuery = <T,>(key: unknown[], path: string, enabled = true) => useQuery({ queryKey: ['creator', ...key], queryFn: () => api<T>(path), enabled });

/** Runs a mutation with consistent feedback: success toast, server error shown inline, all admin data refreshed. */
export function useAction(scope: 'admin' | 'creator' = 'admin') {
  const qc = useQueryClient(); const toast = useToast(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const run = async <T,>(fn: () => Promise<T>, success?: string): Promise<T | undefined> => {
    setError(''); setBusy(true);
    try { const r = await fn(); await qc.invalidateQueries({ queryKey: [scope] }); if (success) toast(success); return r; }
    catch (e) { const d = e instanceof ApiError && Array.isArray(e.details) ? ': ' + (e.details as { message: string }[]).map((x) => x.message).join('; ') : ''; setError(e instanceof ApiError ? e.message + d : 'Something went wrong'); return undefined; }
    finally { setBusy(false); }
  };
  return { run, error, busy, clear: () => setError('') };
}
export { useMutation };

const NAV: [string, string][] = [['/admin', 'Overview'], ['/admin/applications', 'Applications'], ['/admin/creators', 'Creators'], ['/admin/products', 'Products'], ['/admin/orders', 'Orders'], ['/admin/payouts', 'Payouts'], ['/admin/promotions', 'Promotions'], ['/admin/reports', 'Reports'], ['/admin/users', 'Users'], ['/admin/settings', 'Settings'], ['/admin/audit', 'Audit log']];
export function AdminLayout() {
  const { data: me } = useMe(); const logout = useLogout(); const nav = useNavigate();
  const pending = adminQuery<{ total: number }>(['pending-count'], '/admin/products/pending?limit=1');
  const apps = adminQuery<{ total: number }>(['apps-count'], '/admin/applications?status=submitted');
  const count = (to: string) => (to === '/admin/products' ? pending.data?.total : to === '/admin/applications' ? apps.data?.total : 0);
  return (
    <div className="min-h-screen bg-ivory md:grid md:grid-cols-[14rem_1fr]">
      <aside className="border-b border-line bg-forest text-ivory md:min-h-screen md:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 md:block"><Link to="/admin" className="font-serif text-xl">{brand.name}<span className="ml-2 text-xs font-sans uppercase tracking-widest text-ivory/60">Admin</span></Link>
          <p className="hidden pt-1 text-xs text-ivory/60 md:block">{me?.name} · {me?.role.replace('_', ' ')}</p></div>
        <nav aria-label="Admin" className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:px-3 md:pb-0">
          {NAV.map(([to, label]) => <NavLink key={to} end={to === '/admin'} to={to} className={({ isActive }) => `flex items-center justify-between whitespace-nowrap rounded-sm px-3 py-2 text-sm ${isActive ? 'bg-ivory/15 font-semibold' : 'text-ivory/80 hover:bg-ivory/10'}`}>{label}{!!count(to) && <span className="ml-2 rounded-full bg-terracotta px-1.5 text-xs">{count(to)}</span>}</NavLink>)}
          <Link to="/" className="block whitespace-nowrap rounded-sm px-3 py-2 text-sm text-ivory/80 hover:bg-ivory/10 md:mt-4">View store</Link>
          <button className="block w-full whitespace-nowrap rounded-sm px-3 py-2 text-left text-sm text-ivory/80 hover:bg-ivory/10" onClick={() => logout.mutate(undefined, { onSuccess: () => nav('/') })}>Sign out</button>
        </nav>
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 px-5 py-8 outline-none md:px-10"><Outlet /></main>
    </div>
  );
}
export const PageHead = ({ title, sub, children }: { title: string; sub?: string; children?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-3xl">{title}</h1>{sub && <p className="mt-1 text-sm text-muted">{sub}</p>}</div><div className="flex gap-2">{children}</div></div>
);
export const Stat = ({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string; tone?: 'warn' }) => (
  <div className={`card p-4 ${tone === 'warn' ? 'border-terracotta/50' : ''}`}><p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p><p className="mt-1 font-serif text-2xl tabular-nums">{value}</p>{hint && <p className="mt-1 text-xs text-muted">{hint}</p>}</div>
);
export const toneFor = (s: string): 'forest' | 'terracotta' | 'rose' | 'muted' => (['approved', 'published', 'active', 'paid', 'delivered', 'shipped', 'processing', 'captured', 'processed', 'eligible'].includes(s) ? 'forest' : ['submitted', 'under_review', 'pending_payment', 'draft', 'more_info_requested', 'changes_requested', 'pending', 'unpaid', 'return_requested', 'on_hold'].includes(s) ? 'terracotta' : ['suspended', 'rejected', 'failed', 'payment_failed', 'cancelled', 'refunded', 'partially_refunded'].includes(s) ? 'rose' : 'muted');
export const StatusBadge = ({ s }: { s: string }) => <Badge tone={toneFor(s)}>{statusLabel(s)}</Badge>;
export const Loading = () => <div className="space-y-3" aria-busy="true"><Skeleton className="h-10" /><Skeleton className="h-10" /><Skeleton className="h-10" /></div>;
export const ErrorNote = ({ e }: { e: unknown }) => <Alert>{e instanceof ApiError ? e.message : 'Could not load this data.'}</Alert>;

export function Table({ head, children, empty }: { head: string[]; children: ReactNode; empty?: string }) {
  return (
    <div className="card overflow-x-auto" role="region" aria-label="Data table (scrolls sideways on small screens)" tabIndex={0}><table className="w-full min-w-[40rem] text-left text-sm">
      <thead className="border-b border-line bg-cream text-xs uppercase tracking-wide text-muted"><tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-2.5 font-semibold">{h}</th>)}</tr></thead>
      <tbody className="divide-y divide-line">{children}</tbody></table>{empty && <p className="px-4 py-8 text-center text-muted">{empty}</p>}</div>
  );
}
export const Td = ({ children, right, className = '' }: { children?: ReactNode; right?: boolean; className?: string }) => <td className={`px-4 py-3 align-top ${right ? 'text-right tabular-nums' : ''} ${className}`}>{children}</td>;
export const Money = ({ paise, className = '' }: { paise: number; className?: string }) => <span className={`tabular-nums ${paise < 0 ? 'text-terracotta' : ''} ${className}`}>{formatINR(paise)}</span>;

/** Rupee input that reports integer paise (or undefined if blank/invalid). Display only; the server validates. */
export function RupeeField({ label, value, onChange, hint }: { label: string; value: string; onChange: (v: string) => void; hint?: string }) {
  return (
    <label className="block text-sm"><span className="mb-1 block font-medium">{label}</span>
      <span className="flex items-center"><span className="rounded-l-sm border border-r-0 border-[#cfc5b0] bg-cream px-3 py-2.5 text-muted">₹</span>
        <input inputMode="decimal" className="input !rounded-l-none" value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d.]/g, ''))} /></span>{hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}</label>
  );
}
export const toPaise = (s: string): number | undefined => { const n = Number(s); return s !== '' && Number.isFinite(n) && n >= 0 ? rupeesToPaise(n) : undefined; };
export const paiseToRupees = (p?: number | null) => (p == null ? '' : String(p / 100));

export function Pager({ page, total, limit = 25, onPage }: { page: number; total: number; limit?: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit)); if (pages <= 1) return null;
  return <nav aria-label="Pagination" className="mt-4 flex items-center justify-end gap-3 text-sm"><button className="btn btn-outline !min-h-9 !py-1" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><span className="text-muted">Page {page} of {pages}</span><button className="btn btn-outline !min-h-9 !py-1" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button></nav>;
}
export const FilterSelect = ({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) => (
  <label className="text-sm"><span className="sr-only">{label}</span><select aria-label={label} className="input !w-auto" value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
);
