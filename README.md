# CraftCircle (working name; configurable in `server/src/config/brand.ts`)

Handmade creator-collective marketplace. **Status: the backend covers the core marketplace loop
(apply -> approve -> list -> review -> publish -> sell -> earn -> get paid)
link: https://craftcircle-production.up.railway.app/

> **Just want it online for a project?** See [`DEPLOY.md`](DEPLOY.md): one free service + free MongoDB Atlas, no payment/email/image accounts (`DEMO_MODE=true`).

## What exists (`server/`: Express 5, TypeScript, Mongoose 9, MongoDB replica set)
- All 27 models; HttpOnly-cookie JWT auth, CSRF (double-submit), RBAC re-checked from the DB on every request, password reset,
  rate limits, strict input schemas, audited role/status changes, one-time admin bootstrap command.
- Public catalogue / search / creators / collections (creator payment and margin are never exposed); server-priced cart with guest merge.
- Checkout: atomic stock reservation, `Idempotency-Key`, coupons, 30-minute reservation expiry, cancellation.
- Payments: mock adapter (always SIMULATED, refused in production) and a Razorpay adapter (order creation, checkout signature check,
  signed idempotent webhooks, amount check, late-payment flagging).
- Orders: customer view (own orders only); admin transitions, shipment details, idempotent refunds.
- Creator applications (draft / submit / more-info / approve / reject) and the product pipeline
  (draft -> submitted -> under_review -> approved -> published) with admin-set, versioned pricing and re-approval on material edits.
- Creator portal: dashboard, itemised earnings statement, incentives progress, payout statements (CSV, formula-injection safe), profile, payout reference details.
- Admin: creators (suspend/reactivate hides products and holds earnings), product moderation, payouts (draft/approve/mark paid/fail/cancel,
  optional second approver), incentive campaigns.
- Image uploads validated by magic bytes (JPEG/PNG/WebP, 5 MB), in-app notifications (email only when a provider is configured).
- Background jobs: reservation expiry and earnings eligibility (in-process timers).
- `npm run seed`: sample creators/products/orders built through the real services, all labelled as sample data.

## Storefront (`client/`: React 19, Vite, TypeScript, Tailwind 4, React Router, TanStack Query, React Hook Form + Zod)
Home, shop, category, product (gallery with enlarge, structured data), creator and collection pages, search, cart, sign-in/up/reset,
checkout (live price quote, saved addresses, coupon, idempotent order creation, clearly-labelled simulated payment panel or Razorpay Checkout),
order history and detail (pay/cancel unpaid), addresses, wishlist, profile and password change, creator application (with photo upload),
info/policy pages (policies are marked as unreviewed drafts), 404, per-page titles/meta/canonical/Open Graph, sitemap and robots.
Self-hosted fonts, route-level code splitting (initial JS about 125 kB gzipped), skip link, keyboard and screen-reader labelling, reduced-motion support.

## Admin dashboard (`/admin`, staff only; separate lazy-loaded chunk)
Overview (needs-attention counts; financials with a Live / Simulated switch and every metric defined; platform revenue is gross margin, NOT profit),
creator applications (review, approve, request info, reject), creators (balances, suspend/reactivate with audited reason), product moderation
(set the final selling price and agreed creator amount with a margin preview, approve/publish/request changes/reject, versioned repricing, feature, stock, archive),
orders (valid-transition fulfilment buttons, tracking required to ship, refunds that need a provider reference for real-money orders), payouts (balances, draft, approve,
mark paid with mandatory bank reference, fail, cancel, CSV statements), promo codes, reports (preview + CSV, no customer PII), store settings, users (suspend; role change for super admins), read-only audit log.
Accessibility: axe-core reports 0 WCAG 2.1 A/AA violations on the 14 admin pages scanned.

