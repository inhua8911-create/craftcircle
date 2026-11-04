import { createApp } from './app.js';
import { connectDb } from './config/db.js';
import { demoMode, env } from './config/env.js';
import { logger } from './utils/logger.js';
import { startJobs } from './services/jobs.js';
import { demoBootstrap } from './demoBootstrap.js';

await connectDb();
if (demoMode) await demoBootstrap();
createApp().listen(env.PORT, () => logger.info(`API listening on :${env.PORT} (payments: ${env.PAYMENT_MODE}${demoMode ? ', DEMO_MODE' : ''})`));
if (process.env.DISABLE_JOBS !== 'true') startJobs();
