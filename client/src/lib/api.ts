const BASE = '/api/v1';
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
let csrf: string | null = null;
async function csrfToken(force = false) {
  if (!csrf || force) {
    const r = await fetch(`${BASE}/auth/csrf`, { credentials: 'include' });
    csrf = ((await r.json()) as { csrfToken: string }).csrfToken;
  }
  return csrf;
}
export const resetCsrf = () => { csrf = null; };

interface Opts { method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; body?: unknown; headers?: Record<string, string>; }
export async function api<T = unknown>(path: string, opts: Opts = {}, retry = true): Promise<T> {
  const method = opts.method ?? 'GET';
  const unsafe = method !== 'GET';
  const headers: Record<string, string> = { Accept: 'application/json', ...opts.headers };
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (unsafe) headers['x-csrf-token'] = await csrfToken();
  let res: Response;
  try { res = await fetch(`${BASE}${path}`, { method, headers, credentials: 'include', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }); }
  catch { throw new ApiError(0, 'NETWORK', 'Could not reach the server. Check your connection and try again.'); }
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const e = (data as { error?: { code: string; message: string; details?: unknown } } | null)?.error;
    if (retry && unsafe && e?.code === 'CSRF_FAILED') { await csrfToken(true); return api<T>(path, opts, false); } // cookie was cleared or rotated
    throw new ApiError(res.status, e?.code ?? 'ERROR', e?.message ?? 'Something went wrong', e?.details);
  }
  return data as T;
}

export async function uploadImage(file: File): Promise<{ url: string }> {
  const form = new FormData(); form.set('file', file);
  const res = await fetch(`${BASE}/uploads/images`, { method: 'POST', credentials: 'include', headers: { 'x-csrf-token': await csrfToken() }, body: form });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? 'ERROR', data?.error?.message ?? 'Upload failed');
  return data;
}
/** Field-level messages from a 422 VALIDATION_ERROR, keyed by field name. */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || e.code !== 'VALIDATION_ERROR' || !Array.isArray(e.details)) return {};
  return Object.fromEntries((e.details as { field: string; message: string }[]).map((d) => [d.field, d.message]));
}
