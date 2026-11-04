import { StoreSettings } from '../models/index.js';
import { expireReservations } from './checkout.js';
import { promoteEligibleEarnings } from './earnings.js';
import { logger } from '../utils/logger.js';

/** Single-instance timers. If you run several API instances, run these from ONE worker/cron instead (see README). */
export function startJobs() {
  const run = (name: string, fn: () => Promise<unknown>) => async () => { try { const n = await fn(); if (n) logger.info({ job: name, affected: n }, 'job ran'); } catch (e) { logger.error({ job: name, err: (e as Error).message }, 'job failed'); } };
  const t1 = setInterval(run('expireReservations', () => expireReservations()), 5 * 60_000);
  const t2 = setInterval(run('promoteEligibleEarnings', async () => promoteEligibleEarnings(new Date(), (await StoreSettings.findOne({ key: 'default' }))?.settlementHoldDays ?? 7)), 60 * 60_000);
  t1.unref(); t2.unref();
}
