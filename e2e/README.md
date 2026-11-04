# Browser tests

Real-browser journeys (Firefox headless via Selenium/geckodriver). Playwright's browser download was blocked in the
build environment, so these use Selenium; the flows port directly to Playwright where its browsers can be installed.
Only Firefox has been exercised; Chrome and Safari are untested.

Prereqs: API running (seeded with `npm run seed`, `PAYMENT_MODE=mock`) and the client (`npm run dev` in `client/`).

    pip install selenium
    BASE_URL=http://localhost:5173 FIREFOX_BIN=/path/to/firefox GECKODRIVER=/path/to/geckodriver python3 e2e/purchase.py
    python3 e2e/apply.py
    AXE_PATH=/path/to/axe.min.js python3 e2e/a11y.py

- `purchase.py`: search, cart, sign up mid-checkout (guest cart merges), address, simulated payment, order history, wishlist, auth redirect, mobile menu, 404 (15 steps).
- `apply.py`: creator application with real file upload, rejected disguised file, draft, submit (5 steps).
- `admin.py`: the whole marketplace loop through the ADMIN UI (15 steps): applicant approved, product priced and published, customer buys, order shipped and delivered, earnings cleared, payout drafted/approved/paid with a mandatory reference, overview/reports/promotions/settings/audit, and staff-only access. Needs a bootstrapped admin (`ADMIN_EMAIL`, `ADMIN_PASSWORD`), `SERVER_DIR`, `MONGODB_URI`, `JWT_SECRET` (for the date-backdating helper `server/scripts/ageOrder.ts`) and the API started with `DISABLE_RATE_LIMIT=true` (local only; refused in production).
- `creator.py`: the creator portal (12 steps): dashboard, price validation, draft and photo upload, submit-and-lock, change requests and resubmission, approval and publication, stock edit stays live, material edit needs confirmation and goes offline, pause/resume, earnings and incentives, payout-detail validation and privacy, notifications, access boundaries. Uses the seeded creator `asha-menon@sample.craftcircle.test`.
- `a11y_creator.py`: axe-core scan of 9 creator pages (currently 0 violations).
- `a11y_admin.py`: axe-core scan of 14 admin pages (currently 0 violations).
- `a11y.py`: axe-core WCAG 2.1 A/AA on 10 pages (currently 0 violations).
