import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api, ApiError, resetCsrf } from '../lib/api';
import type { CartView, Me, Product, StoreInfo } from '../lib/types';

export const useMe = () => useQuery({
  queryKey: ['me'], staleTime: 5 * 60_000, retry: false,
  queryFn: async () => { try { return (await api<{ user: Me }>('/auth/me')).user; } catch (e) { if (e instanceof ApiError && e.status === 401) return null; throw e; } },
});
export const useStore = () => useQuery({ queryKey: ['store'], queryFn: () => api<StoreInfo>('/store'), staleTime: 5 * 60_000 });
export const useCart = () => useQuery({ queryKey: ['cart'], queryFn: () => api<CartView>('/cart') });
export const cartCount = (c?: CartView) => c?.items.reduce((n, l) => n + l.quantity, 0) ?? 0;

export function useSetCartItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { productId: string; quantity: number }) => api<CartView>('/cart/items', { method: 'PUT', body: v }),
    onSuccess: (cart) => qc.setQueryData(['cart'], cart),
  });
}
export function useWishlist() {
  const { data: me } = useMe();
  return useQuery({ queryKey: ['wishlist'], enabled: !!me, queryFn: () => api<{ ids: string[]; items: Product[] }>('/wishlist') });
}
export function useToggleWishlist() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => api(`/wishlist/${id}`, { method: on ? 'PUT' : 'DELETE' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['wishlist'] }),
  });
}
/** After sign-in/registration: refresh identity, fold the guest cart into the account cart, reset caches tied to the user. */
export async function afterAuth(qc: QueryClient) {
  resetCsrf();
  await qc.invalidateQueries({ queryKey: ['me'] });
  try { qc.setQueryData(['cart'], await api<CartView>('/cart/merge', { method: 'POST' })); } catch { await qc.invalidateQueries({ queryKey: ['cart'] }); }
  qc.invalidateQueries({ queryKey: ['wishlist'] });
}
export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSuccess: () => { resetCsrf(); qc.setQueryData(['me'], null); qc.removeQueries({ queryKey: ['wishlist'] }); qc.removeQueries({ queryKey: ['orders'] }); qc.invalidateQueries({ queryKey: ['cart'] }); },
  });
}
