"""Creator portal journey in a real browser (Firefox headless). A seeded creator drives the UI; an admin acts through the API.
Needs: API (seeded, mock payments, bootstrapped admin, DISABLE_RATE_LIMIT=true) + client running."""
import os, sys, uuid, zlib, struct, tempfile, requests
sys.path.insert(0, os.path.dirname(__file__))
from browser import *
API = os.environ.get("API_URL", "http://localhost:4000/api/v1"); RUN = uuid.uuid4().hex[:6]
CREATOR = ("asha-menon@sample.craftcircle.test", "sample-password-123"); ADMIN = (os.environ.get("ADMIN_EMAIL", "admin@sample.craftcircle.test"), os.environ.get("ADMIN_PASSWORD", "admin-password-123"))
def png(path):
    raw = b"".join(b"\x00" + b"\xb0\x55\x3a" * 8 for _ in range(8)); ch = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + ch(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)) + ch(b"IDAT", zlib.compress(raw)) + ch(b"IEND", b"") + uuid.uuid4().bytes)
IMG = os.path.join(tempfile.mkdtemp(), "piece.png"); png(IMG)
class Api:
    def __init__(s, creds): s.s = requests.Session(); s.csrf = s.s.get(f"{API}/auth/csrf").json()["csrfToken"]; assert s.post("/auth/login", {"email": creds[0], "password": creds[1]}).status_code == 200
    def post(s, p, b=None): return s.s.post(f"{API}{p}", json=b, headers={"x-csrf-token": s.csrf})
    def get(s, p): return s.s.get(f"{API}{p}")
admin = Api(ADMIN); name = f"E2E Pendant {RUN}"; name2 = f"E2E Pendant Renamed {RUN}"; st = {}
results = []
def step(n, fn):
    try: fn(); results.append(True); print("PASS ", n)
    except Exception as e:
        results.append(False); print("FAIL ", n, repr(e)[:240])
        try: d.save_screenshot(f"/tmp/shots/creator-fail-{len(results)}.png"); print("      url:", d.current_url, "| alerts:", alerts(d), "| page:", d.find_element(By.TAG_NAME, "main").text[:240].replace("\n", " / "))
        except Exception: pass
