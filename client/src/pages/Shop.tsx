import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { SlidersHorizontal } from 'lucide-react';
import { api } from '../lib/api';
import type { Category, Creator, Paged, Product } from '../lib/types';
import { rupeesToPaise } from '../lib/format';
import { useSeo } from '../hooks/useSeo';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductCard';
import { EmptyState, ErrorState, Img } from '../components/ui';

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="mt-12 flex items-center justify-center gap-3">
      <button className="btn btn-outline" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button>
      <span className="text-sm text-muted" aria-current="page">Page {page} of {pages}</span>
      <button className="btn btn-outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</button>
    </nav>
  );
}

/** One component serves /shop and /categories/:slug. All filter state lives in the URL so pages are shareable. */
export default function Shop() {
  const { slug } = useParams();
  const [sp, setSp] = useSearchParams();
  const [showFilters, setShowFilters] = useState(false);
  const get = (k: string) => sp.get(k) ?? '';
  const set = (patch: Record<string, string>) => { const n = new URLSearchParams(sp); for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k); if (!('page' in patch)) n.delete('page'); setSp(n, { replace: true }); };

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: Category[] }>('/categories'), staleTime: 10 * 60_000 });
  const creators = useQuery({ queryKey: ['creators-filter'], queryFn: () => api<{ items: Creator[] }>('/creators?limit=24'), staleTime: 10 * 60_000 });
  const cat = slug ? cats.data?.items.find((c) => c.slug === slug) : undefined;

  const qs = new URLSearchParams();
  if (slug) qs.set('category', slug);
  for (const k of ['sort', 'creator', 'inStock', 'page']) if (get(k)) qs.set(k, get(k));
  if (get('min') && Number(get('min')) >= 0) qs.set('minPrice', String(rupeesToPaise(Number(get('min')))));
  if (get('max') && Number(get('max')) >= 0) qs.set('maxPrice', String(rupeesToPaise(Number(get('max')))));
  qs.set('limit', '24');
  const list = useQuery({ queryKey: ['products', qs.toString()], queryFn: () => api<Paged<Product>>(`/products?${qs}`), placeholderData: keepPreviousData });

  const title = slug ? (cat?.name ?? 'Category') : 'Shop all handmade';
  useSeo({ title, description: cat?.description ?? 'Browse handmade jewellery, crochet, art, home décor, stationery and personalised gifts from independent makers.', image: cat?.banner?.url });
  const unknownCategory = !!slug && cats.isSuccess && !cat;

  const filters = (
    <form className="space-y-7" onSubmit={(e) => e.preventDefault()} aria-label="Filters">
      <fieldset><legend className="mb-2 text-sm font-semibold">Category</legend>
        <ul className="space-y-1.5 text-sm"><li><Link to="/shop" className={!slug ? 'font-semibold text-forest' : 'hover:text-forest'}>All</Link></li>
          {cats.data?.items.filter((c) => !c.parent).map((c) => <li key={c.id}><Link to={`/categories/${c.slug}`} aria-current={slug === c.slug ? 'page' : undefined} className={slug === c.slug ? 'font-semibold text-forest' : 'hover:text-forest'}>{c.name}</Link></li>)}</ul></fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">Price (₹)</legend>
        <div className="flex items-center gap-2"><label className="sr-only" htmlFor="pmin">Minimum price</label><input id="pmin" inputMode="numeric" className="input" placeholder="Min" value={get('min')} onChange={(e) => set({ min: e.target.value.replace(/\D/g, '') })} />
          <span aria-hidden>–</span><label className="sr-only" htmlFor="pmax">Maximum price</label><input id="pmax" inputMode="numeric" className="input" placeholder="Max" value={get('max')} onChange={(e) => set({ max: e.target.value.replace(/\D/g, '') })} /></div></fieldset>
      <fieldset><legend className="mb-2 text-sm font-semibold">Creator</legend>
        <label className="sr-only" htmlFor="pcreator">Creator</label>
        <select id="pcreator" className="input" value={get('creator')} onChange={(e) => set({ creator: e.target.value })}><option value="">All creators</option>{creators.data?.items.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}</select></fieldset>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-forest" checked={get('inStock') === 'true'} onChange={(e) => set({ inStock: e.target.checked ? 'true' : '' })} /> In stock only</label>
      {(get('min') || get('max') || get('creator') || get('inStock')) && <button type="button" className="link text-sm" onClick={() => setSp(new URLSearchParams(), { replace: true })}>Clear filters</button>}
    </form>
  );

  if (unknownCategory) return <div className="container-page"><EmptyState title="Category not found" action={{ to: '/shop', label: 'Browse everything' }}>We couldn't find that category.</EmptyState></div>;
  return (
    <>
      {slug ? (
        <div className="bg-cream"><div className="container-page grid items-center gap-6 py-10 md:grid-cols-3">
          <div className="md:col-span-2"><p className="eyebrow">Category</p><h1 className="mt-2 text-4xl md:text-5xl">{cat?.name ?? '…'}</h1>{cat?.description && <p className="mt-3 max-w-lg text-muted">{cat.description}</p>}</div>
          {cat?.banner?.url && <Img src={cat.banner.url} alt="" ratio="16 / 9" className="rounded-sm" />}
        </div></div>
      ) : <div className="container-page pt-10"><h1 className="text-4xl md:text-5xl">{title}</h1></div>}
      <div className="container-page mt-8 grid gap-10 lg:grid-cols-[14rem_1fr]">
        <aside className="hidden lg:block">{filters}</aside>
        <div>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <button className="btn btn-outline lg:hidden" aria-expanded={showFilters} onClick={() => setShowFilters(!showFilters)}><SlidersHorizontal className="h-4 w-4" aria-hidden /> Filters</button>
            <p className="text-sm text-muted" aria-live="polite">{list.data ? `${list.data.total} piece${list.data.total === 1 ? '' : 's'}` : ''}</p>
            <div className="flex items-center gap-2"><label htmlFor="sort" className="text-sm text-muted">Sort by</label>
              <select id="sort" className="input !w-auto" value={get('sort') || 'newest'} onChange={(e) => set({ sort: e.target.value === 'newest' ? '' : e.target.value })}>
                <option value="newest">Newest</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="popular">Most popular</option></select></div>
          </div>
          {showFilters && <div className="card mb-6 p-5 lg:hidden">{filters}</div>}
          {list.isError ? <ErrorState message="We couldn't load products." onRetry={() => list.refetch()} /> : list.isPending ? <ProductGridSkeleton /> : list.data.items.length === 0 ? (
            <EmptyState title="Nothing matches those filters" action={{ to: '/shop', label: 'See all products' }}>Try widening the price range or clearing a filter.</EmptyState>
          ) : (<div className={list.isPlaceholderData ? 'opacity-60 transition-opacity' : ''}><ProductGrid items={list.data.items} cols={3} /><Pagination page={list.data.page} pages={list.data.pages} onPage={(p) => set({ page: String(p) })} /></div>)}
        </div>
      </div>
    </>
  );
}
