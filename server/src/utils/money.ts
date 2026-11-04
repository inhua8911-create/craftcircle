// All money is stored and computed as integer paise (1 INR = 100 paise).
// No floating point arithmetic is ever applied to monetary values.
export type Paise = number;

export function assertPaise(n: number, label = 'amount'): asserts n is Paise {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be an integer number of paise`);
}

export function rupeesToPaise(rupees: number): Paise {
  return Math.round(rupees * 100);
}

export function formatINR(paise: Paise): string {
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  const rupees = Math.floor(abs / 100);
  const rem = String(abs % 100).padStart(2, '0');
  return `${sign}₹${rupees.toLocaleString('en-IN')}.${rem}`;
}

/**
 * Split `total` across weights so the parts sum EXACTLY to total
 * (largest-remainder method). Deterministic: ties go to the earlier index.
 */
export function allocateProportionally(total: Paise, weights: number[]): Paise[] {
  assertPaise(total, 'total');
  if (weights.some((w) => !Number.isSafeInteger(w) || w < 0)) throw new Error('weights must be non-negative integers');
  const sum = weights.reduce((a, b) => a + b, 0);
  if (weights.length === 0) return [];
  if (sum === 0) {
    if (total !== 0) throw new Error('cannot allocate a non-zero total across zero weights');
    return weights.map(() => 0);
  }
  const sign = total < 0 ? -1 : 1;
  const absTotal = Math.abs(total);
  const base = weights.map((w) => Math.floor((absTotal * w) / sum));
  let remainder = absTotal - base.reduce((a, b) => a + b, 0);
  const order = weights
    .map((w, i) => ({ i, frac: (absTotal * w) % sum }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (remainder === 0) break;
    base[i]! += 1;
    remainder -= 1;
  }
  return base.map((v) => v * sign);
}
