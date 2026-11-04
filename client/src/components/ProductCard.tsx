import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Heart } from 'lucide-react';
import type { Product } from '../lib/types';
import { Badge, Img, Price, Skeleton } from './ui';
import { useMe, useToggleWishlist, useWishlist } from '../hooks/queries';
import { useToast } from './Toast';

export function ProductCard({ product: p, eager = false }: { product: Product; eager?: boolean }) {
  const { data: me } = useMe(); const { data: wl } = useWishlist(); const toggle = useToggleWishlist(); const nav = useNavigate(); const loc = useLocation(); const toast = useToast();
  const wished = !!wl?.ids.includes(p.id);
  const onHeart = () => {
    if (!me) return nav(`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`);
    toggle.mutate({ id: p.id, on: !wished }, { onSuccess: () => toast(wished ? 'Removed from wishlist' : 'Saved to wishlist') });
  };
  return (
    <article className="group relative">
      <Link to={`/products/${p.slug}`} className="block" aria-label={`${p.name}, ${p.creator ? 'by ' + p.creator.name : ''}`}>
        <div className="relative">
          <Img src={p.images[0]?.url} alt={p.images[0]?.alt ?? p.name} ratio="4 / 5" eager={eager} className="rounded-sm transition-opacity duration-300 group-hover:opacity-90" />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {!p.available && <Badge tone="muted">Sold out</Badge>}
            {p.available && p.madeToOrder && <Badge tone="terracotta">Made to order</Badge>}
            {p.isSample && <Badge tone="rose">Sample</Badge>}
          </div>
        </div>
        <h3 className="mt-3 font-sans text-[0.95rem] font-medium leading-snug">{p.name}</h3>
        {p.creator && <p className="mt-0.5 text-sm text-muted">by {p.creator.name}</p>}
        <Price paise={p.pricePaise} className="mt-1 block font-semibold" />
      </Link>
      <button type="button" onClick={onHeart} aria-pressed={wished} aria-label={wished ? `Remove ${p.name} from wishlist` : `Save ${p.name} to wishlist`}
        className="absolute right-2 top-2 grid h-10 w-10 place-items-center rounded-full bg-ivory/90 text-forest shadow-soft hover:bg-white">
        <Heart className="h-5 w-5" fill={wished ? 'currentColor' : 'none'} aria-hidden />
      </button>
    </article>
  );
}
export const ProductGridSkeleton = ({ n = 8 }: { n?: number }) => (
  <div className="grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 lg:grid-cols-4" aria-busy="true" aria-label="Loading products">
    {Array.from({ length: n }, (_, i) => <div key={i}><Skeleton className="aspect-[4/5] w-full" /><Skeleton className="mt-3 h-4 w-3/4" /><Skeleton className="mt-2 h-4 w-1/3" /></div>)}
  </div>
);
export const ProductGrid = ({ items, cols = 4 }: { items: Product[]; cols?: 3 | 4 }) => (
  <div className={`grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-3 ${cols === 4 ? 'lg:grid-cols-4' : ''}`}>
    {items.map((p, i) => <ProductCard key={p.id} product={p} eager={i < 4} />)}
  </div>
);
