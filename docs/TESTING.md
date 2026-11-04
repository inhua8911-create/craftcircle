# Testing

Tests run against a **real MongoDB replica set** (transactions are exercised, not mocked).

    cd server && npm test

`mongodb-memory-server` downloads a `mongod` binary on first run. If your network blocks that download,
point it at a local binary:

    MONGOMS_SYSTEM_BINARY=/path/to/mongod MONGOMS_VERSION=8.x.y npm test

Server: 120 tests, 9 files. Client: 23 unit/component tests (`cd client && npm test`). Browser: 47 steps across 4 journeys + axe scans of 33 pages (see e2e/README.md).

Server coverage: pricing/discount allocation, refunds, order state machine, ledger immutability, concurrent sale
recording, payout lifecycle, auth/CSRF/RBAC/password reset, catalogue privacy, cart, checkout (overselling under concurrency, idempotency, coupons,
expiry, late payments), Razorpay signatures/webhooks/amount checks, order access control, admin orders and refunds, uploads, creator applications,
the product approval pipeline and ownership boundaries, creator dashboard/earnings/incentives, payout API lifecycle, suspension effects,
payout-detail privacy, notifications.

The workflow suite was mutation-checked: removing the ownership query, term validation, verified-sales filter, CSV guard or suspension filter
each made tests fail.

Gotcha: any test file that needs Razorpay mode must `import './razorpayEnv.js'` FIRST (config is read once at import time).
