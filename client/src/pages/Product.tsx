import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Heart, Minus, Plus, ShieldCheck, Truck, X } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import type { Product } from '../lib/types';
import { formatINR } from '../lib/format';
import { useMe, useSetCartItem, useStore, useToggleWishlist, useWishlist, useCart } from '../hooks/queries';
import { useSeo } from '../hooks/useSeo';
import { useToast } from '../components/Toast';
import { Alert, Badge, EmptyState, ErrorState, Img, Price, Skeleton } from '../components/ui';
import { ProductGrid } from '../components/ProductCard';

function Gallery({ images, name }: { images: Product['images']; name: string }) {
  const [i, setI] = useState(0); const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => setI(0), [images]);
  const cur = images[i];
  return (
    <div>
      <button type="button" className="block w-full cursor-zoom-in" onClick={() => ref.current?.showModal()} aria-label="Enlarge image"><Img src={cur?.url} alt={cur?.alt ?? name} ratio="4 / 5" eager className="rounded-sm" /></button>
      {images.length > 1 && <ul className="mt-3 flex gap-2">{images.map((im, k) => <li key={im.url}><button onClick={() => setI(k)} aria-label={`Show photo ${k + 1}`} aria-current={k === i} className={`block w-16 border-2 ${k === i ? 'border-forest' : 'border-transparent'}`}><Img src={im.url} alt="" ratio="1 / 1" /></button></li>)}</ul>}
      <dialog ref={ref} className="m-auto max-h-[92vh] max-w-[92vw] bg-ivory p-2 backdrop:bg-charcoal/70" onClick={(e) => { if (e.target === ref.current) ref.current?.close(); }} aria-label={`${name} enlarged`}>
        <button className="btn btn-ghost absolute right-2 top-2 !min-h-10 bg-ivory/90 px-2" onClick={() => ref.current?.close()} aria-label="Close"><X /></button>
        {cur && <img src={cur.url} alt={cur.alt} className="max-h-[88vh] max-w-full object-contain" />}
      </dialog>
    </div>
  );
}

