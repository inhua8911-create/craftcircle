import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMe } from '../hooks/queries';
import { Spinner } from './ui';

/** Only same-site relative paths are allowed as post-login destinations (prevents open redirects). */
export const safeNext = (n: string | null) => (n && /^\/(?!\/)[\w\-./?=&%]*$/.test(n) ? n : '/account');
export function RequireAuth({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe(); const loc = useLocation();
  if (isPending) return <div className="grid place-items-center py-24"><Spinner /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  return <>{children}</>;
}

/** Staff-only area. The server enforces roles on every API call; this only keeps the UI honest. */
export function RequireStaff({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe(); const loc = useLocation();
  if (isPending) return <div className="grid place-items-center py-24"><Spinner /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.role !== 'admin' && me.role !== 'super_admin') return <div className="container-page max-w-md py-24 text-center"><h1 className="text-3xl">Staff only</h1><p className="mt-3 text-muted">Your account doesn't have access to this area.</p></div>;
  return <>{children}</>;
}

/** Creator-only area (active creators). The server enforces this on every API call. */
export function RequireCreator({ children }: { children: ReactNode }) {
  const { data: me, isPending } = useMe(); const loc = useLocation();
  if (isPending) return <div className="grid place-items-center py-24"><Spinner /></div>;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.role !== 'creator') return <div className="container-page max-w-md py-24 text-center"><h1 className="text-3xl">Creators only</h1><p className="mt-3 text-muted">This area is for approved creators. <a className="link" href="/become-a-creator">Learn how to apply</a>.</p></div>;
  return <>{children}</>;
}
