import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { api, ApiError, fieldErrors, resetCsrf } from './lib/api';
import { formatINR, idempotencyKey } from './lib/format';
import { safeNext } from './components/RequireAuth';
import { ProductCard } from './components/ProductCard';
import { PaymentPanel } from './components/PaymentPanel';
import { ToastProvider } from './components/Toast';
import type { Order, PaymentIntent, Product } from './lib/types';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
afterEach(() => { vi.unstubAllGlobals(); resetCsrf(); });

describe('money formatting', () => {
  it('shows whole rupees without decimals and keeps paise when present', () => {
    expect(formatINR(59900)).toBe('₹599'); expect(formatINR(59950)).toBe('₹599.50'); expect(formatINR(0)).toBe('₹0'); expect(formatINR(123456700)).toBe('₹12,34,567');
  });
});
describe('idempotencyKey', () => {
  it('is stable for identical payloads and different otherwise', async () => {
    const a = await idempotencyKey({ x: 1 }); expect(await idempotencyKey({ x: 1 })).toBe(a); expect(await idempotencyKey({ x: 2 })).not.toBe(a); expect(a).toHaveLength(48);
  });
});
describe('safeNext (open-redirect guard)', () => {
  it.each(['//evil.com', 'https://evil.com', 'javascript:alert(1)', '/\\evil.com', null])('rejects %s', (v) => expect(safeNext(v as string | null)).toBe('/account'));
  it('allows local paths with query strings', () => { expect(safeNext('/checkout')).toBe('/checkout'); expect(safeNext('/products/a-b?x=1')).toBe('/products/a-b?x=1'); });
});
describe('api client', () => {
  it('sends the CSRF header on unsafe requests only, and retries once if the token was rejected', async () => {
    const calls: { url: string; method: string; csrf?: string }[] = []; let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const h = (init?.headers ?? {}) as Record<string, string>; calls.push({ url, method: init?.method ?? 'GET', csrf: h['x-csrf-token'] });
      if (url.endsWith('/auth/csrf')) return json(200, { csrfToken: `tok${calls.filter((c) => c.url.endsWith('/auth/csrf')).length}` });
      if (init?.method === 'POST' && posts++ === 0) return json(403, { error: { code: 'CSRF_FAILED', message: 'bad token' } });
      return json(200, { ok: true });
    }));
    await expect(api('/things')).resolves.toEqual({ ok: true });
    expect(calls.find((c) => c.url.endsWith('/things'))?.csrf).toBeUndefined();
    await expect(api('/things', { method: 'POST', body: { a: 1 } })).resolves.toEqual({ ok: true });
    const posted = calls.filter((c) => c.method === 'POST'); expect(posted).toHaveLength(2); expect(posted[0]!.csrf).toBe('tok1'); expect(posted[1]!.csrf).toBe('tok2');
  });
  it('turns server errors and network failures into ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(409, { error: { code: 'OUT_OF_STOCK', message: 'Not enough stock' } })));
    await expect(api('/x')).rejects.toMatchObject({ status: 409, code: 'OUT_OF_STOCK', message: 'Not enough stock' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(api('/x')).rejects.toMatchObject({ code: 'NETWORK' });
  });
  it('maps validation details to field errors', () => {
    expect(fieldErrors(new ApiError(422, 'VALIDATION_ERROR', 'x', [{ field: 'address.postalCode', message: 'Enter a valid PIN' }]))).toEqual({ 'address.postalCode': 'Enter a valid PIN' });
    expect(fieldErrors(new Error('x'))).toEqual({});
  });
});

const product: Product = { id: 'p1', slug: 'leaf', name: 'Brass Leaf Pendant', description: 'd', pricePaise: 89900, madeToOrder: false, dispatchDays: null, featured: false, isSample: true, rating: null, soldCount: 0, category: 'c', creator: { slug: 'asha', name: 'Asha' }, images: [{ url: '/sample/jewellery.svg', alt: 'Sample' }], available: true, maxPurchasable: 5 };
const wrap = (ui: React.ReactNode, route = '/shop') => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Where = () => <p data-testid="loc">{useLocation().pathname + useLocation().search}</p>;
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[route]}><ToastProvider><Routes><Route path="*" element={<>{ui}<Where /></>} /></Routes></ToastProvider></MemoryRouter></QueryClientProvider>);
};
describe('ProductCard', () => {
  it('shows price, maker and sample label; a signed-out wishlist tap goes to login and remembers where to return', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/auth/me') ? json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } }) : json(200, {}))));
    wrap(<ProductCard product={product} />);
    expect(screen.getByText('₹899')).toBeInTheDocument(); expect(screen.getByText('by Asha')).toBeInTheDocument(); expect(screen.getByText('Sample')).toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    await userEvent.click(screen.getByRole('button', { name: /save brass leaf pendant to wishlist/i }));
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/login?next=%2Fshop'));
  });
  it('marks sold-out items', () => {
    vi.stubGlobal('fetch', vi.fn(async () => json(401, { error: { code: 'UNAUTHORIZED', message: 'x' } })));
    wrap(<ProductCard product={{ ...product, available: false }} />); expect(screen.getByText('Sold out')).toBeInTheDocument();
  });
});
describe('PaymentPanel (demo mode)', () => {
  const order = { id: 'o1', orderNumber: 'CC-1', totalPaise: 59900 } as Order;
  const mock: PaymentIntent = { provider: 'mock', simulated: true, providerOrderId: 'mock_1', amountPaise: 59900 };
  it('says plainly that nothing is charged and only reports success after the server confirms', async () => {
    const onPaid = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => (url.endsWith('/auth/csrf') ? json(200, { csrfToken: 't' }) : init?.method === 'POST' ? json(200, { status: 'paid' }) : json(200, {}))));
    wrap(<PaymentPanel order={order} payment={mock} onPaid={onPaid} />);
    expect(screen.getByText(/No money is charged/i)).toBeInTheDocument(); expect(screen.getByText(/Simulated payment of/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /simulate successful payment/i }));
    await waitFor(() => expect(onPaid).toHaveBeenCalledTimes(1));
    const body = JSON.parse((vi.mocked(fetch).mock.calls.find(([u]) => String(u).endsWith('/payments/mock/confirm'))![1] as RequestInit).body as string);
    expect(body).toEqual({ orderId: 'o1', outcome: 'success' });
  });
  it('does not call onPaid when the server rejects the payment, and shows the error', async () => {
    const onPaid = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('/auth/csrf') ? json(200, { csrfToken: 't' }) : json(409, { error: { code: 'ORDER_NOT_PAYABLE', message: 'This order cannot be paid' } }))));
    wrap(<PaymentPanel order={order} payment={mock} onPaid={onPaid} />);
    await userEvent.click(screen.getByRole('button', { name: /simulate successful payment/i }));
    expect(await screen.findByText('This order cannot be paid')).toBeInTheDocument(); expect(onPaid).not.toHaveBeenCalled();
  });
});
