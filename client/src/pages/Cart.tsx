import { Link, useNavigate } from 'react-router-dom';
import { Minus, Plus, Trash2 } from 'lucide-react';
import { ApiError } from '../lib/api';
import { useCart, useMe, useSetCartItem } from '../hooks/queries';
import { useSeo } from '../hooks/useSeo';
import { useToast } from '../components/Toast';
import { Alert, EmptyState, ErrorState, Img, Price, Skeleton } from '../components/ui';

export default function CartPage() {
  useSeo({ title: 'Your cart', noindex: true });
  const cart = useCart(); const set = useSetCartItem(); const { data: me } = useMe(); const nav = useNavigate(); const toast = useToast();
  const change = (productId: string, quantity: number) => set.mutate({ productId, quantity }, { onError: (e) => toast(e instanceof ApiError ? e.message : 'Could not update your cart') });
  if (cart.isError) return <ErrorState onRetry={() => cart.refetch()} />;
  if (cart.isPending) return <div className="container-page py-10"><Skeleton className="h-10 w-48" /><Skeleton className="mt-8 h-40" /></div>;
  const c = cart.data;
  if (!c.items.length) return <div className="container-page"><EmptyState title="Your cart is empty" action={{ to: '/shop', label: 'Explore the collection' }}>When you find something you love, it will wait for you here.</EmptyState></div>;
  const proceed = () => nav(me ? '/checkout' : '/login?next=/checkout');
  return (
    <div className="container-page py-10">
      <h1 className="text-4xl">Your cart</h1>
      {c.hasIssues && <div className="mt-6"><Alert>Some items are no longer available in the quantity you chose. Update or remove them to continue.</Alert></div>}
      <div className="mt-8 grid gap-10 lg:grid-cols-[1fr_22rem]">
        <ul className="divide-y divide-line border-y border-line">
          {c.items.map((l) => (
            <li key={l.productId} className="flex gap-4 py-5">
              <Link to={l.product ? `/products/${l.product.slug}` : '#'} className="w-24 shrink-0"><Img src={l.product?.images[0]?.url} alt={l.product?.images[0]?.alt ?? ''} ratio="4 / 5" className="rounded-sm" /></Link>
              <div className="flex flex-1 flex-col gap-2">
                <div className="flex justify-between gap-4">
                  <div><p className="font-medium">{l.product?.name ?? 'Unavailable item'}</p>{l.product?.creator && <p className="text-sm text-muted">by {l.product.creator.name}</p>}
                    {l.issue === 'unavailable' && <p className="mt-1 text-sm text-terracotta">No longer available</p>}{l.issue === 'insufficient_stock' && <p className="mt-1 text-sm text-terracotta">Only {l.product?.maxPurchasable} available</p>}</div>
                  {l.product && !l.issue && <Price paise={l.lineTotalPaise} className="font-semibold" />}
                </div>
                <div className="mt-auto flex items-center justify-between">
                  <div className="inline-flex items-center border border-[#cfc5b0]" role="group" aria-label={`Quantity for ${l.product?.name ?? 'item'}`}>
                    <button className="btn btn-ghost !min-h-10 px-2.5" aria-label="Decrease quantity" disabled={l.quantity <= 1 || set.isPending} onClick={() => change(l.productId, l.quantity - 1)}><Minus className="h-4 w-4" /></button>
                    <output className="w-9 text-center text-sm tabular-nums">{l.quantity}</output>
                    <button className="btn btn-ghost !min-h-10 px-2.5" aria-label="Increase quantity" disabled={set.isPending || !l.product || l.quantity >= Math.min(20, l.product.maxPurchasable)} onClick={() => change(l.productId, l.quantity + 1)}><Plus className="h-4 w-4" /></button></div>
                  <button className="btn btn-ghost text-sm text-muted" onClick={() => change(l.productId, 0)} aria-label={`Remove ${l.product?.name ?? 'item'}`}><Trash2 className="h-4 w-4" aria-hidden /> Remove</button>
                </div>
              </div>
            </li>
          ))}
        </ul>
        <aside className="card h-fit p-6" aria-labelledby="sum"><h2 id="sum" className="font-sans text-lg font-semibold">Order summary</h2>
          <dl className="mt-4 space-y-2 text-sm"><div className="flex justify-between"><dt>Subtotal</dt><dd><Price paise={c.subtotalPaise} /></dd></div><div className="flex justify-between text-muted"><dt>Shipping & discounts</dt><dd>Calculated at checkout</dd></div></dl>
          <button className="btn btn-primary mt-6 w-full" disabled={c.hasIssues} onClick={proceed}>{me ? 'Checkout' : 'Sign in to checkout'}</button>
          <Link to="/shop" className="link mt-4 block text-center text-sm">Continue shopping</Link></aside>
      </div>
    </div>
  );
}
