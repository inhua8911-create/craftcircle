import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowRight, Gift, HandHeart, Scale, Sparkles } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Category, Collection, Creator, Paged, Product } from '../lib/types';
import { useStore } from '../hooks/queries';
import { useSeo } from '../hooks/useSeo';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductCard';
import { Alert, Img, Skeleton } from '../components/ui';
import { brand } from '../config/brand';

const products = (qs: string) => ({ queryKey: ['products', qs], queryFn: () => api<Paged<Product>>(`/products?${qs}`), staleTime: 60_000 });

function Section({ eyebrow, title, link, children }: { eyebrow?: string; title: string; link?: { to: string; label: string }; children: React.ReactNode }) {
  return (
    <section className="container-page mt-20">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h2 className="mt-1 text-3xl md:text-4xl">{title}</h2></div>
        {link && <Link to={link.to} className="link inline-flex items-center gap-1 text-sm font-medium">{link.label} <ArrowRight className="h-4 w-4" aria-hidden /></Link>}
      </div>
      {children}
    </section>
  );
}

export default function Home() {
  useSeo({ description: 'Discover thoughtful creations from independent makers and small creative businesses. Handmade jewellery, crochet, art, décor and personalised gifts.' });
  const { data: store } = useStore();
  const featured = useQuery(products('featured=true&limit=3'));
  const fresh = useQuery(products('sort=newest&limit=8'));
  const popular = useQuery(products('sort=popular&limit=4'));
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: Category[] }>('/categories'), staleTime: 10 * 60_000 });
  const cols = useQuery({ queryKey: ['collections'], queryFn: () => api<{ items: Collection[] }>('/collections'), staleTime: 10 * 60_000 });
  const creators = useQuery({ queryKey: ['creators-home'], queryFn: () => api<{ items: Creator[] }>('/creators?limit=6'), staleTime: 10 * 60_000 });

  const hero = (featured.data?.items.length ? featured.data.items : fresh.data?.items ?? []).slice(0, 3);
  const bestsellers = popular.data?.items.filter((p) => p.soldCount > 0) ?? []; // only products that have actually sold
  const occasions = cols.data?.items.filter((c) => c.occasion) ?? [];
  const topCats = cats.data?.items.filter((c) => !c.parent) ?? [];

  return (
    <>
      <section className="container-page grid items-center gap-10 pb-4 pt-10 md:grid-cols-12 md:pt-16">
        <div className="md:col-span-6">
          <p className="eyebrow">Independent makers · Small batches</p>
          <h1 className="mt-4 text-5xl leading-[1.05] md:text-6xl lg:text-7xl">Handmade with heart. <span className="italic text-forest">Made to be yours.</span></h1>
          <p className="mt-6 max-w-md text-lg text-muted">Discover thoughtful creations from independent makers and small creative businesses.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/shop" className="btn btn-primary">Explore the Collection</Link>
            <Link to="/become-a-creator" className="btn btn-outline">Become a Creator</Link>
          </div>
        </div>
        <div className="grid h-[26rem] grid-cols-6 grid-rows-6 gap-3 sm:h-[32rem] md:col-span-6" aria-label="Featured handmade pieces">
          {[['col-span-4 row-span-4', 0], ['col-span-2 col-start-5 row-span-3 row-start-2', 1], ['col-span-3 col-start-3 row-span-2 row-start-5', 2]].map(([cls, i]) => {
            const p = hero[i as number];
            return p ? <Link key={p.id} to={`/products/${p.slug}`} className={`relative block min-h-0 overflow-hidden rounded-sm bg-cream ${cls}`} aria-label={p.name}><img src={p.images[0]?.url} alt={p.images[0]?.alt ?? p.name} className="absolute inset-0 h-full w-full object-cover" /></Link> : <Skeleton key={i as number} className={cls as string} />;
          })}
          <div className="col-span-2 row-span-2 row-start-5 grid place-items-center rounded-sm bg-terracotta p-4 text-center text-ivory"><p className="font-serif text-base leading-tight sm:text-lg">Every piece made by hand</p></div>
        </div>
      </section>

      {topCats.length > 0 && (
        <Section eyebrow="Browse" title="Shop by category">
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-4 lg:grid-cols-7">
            {topCats.map((c) => (
              <li key={c.id}><Link to={`/categories/${c.slug}`} className="group block">
                <Img src={c.banner?.url} alt={c.banner?.alt ?? c.name} ratio="1 / 1" className="rounded-sm transition-opacity group-hover:opacity-85" />
                <span className="mt-2 block text-sm font-medium group-hover:text-forest">{c.name}</span>
              </Link></li>
            ))}
          </ul>
        </Section>
      )}

      <Section eyebrow="Just in" title="New arrivals" link={{ to: '/shop?sort=newest', label: 'See all' }}>
        {fresh.isLoading ? <ProductGridSkeleton /> : fresh.data?.items.length ? <ProductGrid items={fresh.data.items} /> : <p className="text-muted">New pieces are on their way.</p>}
      </Section>

      {!!cols.data?.items.length && (
        <Section eyebrow="Curated" title="Collections">
          <ul className="grid gap-5 md:grid-cols-3">
            {cols.data.items.slice(0, 3).map((c) => (
              <li key={c.slug}><Link to={`/collections/${c.slug}`} className="group card block overflow-hidden p-6 transition-shadow hover:shadow-soft">
                <h3 className="text-2xl group-hover:text-forest">{c.title}</h3>
                {c.description && <p className="mt-2 text-sm text-muted">{c.description}</p>}
                <span className="link mt-5 inline-flex items-center gap-1 text-sm font-medium">Explore <ArrowRight className="h-4 w-4" aria-hidden /></span>
              </Link></li>
            ))}
          </ul>
        </Section>
      )}

      {!!creators.data?.items.length && (
        <Section eyebrow="The makers" title="Featured creators">
          <ul className="grid grid-cols-2 gap-6 md:grid-cols-3">
            {creators.data.items.map((c) => (
              <li key={c.slug}><Link to={`/creators/${c.slug}`} className="group card flex h-full gap-4 p-5 hover:shadow-soft">
                <span aria-hidden className="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-rose-50 font-serif text-xl text-forest">{c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
                <span><span className="block font-serif text-lg group-hover:text-forest">{c.name}</span>
                  <span className="mt-1 block text-sm text-muted">{c.specialties?.join(' · ')}</span>
                  {c.city && <span className="mt-1 block text-xs text-muted">{c.city}</span>}</span>
              </Link></li>
            ))}
          </ul>
        </Section>
      )}

      {bestsellers.length > 0 && (
        <Section eyebrow="Most loved" title="Bestsellers" link={{ to: '/shop?sort=popular', label: 'See all' }}>
          <ProductGrid items={bestsellers} />
          {bestsellers.some((p) => p.isSample) && <p className="mt-4 text-xs text-muted">Based on sample order data in this demo.</p>}
        </Section>
      )}

      <section className="mt-24 bg-cream py-16">
        <div className="container-page grid gap-10 md:grid-cols-2">
          <div><p className="eyebrow">The collective</p><h2 className="mt-2 text-3xl md:text-4xl">Makers make. We handle the rest.</h2>
            <p className="mt-4 max-w-md text-muted">{brand.name} is a creator collective. We curate, photograph, promote and sell handmade work, look after customers and orders, and pay makers the amount we agree together for every piece sold.</p>
            <Link to="/how-it-works" className="btn btn-outline mt-6">How it works</Link></div>
          <ul className="grid gap-6 sm:grid-cols-2">
            {[[HandHeart, 'Creator-first', 'Makers agree their per-piece amount up front, and see every sale and payout statement.'], [Scale, 'Transparent terms', 'Prices and creator amounts are fixed per product; discounts never reduce what a maker is owed.'], [Sparkles, 'Curated', 'Every listing is reviewed before it goes live.'], [Gift, 'Made to gift', 'Personalised and made-to-order pieces, clearly labelled.']].map(([Icon, t, d]) => {
              const I = Icon as typeof Gift; return <li key={t as string}><I className="h-6 w-6 text-terracotta" aria-hidden /><h3 className="mt-3 font-sans text-base font-semibold">{t as string}</h3><p className="mt-1 text-sm text-muted">{d as string}</p></li>;
            })}
          </ul>
        </div>
      </section>

      {occasions.length > 0 && (
        <Section eyebrow="Gifting" title="Shop by occasion">
          <ul className="flex flex-wrap gap-3">{occasions.map((c) => <li key={c.slug}><Link to={`/collections/${c.slug}`} className="btn btn-outline">{c.title}</Link></li>)}</ul>
        </Section>
      )}

      {!!store?.instagramGallery.length && (
        <Section eyebrow="Follow along" title="From our social feed">
          <ul className="grid grid-cols-3 gap-2 md:grid-cols-6">{store.instagramGallery.slice(0, 6).map((g, i) => <li key={i}><a href={g.link ?? '#'} rel="noopener noreferrer" target="_blank"><Img src={g.imageUrl} alt={g.alt ?? 'Social post'} ratio="1 / 1" className="rounded-sm" /></a></li>)}</ul>
        </Section>
      )}

      <Newsletter />
    </>
  );
}

