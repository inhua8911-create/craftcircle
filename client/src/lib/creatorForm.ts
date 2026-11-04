import { rupeesToPaise } from './format';

export interface CreatorProduct {
  id: string; slug: string; name: string; description: string; story?: string; category: string; materials?: string[]; dimensions?: string; colors?: string[];
  careInstructions?: string; personalizationOptions?: string; productionDetails?: string; madeToOrder: boolean; dispatchDays?: number | null; stock: number; reserved: number;
  status: string; requiresReapproval: boolean; suggestedPricePaise?: number; proposedCreatorAmountPaise?: number; approvedSellingPricePaise?: number; approvedCreatorAmountPaise?: number;
  feedback: { note: string; at: string }[]; soldCount: number; images: string[]; updatedAt: string;
}
/** Everything is held as strings in the form (what the inputs hold); conversion to API types happens in one place. */
export interface FormState {
  name: string; description: string; story: string; category: string; materials: string; dimensions: string; colors: string; careInstructions: string; personalizationOptions: string; productionDetails: string;
  madeToOrder: boolean; dispatchDays: string; stock: string; suggested: string; creatorAmt: string; images: string[];
}
export const emptyForm: FormState = { name: '', description: '', story: '', category: '', materials: '', dimensions: '', colors: '', careInstructions: '', personalizationOptions: '', productionDetails: '', madeToOrder: false, dispatchDays: '', stock: '0', suggested: '', creatorAmt: '', images: [] };

const rup = (p?: number | null) => (p == null ? '' : String(p / 100));
export const fromProduct = (p: CreatorProduct): FormState => ({
  name: p.name, description: p.description, story: p.story ?? '', category: p.category, materials: (p.materials ?? []).join(', '), dimensions: p.dimensions ?? '', colors: (p.colors ?? []).join(', '),
  careInstructions: p.careInstructions ?? '', personalizationOptions: p.personalizationOptions ?? '', productionDetails: p.productionDetails ?? '', madeToOrder: p.madeToOrder,
  dispatchDays: p.dispatchDays == null ? '' : String(p.dispatchDays), stock: String(p.stock), suggested: rup(p.suggestedPricePaise), creatorAmt: rup(p.proposedCreatorAmountPaise), images: [...p.images],
});
export const splitList = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean);
const toPaise = (s: string) => (s.trim() === '' || !Number.isFinite(Number(s)) ? undefined : rupeesToPaise(Number(s)));

type Convert = (f: FormState) => unknown;
const FIELDS: Record<string, { key: keyof FormState; to: Convert; skipWhenBlank?: boolean }> = {
  name: { key: 'name', to: (f) => f.name.trim() }, description: { key: 'description', to: (f) => f.description.trim() }, story: { key: 'story', to: (f) => f.story.trim() },
  category: { key: 'category', to: (f) => f.category }, materials: { key: 'materials', to: (f) => splitList(f.materials) }, dimensions: { key: 'dimensions', to: (f) => f.dimensions.trim() },
  colors: { key: 'colors', to: (f) => splitList(f.colors) }, careInstructions: { key: 'careInstructions', to: (f) => f.careInstructions.trim() },
  personalizationOptions: { key: 'personalizationOptions', to: (f) => f.personalizationOptions.trim() }, productionDetails: { key: 'productionDetails', to: (f) => f.productionDetails.trim() },
  madeToOrder: { key: 'madeToOrder', to: (f) => f.madeToOrder }, dispatchDays: { key: 'dispatchDays', to: (f) => Number(f.dispatchDays), skipWhenBlank: true },
  stock: { key: 'stock', to: (f) => Number(f.stock || 0) }, suggestedPricePaise: { key: 'suggested', to: (f) => toPaise(f.suggested), skipWhenBlank: true },
  proposedCreatorAmountPaise: { key: 'creatorAmt', to: (f) => toPaise(f.creatorAmt), skipWhenBlank: true }, images: { key: 'images', to: (f) => f.images },
};
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Payload for creating a product: only fields that have a value. */
export function createPayload(f: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [api, d] of Object.entries(FIELDS)) {
    const v = d.to(f); const blank = d.skipWhenBlank ? f[d.key] === '' : (typeof v === 'string' && v === '') || (Array.isArray(v) && v.length === 0);
    if (!blank && v !== undefined) out[api] = v;
  }
  return out;
}
/**
 * Payload for editing: ONLY fields whose value changed. This matters: the server treats any "material" field present in an edit of a live product
 * as needing re-approval, even if the value is unchanged, so sending the whole form would take a live listing offline for no reason.
 */
export function diffPayload(original: FormState, current: FormState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [api, d] of Object.entries(FIELDS)) {
    if (same(original[d.key], current[d.key])) continue;
    if (d.skipWhenBlank && current[d.key] === '') continue; // the API cannot clear numeric fields
    const v = d.to(current); if (v !== undefined) out[api] = v;
  }
  return out;
}
export const MATERIAL = ['name', 'description', 'category', 'materials', 'dimensions', 'madeToOrder', 'productionDetails', 'personalizationOptions', 'suggestedPricePaise', 'proposedCreatorAmountPaise', 'images'];
export const isMaterialChange = (payload: Record<string, unknown>) => Object.keys(payload).some((k) => MATERIAL.includes(k));

export function validateForm(f: FormState): Record<string, string> {
  const e: Record<string, string> = {};
  if (f.name.trim().length < 2) e.name = 'Give your product a name';
  if (f.description.trim().length < 10) e.description = 'Describe the product in at least 10 characters';
  if (!f.category) e.category = 'Choose a category';
  const s = toPaise(f.suggested); const c = toPaise(f.creatorAmt);
  if (f.suggested !== '' && (s == null || s < 100)) e.suggested = 'Enter a price of at least ₹1';
  if (f.creatorAmt !== '' && (c == null || c < 100)) e.creatorAmt = 'Enter an amount of at least ₹1';
  if (s != null && c != null && s <= c) e.suggested = 'The retail price must be higher than the amount you receive';
  if (f.stock !== '' && !/^\d+$/.test(f.stock)) e.stock = 'Use a whole number';
  if (f.dispatchDays !== '' && !/^\d+$/.test(f.dispatchDays)) e.dispatchDays = 'Use a whole number of days';
  return e;
}
export const STATUS_HELP: Record<string, string> = {
  draft: 'Only you can see this. Submit it when it is ready.', submitted: 'Waiting for our team to review it.', under_review: 'Our team is reviewing it.',
  changes_requested: 'We asked for changes. Update the product and submit it again.', rejected: 'Not approved. You can edit it and submit again.', approved: 'Approved. It will go live once our team publishes it.',
  published: 'Live in the store.', paused: 'Hidden from the store. Resume it any time.', archived: 'Archived.',
};
