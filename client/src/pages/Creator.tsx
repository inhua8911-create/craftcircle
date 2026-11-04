import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import type { Collection, Creator, Product } from '../lib/types';
import { useSeo } from '../hooks/useSeo';
import { EmptyState, ErrorState } from '../components/ui';
import { ProductGrid, ProductGridSkeleton } from '../components/ProductCard';

export function CreatorPage() {
  const { slug } = useParams();
  const q = useQuery({ queryKey: ['creator', slug], queryFn: () => api<{ creator: Creator; products: Product[] }>(`/creators/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const c = q.data?.creator;
  useSeo({ title: c?.name, description: c?.bio?.slice(0, 155) });
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <div className="container-page"><EmptyState title="We couldn't find that maker" action={{ to: '/shop', label: 'Browse the shop' }} /></div> : <ErrorState onRetry={() => q.refetch()} />;
  return (
    <div className="container-page py-10">
      {c ? (
        <header className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center">
          <span aria-hidden className="grid h-24 w-24 place-items-center rounded-full bg-rose-50 font-serif text-3xl text-forest">{c.name.split(' ').map((w) => w[0]).slice(0, 2).join('')}</span>
          <div><p className="eyebrow">Maker</p><h1 className="mt-1 text-4xl md:text-5xl">{c.name}</h1>
            {c.specialties?.length ? <p className="mt-2 text-muted">{c.specialties.join(' · ')}{c.city ? ` · ${c.city}` : ''}</p> : null}</div>
          {c.bio && <p className="max-w-2xl md:col-span-2">{c.bio}</p>}
          {c.story && <p className="max-w-2xl whitespace-pre-line text-muted md:col-span-2">{c.story}</p>}
        </header>
      ) : <div className="skeleton h-32" />}
      <h2 className="mb-6 mt-14 text-2xl">Pieces by {c?.name ?? 'this maker'}</h2>
      {q.isPending ? <ProductGridSkeleton n={4} /> : q.data!.products.length ? <ProductGrid items={q.data!.products} /> : <p className="text-muted">No pieces are available right now.</p>}
    </div>
  );
}
export function CollectionPage() {
  const { slug } = useParams();
  const q = useQuery({ queryKey: ['collection', slug], queryFn: () => api<{ collection: Collection; products: Product[] }>(`/collections/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  useSeo({ title: q.data?.collection.title, description: q.data?.collection.description });
  if (q.isError) return <div className="container-page"><EmptyState title="Collection not found" action={{ to: '/shop', label: 'Browse the shop' }} /></div>;
  return (
    <div className="container-page py-10">
      <p className="eyebrow">Collection</p><h1 className="mt-1 text-4xl md:text-5xl">{q.data?.collection.title ?? '…'}</h1>
      {q.data?.collection.description && <p className="mt-3 max-w-xl text-muted">{q.data.collection.description}</p>}
      <div className="mt-10">{q.isPending ? <ProductGridSkeleton n={4} /> : q.data.products.length ? <ProductGrid items={q.data.products} /> : <EmptyState title="Nothing here yet" action={{ to: '/shop', label: 'Browse all' }} />}</div>
      <p className="mt-10 text-sm"><Link to="/shop" className="link">Back to the shop</Link></p>
    </div>
  );
}
