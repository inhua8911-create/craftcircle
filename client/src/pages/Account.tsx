import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { api, ApiError } from '../lib/api';
import { formatDate, statusLabel } from '../lib/format';
import type { Address, Order, PaymentIntent, Product } from '../lib/types';
import { useLogout, useMe } from '../hooks/queries';
import { useSeo } from '../hooks/useSeo';
import { useToast } from '../components/Toast';
import { Alert, Badge, EmptyState, ErrorState, Price, SelectField, Skeleton, TextField } from '../components/ui';
import { PaymentPanel } from '../components/PaymentPanel';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductCard';
import { STATES } from '../lib/states';

export function AccountLayout() {
  useSeo({ title: 'Your account', noindex: true });
  const logout = useLogout(); const nav = useNavigate();
  const l = ({ isActive }: { isActive: boolean }) => `block py-1.5 text-sm ${isActive ? 'font-semibold text-forest' : 'text-muted hover:text-forest'}`;
  return (
    <div className="container-page grid gap-10 py-10 md:grid-cols-[12rem_1fr]">
      <nav aria-label="Account"><h1 className="mb-4 text-3xl">Account</h1>
        <ul><li><NavLink end to="/account" className={l}>Profile</NavLink></li><li><NavLink to="/account/orders" className={l}>Orders</NavLink></li><li><NavLink to="/account/addresses" className={l}>Addresses</NavLink></li><li><NavLink to="/wishlist" className={l}>Wishlist</NavLink></li><li><NavLink to="/account/notifications" className={l}>Notifications</NavLink></li>
          <li><button className="py-1.5 text-sm text-terracotta" onClick={() => logout.mutate(undefined, { onSuccess: () => nav('/') })}>Sign out</button></li></ul></nav>
      <div><Outlet /></div>
    </div>
  );
}

export function Profile() {
  const { data: me } = useMe(); const qc = useQueryClient(); const toast = useToast();
  const pf = useForm<{ name: string; phone: string }>({ values: { name: me?.name ?? '', phone: me?.phone ?? '' }, resolver: zodResolver(z.object({ name: z.string().trim().min(1, 'Enter your name'), phone: z.string().trim().regex(/^([+0-9 -]{7,20})?$/, 'Enter a valid phone number') })) });
  const save = pf.handleSubmit(async (v) => { await api('/account', { method: 'PATCH', body: { name: v.name, ...(v.phone ? { phone: v.phone } : {}) } }); await qc.invalidateQueries({ queryKey: ['me'] }); toast('Profile updated'); });
  const [pwErr, setPwErr] = useState('');
  const pw = useForm<{ currentPassword: string; newPassword: string }>({ resolver: zodResolver(z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: z.string().min(10, 'Use at least 10 characters').max(72) })) });
  const change = pw.handleSubmit(async (v) => { setPwErr(''); try { await api('/account/change-password', { method: 'POST', body: v }); pw.reset(); toast('Password changed. Other devices were signed out.'); } catch (e) { setPwErr(e instanceof ApiError ? e.message : 'Could not change password'); } });
  return (
    <div className="max-w-md space-y-12">
      <section aria-labelledby="pr"><h2 id="pr" className="text-2xl">Your details</h2>
        <form onSubmit={save} className="mt-4 space-y-4" noValidate><TextField label="Full name" error={pf.formState.errors.name?.message} {...pf.register('name')} /><TextField label="Email" value={me?.email ?? ''} readOnly hint="Contact support to change your email." onChange={() => {}} />
          <TextField label="Phone" type="tel" error={pf.formState.errors.phone?.message} {...pf.register('phone')} /><button className="btn btn-primary" disabled={pf.formState.isSubmitting}>Save changes</button></form></section>
      <section aria-labelledby="pw"><h2 id="pw" className="text-2xl">Change password</h2>
        <form onSubmit={change} className="mt-4 space-y-4" noValidate>{pwErr && <Alert>{pwErr}</Alert>}
          <TextField label="Current password" type="password" autoComplete="current-password" error={pw.formState.errors.currentPassword?.message} {...pw.register('currentPassword')} />
          <TextField label="New password" type="password" autoComplete="new-password" error={pw.formState.errors.newPassword?.message} {...pw.register('newPassword')} /><button className="btn btn-outline" disabled={pw.formState.isSubmitting}>Update password</button></form></section>
    </div>
  );
}

