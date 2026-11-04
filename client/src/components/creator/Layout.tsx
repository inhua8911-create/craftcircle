import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { formatDate } from '../../lib/format';
import { useLogout, useMe } from '../../hooks/queries';
import { brand } from '../../config/brand';
import { EmptyState } from '../ui';

interface N { id: string; title: string; body?: string; link?: string; read: boolean; createdAt: string }
export const useNotifications = () => useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number; items: N[] }>('/notifications'), refetchInterval: 60_000 });

/** Shared by the creator portal and the customer account (applicants get their decision here). */
export function NotificationsList() {
  const q = useNotifications(); const qc = useQueryClient(); const nav = useNavigate();
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (!q.data?.items.length) return <EmptyState title="No notifications yet">Updates about your application, products and payouts will appear here.</EmptyState>;
  return (
    <div><div className="mb-4 flex items-center justify-between"><p className="text-sm text-muted" aria-live="polite">{q.data.unread} unread</p>{q.data.unread > 0 && <button className="link text-sm" onClick={async () => { await api('/notifications/read-all', { method: 'POST' }); refresh(); }}>Mark all as read</button>}</div>
      <ul className="card divide-y divide-line">{q.data.items.map((n) => (
        <li key={n.id} className={`flex gap-3 px-4 py-3 ${n.read ? '' : 'bg-forest-50/60'}`}>
          <span aria-hidden className={`mt-2 h-2 w-2 shrink-0 rounded-full ${n.read ? 'bg-transparent' : 'bg-terracotta'}`} />
          <div className="flex-1"><p className="font-medium">{n.title}{!n.read && <span className="sr-only"> (unread)</span>}</p>{n.body && <p className="text-sm text-muted">{n.body}</p>}<p className="mt-1 text-xs text-muted">{formatDate(n.createdAt)}</p></div>
          <div className="flex flex-col items-end gap-1 text-sm">{n.link && <button className="link" onClick={async () => { if (!n.read) await api(`/notifications/${n.id}/read`, { method: 'POST' }); refresh(); nav(n.link!); }}>Open</button>}{!n.read && <button className="link text-muted" onClick={async () => { await api(`/notifications/${n.id}/read`, { method: 'POST' }); refresh(); }}>Mark read</button>}</div>
        </li>))}</ul></div>
  );
}

const NAV: [string, string][] = [['/creator/dashboard', 'Dashboard'], ['/creator/products', 'Products'], ['/creator/earnings', 'Earnings'], ['/creator/incentives', 'Incentives'], ['/creator/notifications', 'Notifications'], ['/creator/profile', 'Profile & payouts']];
export function CreatorLayout() {
  const { data: me } = useMe(); const logout = useLogout(); const nav = useNavigate(); const n = useNotifications();
  const prof = useQuery({ queryKey: ['creator', 'slug'], queryFn: () => api<{ profile: { slug: string } }>('/creator/profile'), staleTime: 10 * 60_000 });
  return (
    <div className="min-h-screen bg-ivory md:grid md:grid-cols-[14rem_1fr]">
      <aside className="border-b border-line bg-forest text-ivory md:min-h-screen md:border-b-0">
        <div className="flex items-center justify-between px-5 py-4 md:block"><Link to="/creator/dashboard" className="font-serif text-xl">{brand.name}<span className="ml-2 font-sans text-xs uppercase tracking-widest text-ivory/60">Creator</span></Link><p className="hidden pt-1 text-xs text-ivory/60 md:block">{me?.name}</p></div>
        <nav aria-label="Creator" className="flex gap-1 overflow-x-auto px-3 pb-3 md:block md:pb-0">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} className={({ isActive }) => `flex items-center justify-between whitespace-nowrap rounded-sm px-3 py-2 text-sm ${isActive ? 'bg-ivory/15 font-semibold' : 'text-ivory/80 hover:bg-ivory/10'}`}>{label}{to.endsWith('notifications') && !!n.data?.unread && <span className="ml-2 rounded-full bg-terracotta px-1.5 text-xs">{n.data.unread}</span>}</NavLink>)}
          {prof.data && <Link to={`/creators/${prof.data.profile.slug}`} className="block whitespace-nowrap rounded-sm px-3 py-2 text-sm text-ivory/80 hover:bg-ivory/10 md:mt-4">My public page</Link>}
          <Link to="/" className="block whitespace-nowrap rounded-sm px-3 py-2 text-sm text-ivory/80 hover:bg-ivory/10">View store</Link>
          <button className="block w-full whitespace-nowrap rounded-sm px-3 py-2 text-left text-sm text-ivory/80 hover:bg-ivory/10" onClick={() => logout.mutate(undefined, { onSuccess: () => nav('/') })}>Sign out</button>
        </nav>
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 px-5 py-8 outline-none md:px-10"><Outlet /></main>
    </div>
  );
}
