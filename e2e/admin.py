"""Whole-marketplace journey through the ADMIN UI in a real browser (Firefox headless).
Applicant signs up -> admin approves -> creator lists a product -> admin prices + publishes -> customer buys -> admin ships/delivers
-> earnings clear -> admin drafts, approves and pays out -> overview/reports/audit reflect it. Also checks access control.
Needs the API (seeded, PAYMENT_MODE=mock, bootstrapped admin) and the client running.
  ADMIN_EMAIL / ADMIN_PASSWORD env vars select the admin; SERVER_DIR points at server/ (for the date-backdating helper)."""
import os, sys, uuid, subprocess, requests, zlib, struct
sys.path.insert(0, os.path.dirname(__file__))
from browser import *

API = os.environ.get("API_URL", "http://localhost:4000/api/v1")
ADMIN = (os.environ.get("ADMIN_EMAIL", "admin@sample.craftcircle.test"), os.environ.get("ADMIN_PASSWORD", "admin-password-123"))
SERVER_DIR = os.environ.get("SERVER_DIR", os.path.join(os.path.dirname(__file__), "..", "server"))
RUN = uuid.uuid4().hex[:6]; PW = "correct-horse-battery"

def png():
    raw = b"".join(b"\x00" + b"\x1f\x3d\x2f" * 8 for _ in range(8)); ch = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"") + str(uuid.uuid4()).encode()

class Api:
    def __init__(s): s.s = requests.Session(); s.csrf = s.s.get(f"{API}/auth/csrf").json()["csrfToken"]
    def post(s, p, body=None, **kw): return s.s.post(f"{API}{p}", json=body, headers={"x-csrf-token": s.csrf, **kw.get("headers", {})})
    def put(s, p, body=None): return s.s.put(f"{API}{p}", json=body, headers={"x-csrf-token": s.csrf})
    def get(s, p): return s.s.get(f"{API}{p}")
    def upload(s): return s.s.post(f"{API}/uploads/images", files={"file": ("w.png", png(), "image/png")}, headers={"x-csrf-token": s.csrf}).json()["url"]
    def register(s, email): r = s.post("/auth/register", {"name": f"E2E {email.split('@')[0]}", "email": email, "password": PW}); assert r.status_code == 201, r.text

results = []
def step(n, fn):
    try: fn(); results.append(True); print("PASS ", n)
    except Exception as e:
        results.append(False); print("FAIL ", n, repr(e)[:260]);
        try: d.save_screenshot(f"/tmp/shots/admin-fail-{len(results)}.png"); print("      url:", d.current_url, "| alerts:", alerts(d), "| page:", d.find_element(By.TAG_NAME, "main").text[:200].replace("\n", " / "))
        except Exception: pass

app_email = f"applicant-{RUN}@example.com"; prod = f"E2E Planter {RUN}"; st = {}
creator = Api(); creator.register(app_email); img = creator.upload()
r = creator.post("/creator/application", {"fullName": f"Priya {RUN}", "email": app_email, "phone": "9876543210", "city": "Pune", "state": "Maharashtra", "categories": ["Home décor"], "bio": "I make hand-painted terracotta planters and small ceramics in Pune.", "sampleImages": [img], "confirmsHandmade": True, "acceptedTerms": True, "submit": True}); assert r.status_code == 201, r.text