## Creator portal (`/creator/*`, approved creators only; lazy-loaded)
Dashboard (action items; sales and earnings defined separately: confirmed sales vs agreed per-unit earnings, pending / available / paid out; best sellers; recent orders with no customer details),
products (list, add, edit, submit; pause/resume/archive; feedback from reviewers shown inline), a product form that locks while a product is in review, sends only changed fields,
shows the admin-agreed terms, and asks for explicit confirmation before a change that takes a live product offline for re-approval, itemised earnings statement with CSV and payout statements,
incentive progress with a "not guaranteed" notice, notifications (also available to applicants at /account/notifications), public profile controls and payout reference details (last 4 digits, IFSC, UPI only).
Accessibility: axe-core reports 0 WCAG 2.1 A/AA violations on the 9 creator pages scanned.

## Run locally
    cd server && npm install && cp ../.env.example .env     # set JWT_SECRET
    # MongoDB MUST be a replica set (transactions): mongod --replSet rs0 ... then rs.initiate()
    npm run seed -- --reset      # optional, development only, PAYMENT_MODE=mock
    npm run dev
    ADMIN_BOOTSTRAP_EMAIL=you@example.com ADMIN_BOOTSTRAP_PASSWORD='...' npm run bootstrap-admin
    npm test                      # see docs/TESTING.md
    cd ../client && npm install && npm run dev      # http://localhost:5173 (proxies /api, /sample, /uploads to :4000)
    # production: serve client/dist and the API from ONE origin (reverse proxy /api, /uploads, /sitemap.xml, /robots.txt to the API)

## Money rules (implemented and tested)
- Integer paise everywhere. Margin = approved selling price - agreed creator amount, derived on the server; products with missing or inconsistent terms cannot publish or be sold.
- Discounts come out of platform margin; creator amounts are never reduced; a discount that makes any line's margin negative is rejected.
- Orders snapshot the commercial terms at purchase; later price changes only affect new orders.
- Ledger and audit log are append-only (model-level guards); corrections are compensating entries.
- Earnings exist only for orders with verified payment, once per order item. Refunds post compensating entries; a refund after payout shows as a negative balance.
- Payouts reserve their earnings, need a bank reference, and go stale if a refund lands mid-flight. They record manual bank transfers; the app never moves money.

## Payments
- `PAYMENT_MODE=mock` (default): no money moves; orders are flagged simulated. Refused in production.
- `PAYMENT_MODE=razorpay`: set `RAZORPAY_KEY_ID/KEY_SECRET/WEBHOOK_SECRET`, point the webhook at `/api/v1/payments/webhooks/razorpay`
  (`payment.captured`, `payment.failed`). Without credentials these endpoints return 503. Refunds are NOT sent to Razorpay by this app:
  refund in the Razorpay dashboard, then record the reference via `POST /admin/orders/:id/refund`.
- A payment that arrives after its order expired is recorded and flagged in the audit log (`payment.captured_for_closed_order`) for manual refund.

## Known gaps (honest list)
- Not built: content CMS beyond the announcement bar and contact/social settings (category banners, homepage sections, FAQs, collections are DB-only or static),
  reviews (the product page shows "No reviews yet"; there is no review API), contact form (page shows email only), creator-specific selling terms, admin editing of listing text, return-request endpoints, cash on delivery, HTML email templates, newsletter confirmation emails.
- Incentives: campaigns are managed via the API only (no admin screen); creators see progress, but approving and paying a bonus (ledger entry) is not implemented.
- Creators cannot change agreed terms themselves (they ask the team); admin product editing is limited to pricing, featuring, stock and archiving; listing text is edited by the creator (material edits go back through approval).
- **Unverified against the real services:** Razorpay (server calls and the browser Checkout widget), Cloudinary, Resend (no network access during development).
  Undelivered email is recorded as `not_configured`.
- Browser testing covered Firefox headless only (desktop 1280 and mobile 390 widths); no Chrome/Safari run, no screen-reader testing, no load testing.
- Jobs are single-instance timers (`DISABLE_JOBS=true` to turn off; with several API instances run them from one worker).
- Local-disk uploads (`server/uploads`) are unsuitable for multi-instance or ephemeral hosting: configure Cloudinary there.
- Product photos are labelled placeholder SVGs from `server/public/sample/`; replace with real photography before launch.