const tone = (s: string) => (['delivered', 'shipped', 'processing', 'paid'].includes(s) ? 'forest' : ['cancelled', 'payment_failed', 'refunded'].includes(s) ? 'muted' : 'terracotta') as 'forest' | 'muted' | 'terracotta';
export function Orders() {
  const q = useQuery({ queryKey: ['orders'], queryFn: () => api<{ items: Order[] }>('/orders') });
  if (q.isError) return <ErrorState onRetry={() => q.refetch()} />;
  if (q.isPending) return <Skeleton className="h-48" />;
  if (!q.data.items.length) return <EmptyState title="No orders yet" action={{ to: '/shop', label: 'Start browsing' }}>Your orders will appear here.</EmptyState>;
  return (
    <div><h2 className="text-2xl">Your orders</h2>
      <ul className="mt-6 space-y-4">{q.data.items.map((o) => (
        <li key={o.id}><Link to={`/account/orders/${o.id}`} className="card flex flex-wrap items-center justify-between gap-3 p-5 hover:shadow-soft">
          <div><p className="font-medium">{o.orderNumber}</p><p className="text-sm text-muted">{formatDate(o.createdAt)} · {o.items.length} item{o.items.length === 1 ? '' : 's'}</p></div>
          <div className="flex items-center gap-3"><Badge tone={tone(o.status)}>{statusLabel(o.status)}</Badge>{o.simulated && <Badge tone="rose">Simulated</Badge>}<Price paise={o.totalPaise} className="font-semibold" /></div></Link></li>))}</ul></div>
  );
}