export default function ProductPage() {
  const { slug } = useParams(); const nav = useNavigate(); const toast = useToast();
  const { data: me } = useMe(); const { data: store } = useStore(); const { data: cart } = useCart(); const { data: wl } = useWishlist();
  const setItem = useSetCartItem(); const toggle = useToggleWishlist();
  const [qty, setQty] = useState(1); const [err, setErr] = useState('');
  const q = useQuery({ queryKey: ['product', slug], queryFn: () => api<{ product: Product; related: Product[] }>(`/products/${slug}`), retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 2 });
  const p = q.data?.product;
  const inCart = cart?.items.find((l) => l.productId === p?.id)?.quantity ?? 0;
  useEffect(() => setQty(1), [slug]);
  useSeo({
    title: p?.name, description: p?.description.slice(0, 155), image: p?.images[0]?.url, noindex: p?.isSample,
    jsonLd: p && { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: p.description, image: p.images.map((i) => new URL(i.url, location.origin).href), brand: p.creator && { '@type': 'Brand', name: p.creator.name },
      offers: { '@type': 'Offer', priceCurrency: 'INR', price: (p.pricePaise / 100).toFixed(2), availability: p.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: location.href },
      ...(p.rating && { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating.average, reviewCount: p.rating.count } }) },
  });
  if (q.isError) return q.error instanceof ApiError && q.error.status === 404 ? <div className="container-page"><EmptyState title="This piece isn't available" action={{ to: '/shop', label: 'Keep browsing' }}>It may have sold out or been taken down.</EmptyState></div> : <ErrorState onRetry={() => q.refetch()} />;
  if (!p) return <div className="container-page grid gap-10 py-10 md:grid-cols-2"><Skeleton className="aspect-[4/5]" /><div className="space-y-4"><Skeleton className="h-10 w-3/4" /><Skeleton className="h-6 w-1/4" /><Skeleton className="h-32" /></div></div>;

  const add = async (thenCheckout = false) => {
    setErr('');
    try {
      await setItem.mutateAsync({ productId: p.id, quantity: Math.min(20, inCart + qty) });
      if (thenCheckout) nav(me ? '/checkout' : '/login?next=/checkout'); else toast('Added to your cart');
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not add to cart'); }
  };
  const wished = !!wl?.ids.includes(p.id);
  const specs: [string, string | undefined][] = [['Materials', p.materials?.join(', ')], ['Dimensions', p.dimensions], ['Colours', p.colors?.join(', ')], ['Care', p.careInstructions], ['Personalisation', p.personalizationOptions]];
  const flat = store?.shipping.flatRatePaise ?? 0; const free = store?.shipping.freeAboveCartPaise;
  return (
    <div className="container-page py-8">
      <nav aria-label="Breadcrumb" className="mb-6 text-sm text-muted"><Link to="/shop" className="hover:text-forest">Shop</Link> <span aria-hidden>/</span> <span aria-current="page">{p.name}</span></nav>
      <div className="grid gap-10 md:grid-cols-2 lg:gap-16">
        <Gallery images={p.images} name={p.name} />
        <div>
          <div className="flex flex-wrap gap-2"><Badge tone="forest">Handmade</Badge>{p.madeToOrder && <Badge tone="terracotta">Made to order</Badge>}{p.isSample && <Badge tone="rose">Sample listing</Badge>}</div>
          <h1 className="mt-3 text-4xl">{p.name}</h1>
          {p.creator && <p className="mt-2 text-muted">by <Link to={`/creators/${p.creator.slug}`} className="link">{p.creator.name}</Link></p>}
          <Price paise={p.pricePaise} className="mt-4 block text-2xl font-semibold" />
          {p.rating && <p className="mt-1 text-sm text-muted">{p.rating.average} / 5 · {p.rating.count} verified review{p.rating.count === 1 ? '' : 's'}</p>}
          <p className="mt-2 text-sm" role="status">{p.available ? (p.madeToOrder ? `Made to order${p.dispatchDays != null ? ` · ships in about ${p.dispatchDays} days after you order` : ''}` : (p.maxPurchasable <= 3 ? `Only ${p.maxPurchasable} left` : 'In stock')) : <strong className="text-terracotta">Currently sold out</strong>}</p>
          <p className="mt-6 whitespace-pre-line leading-relaxed">{p.description}</p>
          {p.story && <p className="mt-4 whitespace-pre-line leading-relaxed text-muted">{p.story}</p>}

          {p.available && (
            <div className="mt-8">
              <div className="flex items-center gap-4"><span id="qty-l" className="text-sm font-medium">Quantity</span>
                <div className="inline-flex items-center border border-[#cfc5b0]" role="group" aria-labelledby="qty-l">
                  <button className="btn btn-ghost !min-h-11 px-3" aria-label="Decrease quantity" disabled={qty <= 1} onClick={() => setQty(qty - 1)}><Minus className="h-4 w-4" /></button>
                  <output className="w-10 text-center tabular-nums" aria-live="polite">{qty}</output>
                  <button className="btn btn-ghost !min-h-11 px-3" aria-label="Increase quantity" disabled={qty >= p.maxPurchasable - inCart || qty >= 20} onClick={() => setQty(qty + 1)}><Plus className="h-4 w-4" /></button></div>
                {inCart > 0 && <span className="text-sm text-muted">{inCart} already in your cart</span>}</div>
              {err && <div className="mt-4"><Alert>{err}</Alert></div>}
              <div className="mt-5 flex flex-wrap gap-3">
                <button className="btn btn-primary flex-1" disabled={setItem.isPending || inCart >= p.maxPurchasable} onClick={() => add()}>{setItem.isPending ? 'Adding…' : 'Add to cart'}</button>
                <button className="btn btn-accent flex-1" disabled={setItem.isPending || inCart >= p.maxPurchasable} onClick={() => add(true)}>Buy now</button>
                <button className="btn btn-outline px-3" aria-pressed={wished} aria-label={wished ? 'Remove from wishlist' : 'Save to wishlist'} onClick={() => me ? toggle.mutate({ id: p.id, on: !wished }, { onSuccess: () => toast(wished ? 'Removed from wishlist' : 'Saved to wishlist') }) : nav(`/login?next=/products/${p.slug}`)}><Heart className="h-5 w-5" fill={wished ? 'currentColor' : 'none'} aria-hidden /></button>
              </div>
            </div>
          )}

          <dl className="mt-8 divide-y divide-line border-y border-line text-sm">
            {specs.filter(([, v]) => v).map(([k, v]) => <div key={k} className="grid grid-cols-3 gap-4 py-3"><dt className="font-medium">{k}</dt><dd className="col-span-2 text-muted">{v}</dd></div>)}
          </dl>
          <ul className="mt-6 space-y-3 text-sm">
            <li className="flex gap-3"><Truck className="h-5 w-5 shrink-0 text-forest" aria-hidden /><span>{flat === 0 ? 'Shipping across India.' : `Shipping across India: ${formatINR(flat)}${free != null ? `, free above ${formatINR(free)}` : ''}.`} See the <Link to="/shipping-policy" className="link">shipping policy</Link>.</span></li>
            <li className="flex gap-3"><ShieldCheck className="h-5 w-5 shrink-0 text-forest" aria-hidden /><span>Read our <Link to="/returns-refunds" className="link">returns & refunds policy</Link>. Personalised items may have different terms.</span></li>
          </ul>
        </div>
      </div>
      <section className="mt-16 border-t border-line pt-10" aria-labelledby="rev"><h2 id="rev" className="text-2xl">Reviews</h2><p className="mt-2 text-muted">{p.rating ? `${p.rating.count} verified purchase review${p.rating.count === 1 ? '' : 's'}.` : 'No reviews yet.'}</p></section>
      {!!q.data?.related.length && <section className="mt-16" aria-labelledby="rel"><h2 id="rel" className="mb-6 text-2xl">You might also like</h2><ProductGrid items={q.data.related} /></section>}
    </div>
  );
}
