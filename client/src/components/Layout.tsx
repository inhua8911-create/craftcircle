import { useEffect, useState, type FormEvent } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Heart, Menu, Search, ShoppingBag, User, X } from 'lucide-react';
import { api } from '../lib/api';
import { brand } from '../config/brand';
import type { Category } from '../lib/types';
import { cartCount, useCart, useLogout, useMe, useStore } from '../hooks/queries';

function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2" aria-label={`${brand.name} home`}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="11" fill="none" stroke="#1f3d2f" strokeWidth="2.5" /><circle cx="16" cy="16" r="3" fill="#b0553a" /></svg>
      <span className="font-serif text-2xl font-medium tracking-tight text-forest">{brand.name}</span>
    </Link>
  );
}
function AnnouncementBar() {
  const { data } = useStore();
  const text = data?.announcement?.text; const demo = data?.paymentMode === 'mock';
  if (!text && !demo) return null;
  return (
    <div className="bg-forest text-ivory">
      <div className="container-page flex flex-wrap items-center justify-center gap-x-4 py-2 text-center text-sm">
        {text && (data?.announcement?.link ? <Link to={data.announcement.link} className="underline underline-offset-4">{text}</Link> : <span>{text}</span>)}
        {demo && <span className="rounded-sm bg-terracotta px-2 py-0.5 text-xs font-semibold">DEMO MODE: payments are simulated, no money is charged</span>}
      </div>
    </div>
  );
}
function Header() {
  const nav = useNavigate(); const loc = useLocation();
  const [open, setOpen] = useState(false); const [q, setQ] = useState('');
  const { data: me } = useMe(); const { data: cart } = useCart(); const logout = useLogout();
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: Category[] }>('/categories'), staleTime: 10 * 60_000 });
  useEffect(() => setOpen(false), [loc.pathname]);
  const submit = (e: FormEvent) => { e.preventDefault(); const t = q.trim(); if (t) nav(`/search?q=${encodeURIComponent(t)}`); };
  const n = cartCount(cart);
  const link = ({ isActive }: { isActive: boolean }) => `py-2 text-sm font-medium hover:text-forest ${isActive ? 'text-forest underline underline-offset-8 decoration-terracotta' : 'text-charcoal'}`;
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ivory/95 backdrop-blur">
      <div className="container-page flex h-16 items-center gap-4">
        <button className="btn btn-ghost -ml-2 px-2 lg:hidden" aria-expanded={open} aria-controls="mobile-nav" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>{open ? <X /> : <Menu />}</button>
        <Logo />
        <nav aria-label="Main" className="ml-6 hidden items-center gap-6 lg:flex">
          <NavLink to="/shop" className={link}>Shop</NavLink><NavLink to="/how-it-works" className={link}>How it works</NavLink><NavLink to="/about" className={link}>Our story</NavLink><NavLink to="/become-a-creator" className={link}>Become a creator</NavLink>
        </nav>
        <form role="search" onSubmit={submit} className="relative ml-auto hidden max-w-xs flex-1 md:block">
          <label htmlFor="site-search" className="sr-only">Search products and creators</label>
          <input id="site-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search handmade…" className="input pr-10" />
          <button className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center text-forest" aria-label="Search"><Search className="h-5 w-5" /></button>
        </form>
        <div className="ml-auto flex items-center gap-1 md:ml-0">
          {(me?.role === 'admin' || me?.role === 'super_admin') && <Link to="/admin" className="btn btn-ghost hidden px-2 text-sm sm:inline-flex">Admin</Link>}
          {me?.role === 'creator' && <Link to="/creator/dashboard" className="btn btn-ghost hidden px-2 text-sm sm:inline-flex">Creator dashboard</Link>}
          <Link to="/wishlist" className="btn btn-ghost px-2" aria-label="Wishlist"><Heart className="h-5 w-5" /></Link>
          <Link to={me ? '/account' : '/login'} className="btn btn-ghost px-2" aria-label={me ? 'Your account' : 'Sign in'}><User className="h-5 w-5" /></Link>
          <Link to="/cart" className="btn btn-ghost relative px-2" aria-label={`Cart, ${n} item${n === 1 ? '' : 's'}`}>
            <ShoppingBag className="h-5 w-5" />
            {n > 0 && <span className="absolute -right-0.5 -top-0.5 grid h-5 min-w-5 place-items-center rounded-full bg-terracotta px-1 text-xs font-bold text-white">{n}</span>}
          </Link>
        </div>
      </div>
      {cats.data && (
        <nav aria-label="Categories" className="hidden border-t border-line lg:block">
          <ul className="container-page flex gap-7 overflow-x-auto py-2 text-sm text-muted">
            {cats.data.items.filter((c) => !c.parent).map((c) => <li key={c.id}><NavLink to={`/categories/${c.slug}`} className={({ isActive }) => `whitespace-nowrap hover:text-forest ${isActive ? 'text-forest font-medium' : ''}`}>{c.name}</NavLink></li>)}
          </ul>
        </nav>
      )}
      {open && (
        <div id="mobile-nav" className="border-t border-line bg-ivory lg:hidden">
          <form role="search" onSubmit={submit} className="container-page py-3">
            <label htmlFor="m-search" className="sr-only">Search</label><input id="m-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search handmade…" className="input" />
          </form>
          <ul className="container-page grid gap-1 pb-4">
            {[['/shop', 'Shop all'], ...(cats.data?.items.filter((c) => !c.parent).map((c) => [`/categories/${c.slug}`, c.name]) ?? []), ['/how-it-works', 'How it works'], ['/about', 'Our story'], ['/become-a-creator', 'Become a creator']].map(([to, label]) => <li key={to}><Link to={to!} className="block py-2.5 text-base">{label}</Link></li>)}
            {(me?.role === 'admin' || me?.role === 'super_admin') && <li><Link to="/admin" className="block py-2.5 text-base">Admin dashboard</Link></li>}
            {me?.role === 'creator' && <li><Link to="/creator/dashboard" className="block py-2.5 text-base">Creator dashboard</Link></li>}
            {me && <li><button className="py-2.5 text-base text-terracotta" onClick={() => logout.mutate()}>Sign out</button></li>}
          </ul>
        </div>
      )}
    </header>
  );
}
function Footer() {
  const { data } = useStore(); const { data: me } = useMe(); const logout = useLogout();
  const col = (title: string, links: [string, string][]) => (
    <div><h3 className="font-sans text-sm font-semibold uppercase tracking-wider text-ivory/70">{title}</h3><ul className="mt-4 space-y-2.5 text-sm">{links.map(([to, l]) => <li key={to}><Link to={to} className="hover:underline">{l}</Link></li>)}</ul></div>
  );
  return (
    <footer className="mt-24 bg-forest text-ivory">
      <div className="container-page grid gap-10 py-14 md:grid-cols-5">
        <div className="md:col-span-2">
          <p className="font-serif text-2xl">{brand.name}</p>
          <p className="mt-3 max-w-xs text-sm text-ivory/80">{brand.tagline} Thoughtful creations from independent makers and small creative businesses.</p>
          <address className="mt-5 text-sm not-italic text-ivory/80">
            <a className="underline underline-offset-4" href={`mailto:${data?.contact.email ?? brand.supportEmail}`}>{data?.contact.email ?? brand.supportEmail}</a>
            {data?.contact.phone && <div>{data.contact.phone}</div>}{data?.contact.address && <div>{data.contact.address}</div>}
          </address>
          {!!data?.socialLinks.length && <ul className="mt-4 flex gap-4 text-sm">{data.socialLinks.map((s) => <li key={s.url}><a className="underline underline-offset-4" href={s.url} rel="noopener noreferrer" target="_blank">{s.label}</a></li>)}</ul>}
        </div>
        {col('Shop', [['/shop', 'All products'], ['/search', 'Search'], ['/wishlist', 'Wishlist'], ['/cart', 'Cart']])}
        {col('Help', [['/faq', 'FAQs'], ['/shipping-policy', 'Shipping'], ['/returns-refunds', 'Returns & refunds'], ['/contact', 'Contact us']])}
        {col('Company', [['/about', 'Our story'], ['/how-it-works', 'How it works'], ['/become-a-creator', 'Become a creator'], ['/privacy-policy', 'Privacy'], ['/terms', 'Terms']])}
      </div>
      <div className="border-t border-ivory/15"><div className="container-page flex flex-wrap items-center justify-between gap-3 py-5 text-xs text-ivory/70">
        <span>© {new Date().getFullYear()} {brand.name}. Prices in INR.</span>
        {me && <button className="underline underline-offset-4" onClick={() => logout.mutate()}>Sign out</button>}
      </div></div>
    </footer>
  );
}
export function Layout() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:p-3">Skip to content</a>
      <AnnouncementBar /><Header />
      <main id="main" tabIndex={-1} className="min-h-[60vh] outline-none"><Outlet /></main>
      <Footer />
    </>
  );
}
