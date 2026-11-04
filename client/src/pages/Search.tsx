import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../lib/api';
import type { Category, Creator, Paged, Product } from '../lib/types';
import { useSeo } from '../hooks/useSeo';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductCard';
import { EmptyState, ErrorState } from '../components/ui';
import { Pagination } from './Shop';

export default function Search() {
  const [sp, setSp] = useSearchParams(); const q = (sp.get('q') ?? '').trim(); const page = sp.get('page') ?? '1';
  useSeo({ title: q ? `Search: ${q}` : 'Search', noindex: true });
  const r = useQuery({ queryKey: ['search', q, page], enabled: !!q, queryFn: () => api<{ products: Paged<Product>; creators: Creator[] }>(`/search?q=${encodeURIComponent(q)}&page=${page}&limit=24`) });
  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api<{ items: Category[] }>('/categories'), staleTime: 10 * 60_000 });
  return (
    <div className="container-page pt-10">
      <h1 className="text-4xl">{q ? <>Results for “{q}”</> : 'Search'}</h1>
      {!q && <EmptyState title="What are you looking for?">Search by product, material or maker using the box in the header.</EmptyState>}
      {q && r.isError && <ErrorState message="Search failed. Please try again." onRetry={() => r.refetch()} />}
      {q && r.isPending && <div className="mt-8"><ProductGridSkeleton n={4} /></div>}
      {r.data && (
        <>
          {r.data.creators.length > 0 && <section className="mt-8" aria-labelledby="mk"><h2 id="mk" className="text-xl">Makers</h2><ul className="mt-3 flex flex-wrap gap-3">{r.data.creators.map((c) => <li key={c.slug}><Link to={`/creators/${c.slug}`} className="btn btn-outline">{c.name}</Link></li>)}</ul></section>}
          {r.data.products.items.length ? <div className="mt-8"><p className="mb-4 text-sm text-muted">{r.data.products.total} piece{r.data.products.total === 1 ? '' : 's'}</p><ProductGrid items={r.data.products.items} /><Pagination page={r.data.products.page} pages={r.data.products.pages} onPage={(p) => { const n = new URLSearchParams(sp); n.set('page', String(p)); setSp(n); }} /></div>
            : !r.data.creators.length && <EmptyState title={`No results for “${q}”`}>Check the spelling, try a more general word, or browse a category:
              <span className="mt-4 flex flex-wrap justify-center gap-2">{cats.data?.items.filter((c) => !c.parent).map((c) => <Link key={c.id} to={`/categories/${c.slug}`} className="btn btn-outline">{c.name}</Link>)}</span></EmptyState>}
        </>
      )}
    </div>
  );
}
