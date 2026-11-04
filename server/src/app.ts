import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import mongoose from 'mongoose';
import { apiLimiter, corsOrigins, csrfProtection, sanitizeInput } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/common.js';
import { authRouter } from './routes/auth.js';
import { adminUsersRouter } from './routes/adminUsers.js';
import { catalogRouter } from './routes/catalog.js';
import { cartRouter } from './routes/cart.js';
import { checkoutRouter } from './routes/checkout.js';
import { adminOrdersRouter } from './routes/adminOrders.js';
import { webhookRouter } from './routes/webhooks.js';
import { adminCreatorAppsRouter, applicantRouter } from './routes/creatorApplications.js';
import { notificationsRouter, uploadsRouter } from './routes/notificationsUploads.js';
import { creatorProductsRouter } from './routes/creatorProducts.js';
import { adminProductsRouter } from './routes/adminProducts.js';
import { creatorPortalRouter } from './routes/creatorPortal.js';
import { adminCreatorsRouter } from './routes/adminCreatorsPayouts.js';
import { accountRouter, sitemapHandler } from './routes/account.js';
import { adminOpsRouter } from './routes/adminOps.js';
import { UPLOAD_DIR } from './services/uploads.js';
import { brand } from './config/brand.js';
import { cookieSecure, demoMode, env } from './config/env.js';
import { StoredImage } from './models/index.js';
import { asyncHandler } from './middleware/common.js';
import path from 'node:path';
import fs from 'node:fs';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  // Don't force https on plain-http local runs of the production build; keep helmet's other defaults.
  app.use(helmet({ contentSecurityPolicy: { directives: { 'upgrade-insecure-requests': cookieSecure ? [] : null } } }));
  app.use(cors({ origin: corsOrigins(), credentials: true, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], allowedHeaders: ['Content-Type', 'x-csrf-token'] }));
  // Webhooks need the raw body for signature checks, so they mount BEFORE json parsing and CSRF.
  app.use('/api/v1/payments/webhooks', webhookRouter);
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());
  app.use(sanitizeInput);

  app.use('/sample', express.static(path.join(import.meta.dirname, '..', 'public', 'sample'), { maxAge: '1d' })); // labelled placeholder art only

  if (demoMode) { // images live in MongoDB (see services/uploads.ts); names are server-generated 32-hex + sniffed extension
    app.get('/uploads/:name', asyncHandler(async (req, res, next) => {
      const name = String(req.params.name);
      if (!/^[a-f0-9]{32}\.(jpg|png|webp)$/.test(name)) return next();
      const img = await StoredImage.findOne({ name }).lean();
      if (!img) return next();
      res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' }).send(Buffer.from(img.data.buffer));
    }));
  }
  app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '7d', index: false, dotfiles: 'deny' })); // only server-named, sniffed JPEG/PNG/WebP files live here

  app.get('/sitemap.xml', sitemapHandler);
  app.get('/robots.txt', (_req, res) => res.type('text/plain').send(`User-agent: *\nDisallow: /api/\nDisallow: /account\nDisallow: /admin\nDisallow: /creator\nDisallow: /checkout\nDisallow: /cart\nSitemap: ${(process.env.PUBLIC_URL ?? env.CLIENT_ORIGIN.split(',')[0]!).replace(/\/$/, '')}/sitemap.xml\n`));

  const api = express.Router();
  api.use(apiLimiter);
  api.get('/health', (_req, res) => {
    const dbUp = mongoose.connection.readyState === 1;
    res.status(dbUp ? 200 : 503).json({ status: dbUp ? 'ok' : 'degraded', db: dbUp ? 'up' : 'down', brand: brand.name, paymentMode: env.PAYMENT_MODE });
  });
  api.use(csrfProtection); // webhook routes (signature-verified) will be mounted above this line
  api.use('/auth', authRouter);
  api.use('/admin', adminUsersRouter);
  api.use('/', applicantRouter, notificationsRouter, uploadsRouter, creatorProductsRouter, creatorPortalRouter, adminProductsRouter, adminCreatorsRouter, adminOpsRouter);
  api.use('/admin', adminCreatorAppsRouter);
  api.use('/', accountRouter);
  api.use('/admin', adminOrdersRouter);
  api.use('/cart', cartRouter);
  api.use('/', catalogRouter);
  api.use('/', checkoutRouter);
  app.use('/api/v1', api);

  // Single-origin deployment: if the client has been built (client/dist), this server serves it too.
  const clientDist = path.join(import.meta.dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(path.join(clientDist, 'index.html'))) {
    app.use(express.static(clientDist, { index: false, maxAge: '1h', setHeaders: (res, f) => { if (f.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'); } }));
    app.get(/^\/(?!api\/|uploads\/|sample\/).*/, (_req, res) => res.sendFile(path.join(clientDist, 'index.html')));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
