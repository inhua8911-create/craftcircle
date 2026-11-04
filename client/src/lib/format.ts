import { brand } from '../config/brand';
/** Money arrives as integer paise; display only. Anything that is charged is computed by the server. */
export function formatINR(paise: number): string {
  const rupees = paise / 100;
  const whole = Number.isInteger(rupees);
  return new Intl.NumberFormat(brand.currencyLocale, { style: 'currency', currency: 'INR', minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 }).format(rupees);
}
export const rupeesToPaise = (r: number) => Math.round(r * 100);
export const formatDate = (iso: string) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(new Date(iso));
export const statusLabel = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
/** Same payload => same key (safe retries); different payload => new key. */
export async function idempotencyKey(payload: unknown): Promise<string> {
  const data = new TextEncoder().encode(JSON.stringify(payload));
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 48);
}