d = driver(1366, 1000)
try:
    def a1():
        go(d, "/admin"); WebDriverWait(d, 10).until(lambda x: "/login" in x.current_url)
        fill(d, "Email", ADMIN[0]); fill(d, "Password", ADMIN[1]); click_exact(d, "button", "Sign in"); WebDriverWait(d, 15).until(lambda x: x.current_url.rstrip("/").endswith("/admin"))
        wait_text(d, "Pending applications"); wait_text(d, "Simulated (demo)")
    step("signed-out /admin redirects to login; admin signs in to the overview", a1)

    def a2():
        click_text(d, "a", "Applications"); row = f"//tr[contains(., '{app_email}')]"; wait(d, "table"); d.find_element(By.XPATH, row + "//button[contains(., 'Review')]").click()
        wait_text(d, "terracotta planters"); click_exact(d, "button", "Approve"); wait_text(d, "Application approved")
        assert requests.get(f"{API}/products").status_code == 200
        assert creator.get("/creator/dashboard").status_code == 200  # approval really granted creator access
    step("admin approves the application; the applicant gains creator access", a2)

    def a3():
        cat = creator.get("/categories").json()["items"][0]["id"]
        r = creator.post("/creator/products", {"name": prod, "description": "A hand-painted terracotta planter with a drainage hole.", "category": cat, "suggestedPricePaise": 89900, "proposedCreatorAmountPaise": 60000, "stock": 6, "images": [creator.upload()], "materials": ["terracotta"]}); assert r.status_code == 201, r.text
        st["pid"] = r.json()["product"]["id"]; assert creator.post(f"/creator/products/{st['pid']}/submit").status_code == 200
        click_text(d, "a", "Products"); wait_text(d, prod)
    step("creator's submitted product appears in the admin 'Needs review' queue", a3)

    def a4():
        d.find_element(By.XPATH, f"//tr[contains(., '{prod}')]//a[contains(., 'Review')]").click(); wait_text(d, "Set terms and decide")
        fill(d, "Final selling price", "400"); fill(d, "Agreed creator amount per unit", "600"); wait_text(d, "must be higher")
        assert not d.find_element(By.XPATH, "//button[normalize-space()='Approve and publish']").is_enabled()  # invalid margin blocks the button
        fill(d, "Final selling price", "899"); wait_text(d, "Platform margin"); assert "₹299" in d.page_source
        click_exact(d, "button", "Approve and publish"); wait_text(d, "Approved and published"); wait_text(d, "Pricing history")
    step("admin sets terms: invalid margin is blocked, valid margin previewed, product approved and published", a4)

    def a5():
        go(d, "/shop"); wait_text(d, prod); assert "₹899" in d.find_element(By.XPATH, f"//article[contains(., '{prod}')]").text
    step("storefront shows the product at the admin-approved price", a5)

    buyer = Api(); buyer.register(f"buyer-{RUN}@example.com")
    def a6():
        buyer.s.put(f"{API}/cart/items", json={"productId": st["pid"], "quantity": 2}, headers={"x-csrf-token": buyer.csrf})
        r = buyer.post("/checkout", {"customer": {"name": "Meera Rao", "email": f"buyer-{RUN}@example.com", "phone": "9876543210"}, "address": {"fullName": "Meera Rao", "phone": "9876543210", "line1": "12 Lake View Road", "city": "Hyderabad", "state": "Telangana", "postalCode": "500081", "country": "India"}}, headers={"Idempotency-Key": f"e2e-{RUN}-checkout"}); assert r.status_code == 201, r.text
        st["oid"], st["onum"] = r.json()["order"]["id"], r.json()["order"]["orderNumber"]
        assert buyer.post("/payments/mock/confirm", {"orderId": st["oid"], "outcome": "success"}).status_code == 200
        click_exact(d, "a", "Orders") if False else go(d, "/admin/orders"); wait_text(d, st["onum"]); wait_text(d, "Simulated")
    step("customer buys 2 units (simulated payment); order shows in admin flagged Simulated", a6)

    def a7():
        d.find_element(By.XPATH, f"//tr[contains(., '{st['onum']}')]//a[contains(., 'Open')]").click(); wait_text(d, "Update fulfilment")
        assert "₹600" in d.page_source and "₹299" in d.page_source  # creator amount and margin per unit are visible to admin
        for target in ["Processing", "Shipped", "Delivered"]:
            if target == "Shipped":
                choose(d, "Move to", "Shipped"); wait_text(d, "Tracking number")
                assert not d.find_element(By.XPATH, "//button[normalize-space()='Update status']").is_enabled()  # blocked until courier + tracking are entered
                fill(d, "Courier / provider", "DTDC"); fill(d, "Tracking number", f"D{RUN}")
            else: choose(d, "Move to", target)
            click_exact(d, "button", "Update status"); wait_xpath(d, f"//main//span[contains(@class,'rounded-sm') and normalize-space()='{target}']")  # the status badge, not dropdown option text
        wait_text(d, f"D{RUN}")
    step("admin moves the order through processing -> shipped (tracking required) -> delivered", a7)

    def a8():
        d.find_element(By.XPATH, "//select").is_displayed()
        opts = [o.text for o in d.find_element(By.XPATH, "//label[contains(., 'Move to')]//select").find_elements(By.TAG_NAME, "option")] if d.find_elements(By.XPATH, "//label[contains(., 'Move to')]//select") else []
        assert "Paid" not in opts and "Refunded" not in opts  # payment states are never manually settable
    step("payment-derived states cannot be set by hand", a8)

    def a9():
        subprocess.run(["npx", "tsx", "scripts/ageOrder.ts", st["onum"]], cwd=SERVER_DIR, check=True, capture_output=True, env={**os.environ, "NODE_ENV": "development"})
        go(d, "/admin/payouts"); row = f"//tr[contains(., 'Priya {RUN}')]"; wait_xpath(d, row)
        assert "₹1,200" in d.find_element(By.XPATH, row).text
        d.find_element(By.XPATH, row + "//button[contains(., 'Create payout draft')]").click(); wait_text(d, "Payout drafted")
        brow = f"//tr[contains(., 'Priya {RUN}') and contains(., 'PO-')]"; wait_xpath(d, brow)
        d.find_element(By.XPATH, brow + "//button[contains(., 'Approve')]").click(); wait_text(d, "Payout approved")
        d.find_element(By.XPATH, brow + "//button[contains(., 'Mark paid')]").click(); ref = field(d, "Bank transfer reference"); ref.send_keys("ab")
        assert not d.find_element(By.XPATH, "//button[normalize-space()='Save']").is_enabled()  # reference is mandatory
        ref.send_keys("c-UTR-" + RUN); click_exact(d, "button", "Save"); wait_text(d, "Recorded as paid"); wait_text(d, f"abc-UTR-{RUN}")
        assert d.find_elements(By.XPATH, brow + "//a[contains(., 'Statement')]")
    step("earnings clear the return window; admin drafts, approves and pays out with a mandatory bank reference", a9)

    def a10():
        go(d, "/admin"); wait_text(d, "Gross merchandise value"); wait_text(d, "Settled creator earnings")
        text = d.find_element(By.TAG_NAME, "main").text; assert "Simulated" in text and "NOT profit" in d.page_source
        so = requests.Session(); c = so.get(f"{API}/auth/csrf").json()["csrfToken"]; so.post(f"{API}/auth/login", json={"email": ADMIN[0], "password": ADMIN[1]}, headers={"x-csrf-token": c})
        ov = so.get(f"{API}/admin/overview").json()["simulated"]; assert ov["creatorSettledPaise"] >= 120000, ov
    step("overview shows settled earnings under Simulated and states margin is not profit", a10)

    def a11():
        go(d, "/admin/reports?type=product-sales"); wait_text(d, prod); wait(d, "a[href*='format=csv']")
        assert "buyer-" not in d.page_source and "Lake View" not in d.page_source and "Meera" not in d.page_source
        go(d, "/admin/reports?type=orders"); wait_text(d, st["onum"]); assert "Hyderabad" in d.page_source and "@" not in d.find_element(By.TAG_NAME, "table").text
    step("reports preview real rows and exclude customer personal data", a11)

    def a12():
        go(d, "/admin/promotions"); wait_text(d, "New promo code"); fill(d, "Code", f"E2E{RUN}"); fill(d, "Percent (1 to 100)", "150")
        d.execute_script("document.querySelectorAll('input[type=datetime-local]').forEach((e,i)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,i?'2030-01-01T00:00':'2026-01-01T00:00');e.dispatchEvent(new Event('input',{bubbles:true}));})")
        click_exact(d, "button", "Create code"); wait_text(d, "cannot exceed 100")  # server validation shown inline
        fill(d, "Percent (1 to 100)", "10"); click_exact(d, "button", "Create code"); wait_text(d, "Promo code created"); wait_text(d, f"E2E{RUN}".upper())  # codes are stored upper-case
    step("promo code: invalid percentage rejected inline, valid code created", a12)

    def a13():
        go(d, "/admin/settings"); wait_text(d, "Announcement bar"); box = d.find_element(By.XPATH, "//label[contains(., 'Show the announcement bar')]//input")
        if not box.is_selected(): box.click()
        fill(d, "Message", f"E2E notice {RUN}"); click_exact(d, "button", "Save settings"); wait_text(d, "Settings saved")
        go(d, "/"); wait_text(d, f"E2E notice {RUN}")
    step("settings change reaches the storefront announcement bar", a13)

    def a14():
        go(d, "/admin/audit?action=payout."); wait(d, "table tbody tr"); t = d.find_element(By.TAG_NAME, "table").text; assert "payout.marked_paid" in t and "payout.drafted" in t
        go(d, "/admin/audit"); wait(d, "table"); assert d.find_elements(By.XPATH, "//*[contains(., 'creator_application.approved')]")
    step("audit log records the approvals and payout actions, read-only", a14)
finally: d.quit()

d = driver(1280, 800)
try:
    def b1():
        c = Api(); em = f"plain-{RUN}@example.com"; c.register(em)
        go(d, "/login"); fill(d, "Email", em); fill(d, "Password", PW); click_exact(d, "button", "Sign in"); WebDriverWait(d, 15).until(lambda x: "/login" not in x.current_url)
        go(d, "/admin"); wait_text(d, "Staff only"); assert "Gross merchandise" not in d.page_source
        assert c.get("/admin/overview").status_code == 403 and c.get("/admin/reports/orders?format=csv").status_code == 403
        assert not d.find_elements(By.XPATH, "//a[normalize-space()='Admin']")
    step("a customer sees 'Staff only', no Admin link, and the admin APIs return 403", b1)
finally: d.quit()
print(f"\n{sum(results)}/{len(results)} steps passed"); sys.exit(0 if all(results) else 1)
