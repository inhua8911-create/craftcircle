# API reference (v1, base `/api/v1`)

Auth: HttpOnly session cookie. Every unsafe request (POST/PUT/PATCH/DELETE) needs the `x-csrf-token` header
echoing the `cc_csrf` cookie (obtain via `GET /auth/csrf`). Errors: `{ "error": { "code", "message", "details?" } }`.
Money is integer paise. Roles: customer, creator, admin, super_admin (authorisation is enforced server-side on every route below).

| Area | Routes | Access |
|---|---|---|
| Auth | `GET /auth/csrf` `POST /auth/register` `login` `logout` `forgot-password` `reset-password`, `GET /auth/me` | public / session |
| Catalogue | `GET /categories` `/products` `/products/:slug` `/creators/:slug` `/search?q=` `/collections` `/collections/:slug` | public |
| Cart | `GET/DELETE /cart`, `PUT /cart/items`, `POST /cart/merge` | guest or customer |
| Checkout | `POST /checkout` (header `Idempotency-Key`), `POST /orders/:id/pay`, `GET /orders`, `GET /orders/:id`, `POST /orders/:id/cancel` | customer (own orders) |
| Payments | `POST /payments/mock/confirm` (dev only), `POST /payments/razorpay/verify`, `POST /payments/webhooks/razorpay` (signature) | customer / provider |
| Uploads | `POST /uploads/images` (multipart `file`; JPEG/PNG/WebP, 5 MB) | signed in |
| Notifications | `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | owner |
| Creator application | `GET/POST /creator/application` (`submit: true` to submit) | customer |
| Creator portal | `GET /creator/dashboard` `/earnings[?format=csv]` `/payouts` `/payouts/:id/statement[?format=csv]` `/incentives` `/profile`, `PUT /creator/profile` `/creator/payout-details` | active creator |
| Creator products | `GET/POST /creator/products`, `GET/PUT /creator/products/:id`, `POST .../submit` `pause` `resume` `archive` | active creator (own products) |
| Admin: users | `GET /admin/users`, `PATCH /admin/users/:id/status`, `PATCH /admin/users/:id/role` (super_admin) | admin |
| Admin: applications | `GET /admin/applications[/:id]`, `POST /admin/applications/:id/decision` | admin |
| Admin: creators | `GET /admin/creators[/:id]`, `POST /admin/creators/:id/status` | admin |
| Admin: products | `GET /admin/products[/pending|/:id]`, `POST .../review` `publish` `archive`, `PATCH .../pricing` `merchandising` | admin |
| Admin: orders | `GET /admin/orders[/:id]`, `PATCH /admin/orders/:id/status`, `POST /admin/orders/:id/refund` (header `Idempotency-Key`) | admin |
| Admin: payouts | `GET /admin/payouts[/balances]`, `POST /admin/payouts`, `POST .../:id/approve` `pay` `fail` `cancel`, `GET .../:id/statement[?format=csv]` | admin |
| Admin: overview & audit | `GET /admin/overview[?from&to]` (live vs simulated money, defined metrics), `GET /admin/audit[?action=&entityType=]` (read-only) | admin |
| Admin: reports | `GET /admin/reports`, `GET /admin/reports/:type[?from&to&format=csv]` for orders, product-sales, creator-performance, creator-earnings, payouts, refunds, inventory, platform-revenue (no customer PII; exports audited) | admin |
| Admin: promotions & settings | `GET/POST /admin/coupons`, `PATCH /admin/coupons/:id` (activate/deactivate/extend only), `GET/PUT /admin/settings`, `GET /admin/newsletter[?format=csv]` | admin |
| Admin: incentives | `GET/POST /admin/incentives`, `POST /admin/incentives/:id/deactivate` | admin |

Product lifecycle: `draft -> submitted -> under_review -> approved -> published` (also `changes_requested`, `rejected`, `paused`, `archived`).
Editing a live product's material fields requires `acknowledgeReapproval: true` and takes it offline until an admin re-approves.