export function Newsletter() {
  const [email, setEmail] = useState('');
  const sub = useMutation({ mutationFn: () => api<{ message: string }>('/newsletter', { method: 'POST', body: { email } }) });
  const submit = (e: FormEvent) => { e.preventDefault(); sub.mutate(); };
  return (
    <section className="container-page mt-24" aria-labelledby="nl">
      <div className="rounded-sm bg-forest px-6 py-12 text-center text-ivory md:px-16">
        <h2 id="nl" className="text-3xl">New makers, new pieces: in your inbox</h2>
        <p className="mx-auto mt-3 max-w-md text-ivory/80">An occasional note about new creators and collections. No spam.</p>
        {sub.isSuccess ? <p role="status" className="mt-6 font-medium">{sub.data.message}</p> : (
          <form onSubmit={submit} className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row">
            <label htmlFor="nl-email" className="sr-only">Email address</label>
            <input id="nl-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className="input text-charcoal" />
            <button className="btn btn-accent" disabled={sub.isPending}>{sub.isPending ? 'Subscribing…' : 'Subscribe'}</button>
          </form>
        )}
        {sub.isError && <div className="mx-auto mt-4 max-w-md text-left"><Alert>{sub.error instanceof ApiError && sub.error.status === 422 ? 'Please enter a valid email address.' : 'Could not subscribe right now. Please try again.'}</Alert></div>}
      </div>
    </section>
  );
}
