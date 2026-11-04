import { describe, expect, it } from 'vitest';
import { createPayload, diffPayload, emptyForm, fromProduct, isMaterialChange, splitList, validateForm, type CreatorProduct } from './lib/creatorForm';

const product: CreatorProduct = { id: 'p1', slug: 's', name: 'Brass Leaf Pendant', description: 'A hand-cut brass leaf on a cotton cord.', category: 'c1', materials: ['brass', 'cotton'], madeToOrder: false, dispatchDays: 3, stock: 5, reserved: 0, status: 'published', requiresReapproval: false, suggestedPricePaise: 89900, proposedCreatorAmountPaise: 60000, approvedSellingPricePaise: 89900, approvedCreatorAmountPaise: 60000, feedback: [], soldCount: 0, images: ['/uploads/a.png'], updatedAt: '' };

describe('creator product form', () => {
  it('round-trips a product without producing any changes', () => {
    const f = fromProduct(product); expect(diffPayload(f, { ...f })).toEqual({});
    expect(f.suggested).toBe('899'); expect(f.creatorAmt).toBe('600'); expect(f.materials).toBe('brass, cotton');
  });
  it('sends ONLY changed fields, so editing stock never triggers re-approval', () => {
    const f = fromProduct(product); const p = diffPayload(f, { ...f, stock: '9' });
    expect(p).toEqual({ stock: 9 }); expect(isMaterialChange(p)).toBe(false);
  });
  it('flags material changes and converts rupees to integer paise', () => {
    const f = fromProduct(product); const p = diffPayload(f, { ...f, suggested: '999.50', materials: 'brass, silk' });
    expect(p).toEqual({ suggestedPricePaise: 99950, materials: ['brass', 'silk'] }); expect(isMaterialChange(p)).toBe(true);
  });
  it('treats image changes as material and keeps order', () => {
    const f = fromProduct(product); expect(diffPayload(f, { ...f, images: ['/uploads/b.png', '/uploads/a.png'] })).toEqual({ images: ['/uploads/b.png', '/uploads/a.png'] });
  });
  it('never sends blank numeric fields (the API cannot clear them)', () => {
    const f = fromProduct(product); expect(diffPayload(f, { ...f, dispatchDays: '' })).toEqual({});
  });
  it('builds a create payload from filled fields only', () => {
    expect(createPayload({ ...emptyForm, name: 'Planter', description: 'Hand-painted planter', category: 'c1', suggested: '899', creatorAmt: '600', stock: '4' })).toEqual({ name: 'Planter', description: 'Hand-painted planter', category: 'c1', madeToOrder: false, stock: 4, suggestedPricePaise: 89900, proposedCreatorAmountPaise: 60000 });
  });
  it('validates: required fields, positive margin, whole numbers', () => {
    expect(Object.keys(validateForm(emptyForm)).sort()).toEqual(['category', 'description', 'name']);
    expect(validateForm({ ...fromProduct(product), suggested: '500', creatorAmt: '600' }).suggested).toMatch(/higher/);
    expect(validateForm({ ...fromProduct(product), stock: '2.5' }).stock).toBeTruthy();
    expect(validateForm(fromProduct(product))).toEqual({});
  });
  it('splits comma lists and drops blanks', () => { expect(splitList(' a, ,b ,, c')).toEqual(['a', 'b', 'c']); });
});