const STEPS = ['paid', 'processing', 'shipped', 'delivered'];
export function OrderDetail() {
  const { id } = useParams(); const qc = useQueryClient(); const toast = useToast();
  const q = useQuery({ queryKey: ['order', id], queryFn: () => api<{ order: Order }>(`/orders/${id}`) });
  const [pay, setPay] = useState<PaymentIntent | null>(null); const [err, setErr] = useState('');
  const o = q.data?.order;
  const refresh = () => { qc.invalidateQueries({ queryKey: ['order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); };
  const start = useMutation({ mutationFn: () => api<{ payment: PaymentIntent }>(`/orders/${id}/pay`, { method: 'POST' }), onSuccess: (r) => { setPay(r.payment); setErr(''); }, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not start payment') });
  const cancel = useMutation({ mutationFn: () => api(`/orders/${id}/cancel`, { method: 'POST' }), onSuccess: () => { toast('Order cancelled'); refresh(); }, onError: (e) => setErr(e instanceof ApiError ? e.message : 'Could not cancel') });
  if (q.isError) return <ErrorState message="We couldn't find that order." onRetry={() => q.refetch()} />;
  if (!o) return <Skeleton className="h-64" />;
  const unpaid = ['pending_payment', 'payment_failed'].includes(o.status); const idx = STEPS.indexOf(o.status);
  return (
    <div>
      <p className="text-sm"><Link to="/account/orders" className="link">All orders</Link></p>
      <div className="mt-2 flex flex-wrap items-center gap-3"><h2 className="text-2xl">Order {o.orderNumber}</h2><Badge tone={tone(o.status)}>{statusLabel(o.status)}</Badge>{o.simulated && <Badge tone="rose">Simulated payment</Badge>}</div>
      <p className="mt-1 text-sm text-muted">Placed {formatDate(o.createdAt)}</p>
      {err && <div className="mt-4"><Alert>{err}</Alert></div>}
      {idx >= 0 && <ol className="mt-6 grid grid-cols-4 gap-2 text-center text-xs" aria-label="Order progress">{STEPS.map((s, i) => <li key={s} aria-current={i === idx ? 'step' : undefined} className={`border-t-4 pt-2 ${i <= idx ? 'border-forest font-semibold text-forest' : 'border-line text-muted'}`}>{statusLabel(s)}</li>)}</ol>}
      {o.shipment?.trackingNumber && <p className="mt-4 text-sm">Shipped with <strong>{o.shipment.provider}</strong>, tracking number <strong>{o.shipment.trackingNumber}</strong>.</p>}
      {unpaid && (<div className="mt-6 space-y-4">{pay ? <PaymentPanel order={o} payment={pay} onPaid={() => { setPay(null); refresh(); toast('Payment received'); }} /> : (
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5"><p className="text-sm">This order is waiting for payment{o.reservedUntil ? '; your items are held for a short time' : ''}.</p>
          <div className="flex gap-2"><button className="btn btn-primary" disabled={start.isPending} onClick={() => start.mutate()}>Pay now</button><button className="btn btn-outline" disabled={cancel.isPending} onClick={() => cancel.mutate()}>Cancel order</button></div></div>)}</div>)}
      <ul className="mt-8 divide-y divide-line border-y border-line">{o.items.map((i) => <li key={i.id} className="flex justify-between gap-4 py-4"><div>{i.slug ? <Link to={`/products/${i.slug}`} className="link">{i.name}</Link> : i.name}<p className="text-sm text-muted">Qty {i.quantity}{i.refundedQuantity ? ` · ${i.refundedQuantity} refunded` : ''}</p></div><Price paise={i.lineTotalPaise} /></li>)}</ul>
      <dl className="mt-4 ml-auto max-w-xs space-y-1.5 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd><Price paise={o.subtotalPaise} /></dd></div>
        {o.discountPaise > 0 && <div className="flex justify-between text-forest"><dt>Discount{o.coupon ? ` (${o.coupon})` : ''}</dt><dd>−<Price paise={o.discountPaise} /></dd></div>}
        <div className="flex justify-between"><dt>Shipping</dt><dd>{o.shippingPaise ? <Price paise={o.shippingPaise} /> : 'Free'}</dd></div>
        <div className="flex justify-between border-t border-line pt-2 text-base font-semibold"><dt>Total</dt><dd><Price paise={o.totalPaise} /></dd></div>
        {o.refundedPaise > 0 && <div className="flex justify-between text-muted"><dt>Refunded</dt><dd><Price paise={o.refundedPaise} /></dd></div>}</dl>
      <section className="mt-8"><h3 className="font-sans text-base font-semibold">Delivering to</h3><address className="mt-2 text-sm not-italic text-muted">{o.shippingAddress.fullName}<br />{o.shippingAddress.line1}{o.shippingAddress.line2 ? `, ${o.shippingAddress.line2}` : ''}<br />{o.shippingAddress.city}, {o.shippingAddress.state} {o.shippingAddress.postalCode}</address></section>
    </div>
  );
}

export function Addresses() {
  const qc = useQueryClient(); const toast = useToast(); const [adding, setAdding] = useState(false); const [err, setErr] = useState('');
  const q = useQuery({ queryKey: ['addresses'], queryFn: () => api<{ items: Address[] }>('/addresses') });
  const f = useForm<{ fullName: string; phone: string; line1: string; line2?: string; city: string; state: string; postalCode: string; label?: string }>({ resolver: zodResolver(z.object({ fullName: z.string().trim().min(1, 'Enter a name'), phone: z.string().trim().regex(/^[+0-9 -]{7,20}$/, 'Enter a valid phone number'), line1: z.string().trim().min(1, 'Enter an address'), line2: z.string().optional(), city: z.string().trim().min(1, 'Enter a city'), state: z.string().min(1, 'Choose a state'), postalCode: z.string().trim().regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code'), label: z.string().max(40).optional() })) });
  const add = f.handleSubmit(async (v) => { setErr(''); try { await api('/addresses', { method: 'POST', body: { ...v, line2: v.line2 || undefined, label: v.label || undefined, country: 'India' } }); f.reset(); setAdding(false); qc.invalidateQueries({ queryKey: ['addresses'] }); toast('Address saved'); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save'); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/addresses/${id}`, { method: 'DELETE' }), onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }) });
  const mk = useMutation({ mutationFn: (a: Address) => api(`/addresses/${a.id}`, { method: 'PUT', body: { fullName: a.fullName, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, state: a.state, postalCode: a.postalCode, country: 'India', label: a.label, isDefault: true } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['addresses'] }) });
  return (
    <div className="max-w-2xl"><div className="flex items-center justify-between"><h2 className="text-2xl">Saved addresses</h2>{!adding && <button className="btn btn-outline" onClick={() => setAdding(true)}>Add address</button>}</div>
      {q.isPending ? <Skeleton className="mt-6 h-32" /> : !q.data?.items.length && !adding ? <p className="mt-6 text-muted">You haven't saved an address yet.</p> : (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">{q.data?.items.map((a) => <li key={a.id} className="card p-5 text-sm"><div className="mb-2 flex items-center gap-2"><strong>{a.label ?? a.fullName}</strong>{a.isDefault && <Badge>Default</Badge>}</div>
          <address className="not-italic text-muted">{a.fullName}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}<br />{a.city}, {a.state} {a.postalCode}<br />{a.phone}</address>
          <div className="mt-3 flex gap-4">{!a.isDefault && <button className="link" onClick={() => mk.mutate(a)}>Make default</button>}<button className="link text-terracotta" onClick={() => del.mutate(a.id)}>Delete</button></div></li>)}</ul>)}
      {adding && <form onSubmit={add} noValidate className="card mt-6 grid gap-4 p-6 sm:grid-cols-2" aria-label="New address">{err && <div className="sm:col-span-2"><Alert>{err}</Alert></div>}
        <TextField label="Label (optional)" placeholder="Home, Work…" {...f.register('label')} /><TextField label="Full name" error={f.formState.errors.fullName?.message} {...f.register('fullName')} />
        <TextField label="Phone" type="tel" error={f.formState.errors.phone?.message} {...f.register('phone')} /><TextField label="Address" error={f.formState.errors.line1?.message} {...f.register('line1')} />
        <TextField label="Apartment, landmark (optional)" {...f.register('line2')} /><TextField label="City" error={f.formState.errors.city?.message} {...f.register('city')} />
        <SelectField label="State" error={f.formState.errors.state?.message} {...f.register('state')}><option value="">Select state</option>{STATES.map((s) => <option key={s}>{s}</option>)}</SelectField><TextField label="PIN code" inputMode="numeric" error={f.formState.errors.postalCode?.message} {...f.register('postalCode')} />
        <div className="flex gap-3 sm:col-span-2"><button className="btn btn-primary" disabled={f.formState.isSubmitting}>Save address</button><button type="button" className="btn btn-ghost" onClick={() => setAdding(false)}>Cancel</button></div></form>}
    </div>
  );
}

export function Wishlist() {
  useSeo({ title: 'Your wishlist', noindex: true });
  const q = useQuery({ queryKey: ['wishlist'], queryFn: () => api<{ ids: string[]; items: Product[] }>('/wishlist') });
  return (
    <div className="container-page py-10"><h1 className="text-4xl">Your wishlist</h1>
      <div className="mt-8">{q.isPending ? <ProductGridSkeleton n={4} /> : q.isError ? <ErrorState onRetry={() => q.refetch()} /> : q.data.items.length ? <ProductGrid items={q.data.items} /> : <EmptyState title="Nothing saved yet" action={{ to: '/shop', label: 'Explore the collection' }}>Tap the heart on anything you love and it will wait for you here.</EmptyState>}</div></div>
  );
}