def review(action, **kw): r = admin.post(f"/admin/products/{st['pid']}/review", {"action": action, **kw}); assert r.status_code == 200, r.text
def storefront_has(text): return any(text in p["name"] for p in requests.get(f"{API}/products?q={text.replace(' ', '%20')}").json()["items"])
d = driver(1366, 1100)
try:
    def c1():
        go(d, "/creator/dashboard"); WebDriverWait(d, 10).until(lambda x: "/login" in x.current_url)
        fill(d, "Email", CREATOR[0]); fill(d, "Password", CREATOR[1]); click_exact(d, "button", "Sign in"); WebDriverWait(d, 15).until(lambda x: "/creator/dashboard" in x.current_url)
        wait_text(d, "Your earnings"); wait_text(d, "Confirmed sales"); assert "Customer details are never shown" in d.page_source
    step("signed-out visit redirects to login; creator lands on the dashboard with defined metrics", c1)
    def c2():
        click_text(d, "a", "Products"); click_exact(d, "a", "Add a product"); wait_text(d, "Your price proposal")
        fill(d, "Product name", name); fill(d, "Description", "A hand-cut brass leaf on a cotton cord, finished by hand."); choose(d, "Category", "Jewellery")
        fill(d, "Suggested retail price", "500"); fill(d, "Amount you want to receive per unit", "600"); fill(d, "Units in stock", "6")
        click_exact(d, "button", "Save as draft"); wait_text(d, "must be higher"); assert "/new" in d.current_url  # blocked client-side
        fill(d, "Suggested retail price", "899"); d.find_element(By.XPATH, "//input[@aria-label='Add photos']").send_keys(IMG); wait(d, "img[alt='Product photo 1']")
        click_exact(d, "button", "Save as draft"); WebDriverWait(d, 15).until(lambda x: "/edit" in x.current_url); wait_text(d, "Only you can see this"); st["pid"] = d.current_url.split("/")[-2]
    step("a bad price proposal is blocked; a valid draft with a photo saves", c2)
    def c3():
        click_exact(d, "button", "Submit for review"); WebDriverWait(d, 15).until(lambda x: x.current_url.rstrip("/").endswith("/creator/products")); wait_text(d, name); wait_text(d, "Submitted")
        d.find_element(By.XPATH, f"//tr[contains(., '{name}')]//a[normalize-space()='View']").click(); wait_text(d, "with our team")
        assert not field(d, "Product name").is_enabled() and field(d, "Units in stock").is_enabled()
        assert not storefront_has(name)
    step("submitting locks the product (stock stays editable) and keeps it off the storefront", c3)
    def c4():
        review("request_changes", note="Please describe the cord length")
        go(d, "/creator/products"); wait_text(d, "Please describe the cord length"); d.find_element(By.XPATH, f"//tr[contains(., '{name}')]//a[normalize-space()='Edit']").click(); wait_text(d, "Feedback from our team")
        fill(d, "Description", "A hand-cut brass leaf on a 45 cm cotton cord, finished by hand."); click_exact(d, "button", "Save changes"); wait_text(d, "Changes saved"); click_exact(d, "button", "Submit for review")
        WebDriverWait(d, 15).until(lambda x: x.current_url.rstrip("/").endswith("/creator/products")); wait_text(d, "Submitted")
    step("admin requests changes; creator sees the feedback, edits and resubmits", c4)
    def c5():
        review("approve", sellingPricePaise=89900, creatorAmountPaise=60000, publish=True); assert storefront_has(name)
        go(d, "/creator/products"); wait_text(d, "Live"); d.find_element(By.XPATH, f"//tr[contains(., '{name}')]//a[normalize-space()='Edit']").click(); wait_text(d, "Agreed terms"); assert "₹899" in d.page_source and "₹600" in d.page_source
        fill(d, "Units in stock", "9"); click_exact(d, "button", "Save changes"); wait_text(d, "Changes saved"); assert storefront_has(name)  # stock is not a material change
    step("approved and published; creator sees agreed terms; a stock change keeps it live", c5)
    def c6():
        fill(d, "Product name", name2); click_exact(d, "button", "Save changes"); wait_text(d, "Take this product offline for re-approval?")
        click_exact(d, "button", "Keep editing"); assert storefront_has(name)  # nothing happened yet
        click_exact(d, "button", "Save changes"); wait_text(d, "Take this product offline"); click_exact(d, "button", "Save and send for re-approval"); wait_text(d, "offline until our team re-approves")
        assert not storefront_has(name) and not storefront_has(name2)
    step("a material edit to a live product needs explicit confirmation and takes it offline", c6)
    def c7():
        review("approve", publish=True); assert storefront_has(name2)
        go(d, "/creator/products"); row = f"//tr[contains(., '{name2}')]"; wait_xpath(d, row)
        d.find_element(By.XPATH, row + "//button[normalize-space()='Pause']").click(); wait_text(d, "Product paused"); assert not storefront_has(name2)
        d.find_element(By.XPATH, row + "//button[normalize-space()='Resume']").click(); wait_text(d, "Product is live again"); assert storefront_has(name2)
    step("admin re-approves; creator can pause and resume (storefront follows)", c7)
    def c8():
        go(d, "/creator/earnings"); wait_text(d, "Statement"); wait(d, "table tbody tr"); assert d.find_elements(By.XPATH, "//a[contains(., 'Download CSV')]")
        t = d.find_element(By.TAG_NAME, "main").text; assert "remaining" in t.lower() and "per unit" in t.lower()  # headers are CSS-uppercased
        go(d, "/creator/incentives"); wait_text(d, "not guaranteed earnings")
    step("earnings statement is itemised with CSV; incentives states they are not guaranteed", c8)
    def c9():
        go(d, "/creator/profile"); wait_text(d, "Payout details"); fill(d, "Account holder name", "Asha Menon"); fill(d, "IFSC", "BAD"); click_exact(d, "button", "Save payout details"); wait_text(d, "IFSC")
        fill(d, "IFSC", "HDFC0001234"); fill(d, "Account number: last 4", "4321"); click_exact(d, "button", "Save payout details"); wait_text(d, "account ending 4321")
        fill(d, "Bio", f"Brass and clay jewellery maker {RUN}."); click_exact(d, "button", "Save profile"); wait_text(d, "Profile saved")
        pub = requests.get(f"{API}/creators/asha-menon").text; assert RUN in pub and "HDFC" not in pub and "4321" not in pub  # public page shows the bio, never payout data
    step("payout details validate (IFSC) and save masked; public profile shows the bio but no payout data", c9)
    def c10():
        go(d, "/creator/notifications"); wait_text(d, "Notifications"); wait(d, "ul.card li"); txt = d.find_element(By.TAG_NAME, "main").text; assert "approved" in txt.lower() or "Changes requested" in txt
        if d.find_elements(By.XPATH, "//button[normalize-space()='Mark all as read']"): click_exact(d, "button", "Mark all as read"); wait_text(d, "0 unread")
    step("notifications list the review decisions and can be marked read", c10)
finally: d.quit()
d = driver(1280, 800)
try:
    def a1():
        e = f"cust-{RUN}@example.com"; s = requests.Session(); c = s.get(f"{API}/auth/csrf").json()["csrfToken"]; assert s.post(f"{API}/auth/register", json={"name": "Plain", "email": e, "password": "correct-horse-battery"}, headers={"x-csrf-token": c}).status_code == 201
        go(d, "/login"); fill(d, "Email", e); fill(d, "Password", "correct-horse-battery"); click_exact(d, "button", "Sign in"); WebDriverWait(d, 15).until(lambda x: "/login" not in x.current_url)
        go(d, "/creator/dashboard"); wait_text(d, "Creators only"); assert s.get(f"{API}/creator/dashboard").status_code == 403 and s.get(f"{API}/creator/products").status_code == 403
        assert not d.find_elements(By.XPATH, "//a[normalize-space()='Creator dashboard']")
    step("a customer sees 'Creators only', no creator link, and creator APIs return 403", a1)
    def a2():
        go(d, "/login"); fill(d, "Email", CREATOR[0]); fill(d, "Password", CREATOR[1]); click_exact(d, "button", "Sign in"); WebDriverWait(d, 15).until(lambda x: "/login" not in x.current_url)
        go(d, "/admin"); wait_text(d, "Staff only")
    step("a creator cannot open the admin area", a2)
finally: d.quit()
print(f"\n{sum(results)}/{len(results)} steps passed"); sys.exit(0 if all(results) else 1)
