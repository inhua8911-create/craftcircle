import type { ProductStatus } from '../models/index.js';
import { AppError } from '../utils/errors.js';

const T: Record<ProductStatus, ProductStatus[]> = {
  draft: ['submitted'],
  submitted: ['under_review', 'changes_requested', 'rejected', 'approved'],
  under_review: ['changes_requested', 'rejected', 'approved'],
  changes_requested: ['submitted'],
  rejected: ['draft'],
  approved: ['published', 'changes_requested'],
  published: ['paused', 'submitted'], // 'submitted' = material edit needing re-approval
  paused: ['published', 'submitted'],
  archived: [],
};
export const canMove = (from: ProductStatus, to: ProductStatus) => T[from]?.includes(to) ?? false;
export function assertMove(from: ProductStatus, to: ProductStatus) {
  if (!canMove(from, to)) throw new AppError(409, 'INVALID_PRODUCT_TRANSITION', `A product cannot move from "${from}" to "${to}"`);
}
