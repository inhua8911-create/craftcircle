import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import type { Order } from '../lib/types';
import { useSeo } from '../hooks/useSeo';
import { Alert, Price, Spinner } from '../components/ui';

export function CheckoutSuccess() {
  useSeo({ title: 'Order confirmed', noindex: true });
  const id = useSearchParams()[0].get('order');
  // The page asks the server (never trusts the redirect). It polls briefly in case the payment webhook is a moment behind.
  const q = useQuery({ queryKey: ['order', id], enabled: !!id, queryFn: () => api<{ order: Order }>(`/orders/${id}`), refetchInterval: (s) => (s.state.data?.order.paymentStatus === 'paid' || s.state.dataUpdateCount > 10 ? false : 3000) });
  const o = q.data?.order;
  return (
    <div className="container-page max-w-xl py-16 text-center">
      {!o ? <Spinner /> : o.paymentStatus === 'paid' ? (<>
        <CheckCircle2 className="mx-auto h-12 w-12 text-forest" aria-hidden /><h1 className="mt-4 text-4xl">Thank you!</h1>
        <p className="mt-3 text-muted">Order <strong>{o.orderNumber}</strong> is confirmed. We'll email updates as it's prepared and shipped.</p>
        {o.simulated && <div className="mt-6 text-left"><Alert tone="info"><strong>This was a simulated payment.</strong> No money was charged and no real order will be fulfilled.</Alert></div>}
        <p className="mt-6">Total <Price paise={o.totalPaise} className="font-semibold" /></p>
        <div className="mt-8 flex justify-center gap-3"><Link to={`/account/orders/${o.id}`} className="btn btn-primary">View order</Link><Link to="/shop" className="btn btn-outline">Keep shopping</Link></div></>
      ) : (<><h1 className="text-3xl">Confirming your payment…</h1><p className="mt-3 text-muted">Order {o.orderNumber} is not marked as paid yet. If you completed payment it should update in a moment.</p><Link to={`/account/orders/${o.id}`} className="btn btn-outline mt-6">Check order status</Link></>)}
    </div>
  );
}
export function CheckoutCancel() {
  useSeo({ title: 'Payment not completed', noindex: true });
  const id = useSearchParams()[0].get('order');
  return (
    <div className="container-page max-w-xl py-16 text-center"><h1 className="text-4xl">Payment not completed</h1>
      <p className="mt-3 text-muted">Your order is saved and your items are held for a short time. You can finish paying whenever you're ready.</p>
      <div className="mt-8 flex justify-center gap-3">{id && <Link to={`/account/orders/${id}`} className="btn btn-primary">Go to my order</Link>}<Link to="/cart" className="btn btn-outline">Back to cart</Link></div></div>
  );
}
