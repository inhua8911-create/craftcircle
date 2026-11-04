# Easy deployment (project / portfolio mode)

Goal: one website, one database, **no payment, email or image-hosting accounts**.
Set `DEMO_MODE=true` and the app does this for you:

- checkout uses the built-in **simulated payment** (a labelled "Demo mode" panel; no money moves)
- product/application photos are stored in MongoDB (no Cloudinary, no disk)
- the server serves the React site itself (one URL, no CORS or proxy setup)
- on first start it loads sample creators, products and orders, and creates your admin account

Emails are simply not sent (in-app notifications still work). Password-reset emails therefore do not work; use a password you remember.

## What you need (both free)
1. A **MongoDB Atlas** free cluster (M0). Atlas is already a replica set, which this app needs for its transactions.
   - Create a database user, and under *Network Access* allow `0.0.0.0/0` (any IP).
   - *Connect -> Drivers* gives a string like `mongodb+srv://USER:PASS@cluster0.xxxx.mongodb.net/craftcircle?retryWrites=true&w=majority`
     (keep `/craftcircle` as the database name).
2. A GitHub account (to hand the code to the host).

## Deploy on Render
1. Push this folder to a GitHub repo.
2. Render -> *New* -> *Blueprint* -> pick the repo (it reads `render.yaml`).
3. Fill in the three prompts: `MONGODB_URI`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD` (10+ characters).
4. Deploy. First start seeds the sample store (about a minute). Open the URL, sign in at `/login` with your admin email.

Free Render services sleep after ~15 minutes idle, so the first visit after a pause is slow. Any host that runs
`npm run build` then `npm start` with the same env vars works too (Railway, Fly.io, a VPS).

## Run it on your own computer (Windows, PowerShell)
```powershell
cd server
copy ..\.env.example .env
# edit .env: set JWT_SECRET (32+ chars), MONGODB_URI (your Atlas string), DEMO_MODE=true,
#            ADMIN_BOOTSTRAP_EMAIL, ADMIN_BOOTSTRAP_PASSWORD, COOKIE_SECURE=false, NODE_ENV=production
cd ..
npm run build
npm start          # http://localhost:4000
```
For development with hot reload keep using `npm run dev` in `server/` and `client/` as in the README.

## Product photos
The demo shop (3 makers, 9 products, 5 categories) ships with real photos in `server/seed-images/`; a new database picks them up on first start.
To swap a photo, replace the file (same name, see the README there) and run `npm run load-images` from the project folder.
To rebuild the demo data from scratch on a database that already has data (this DELETES everything in it, including orders and accounts):
`npm run reseed`, then `npm start` (the admin account is created again from your `.env`).

## Sample accounts
Customers: `priya-menon@sample.craftcircle.test`, `ananya-gupta@sample.craftcircle.test`. Creators: `meera-nair@sample.craftcircle.test`, `little-bloom-crafts@sample.craftcircle.test`, `aisha-khan@sample.craftcircle.test`.
Password: `CraftDemo2026!` (or your `DEMO_PASSWORD`). Coupon: `SAMPLE10`.
Admin: the email and password you gave Render. Admin is at `/admin`, creator portal at `/creator`.

## Honest limits
- Simulated payments only: say so in your project write-up. To go real later, set `PAYMENT_MODE=razorpay`, add the three Razorpay keys, and remove `DEMO_MODE`.
- Photos in MongoDB are fine for a demo (Atlas free is 512 MB), not for a busy store.
- Product details beyond name, price, maker and photo (stock counts, materials) are placeholders: edit them in the admin area.
- Change nothing in `NODE_ENV`/`DEMO_MODE` on a site that takes real money.
