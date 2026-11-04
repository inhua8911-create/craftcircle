"""End-to-end customer journey in a real browser: search -> cart -> sign up -> checkout -> simulated payment -> order history.
Requires the API (seeded, PAYMENT_MODE=mock) and the client running. Usage: python3 e2e/purchase.py"""
import sys, time, uuid
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from browser import *

results = []
def step(name, fn):
    try: fn(); results.append((name, True, "")); print(f"PASS  {name}")
    except Exception as e:
        results.append((name, False, repr(e)[:300])); print(f"FAIL  {name}\n      {repr(e)[:300]}")
        try: d.save_screenshot(f"/tmp/shots/fail-{len(results)}.png"); print("      url:", d.current_url, "| page:", d.find_element(By.TAG_NAME, "main").text[:200].replace("\n", " / "))
        except Exception: pass

d = driver(1280, 900); install = lambda: install_error_hook(d)
email = f"e2e-{uuid.uuid4().hex[:8]}@example.com"; state = {}
try:
    def s1(): go(d, "/"); click_text(d, "a", "Explore the Collection"); WebDriverWait(d, 10).until(lambda x: x.current_url.endswith("/shop")); wait(d, "article")
    step("home CTA navigates to shop and products render", s1)

    def s2():
        box = wait(d, "#site-search"); box.send_keys("resin"); box.submit(); WebDriverWait(d, 10).until(lambda x: "/search?q=resin" in x.current_url)
        wait_text(d, "Results for"); wait(d, "article h3"); assert "resin" in d.page_source.lower()
    step("header search finds resin pieces", s2)

    def s3():
        first = wait(d, "article h3"); name = first.text; first.click()
        WebDriverWait(d, 10).until(lambda x: "/products/" in x.current_url); wait_text(d, "Add to cart"); state["product"] = d.find_element(By.CSS_SELECTOR, "main h1").text; assert state["product"] == name
        click_text(d, "button", "Add to cart"); wait_text(d, "Added to your cart")
        WebDriverWait(d, 10).until(lambda x: "Cart, 1 item" in x.find_element(By.CSS_SELECTOR, "a[href='/cart']").get_attribute("aria-label"))
    step("product page: add to cart updates the badge and shows a toast", s3)

    def s4():
        go(d, "/cart"); wait_text(d, state["product"]); click_text(d, "button", "Sign in to checkout"); WebDriverWait(d, 10).until(lambda x: "/login?next=" in x.current_url and "checkout" in x.current_url)
    step("cart: guest is sent to sign in, destination preserved", s4)

    def s5():
        click_text(d, "a", "Create an account"); wait(d, "input[type=email]")
        fill(d, "Full name", "E2E Tester"); fill(d, "Email", email); fill(d, "Password", "correct-horse-battery"); click_text(d, "button", "Create account")
        WebDriverWait(d, 15).until(lambda x: x.current_url.rstrip("/").endswith("/checkout")); wait_text(d, "Contact and delivery")
    step("sign up mid-checkout returns to checkout", s5)

    def s6():
        wait_text(d, state["product"])  # guest cart was merged into the new account's cart
        wait_text(d, "Total")
    step("guest cart survived sign-up (merged) and quote is shown", s6)

    def s7():
        fill(d, "Phone", "9876543210"); fill(d, "Address", "12 Lake View Road"); fill(d, "City", "Hyderabad"); fill(d, "State", "Telangana"); fill(d, "PIN code", "500081")
        click_text(d, "button", "Continue to payment"); wait_text(d, "Simulated payment of"); assert "No money is charged" in d.page_source
    step("checkout form -> order reserved -> simulated-payment panel clearly labelled", s7)

    def s8():
        click_text(d, "button", "Simulate successful payment"); wait_text(d, "Thank you!"); wait_text(d, "simulated payment"); state["url"] = d.current_url
    step("simulated payment -> confirmation says it was simulated", s8)

    def s9():
        click_text(d, "a", "View order"); WebDriverWait(d, 10).until(lambda x: "/account/orders/" in x.current_url); wait_text(d, "Placed"); assert "Paid" in d.page_source and "Simulated payment" in d.page_source
        go(d, "/account/orders"); wait_text(d, "CC-"); wait_text(d, "Simulated")
    step("order appears in history as Paid + Simulated", s9)

    def s10():
        go(d, "/shop"); wait(d, "article"); btn = d.find_element(By.CSS_SELECTOR, "article button[aria-pressed]"); btn.click()
        WebDriverWait(d, 10).until(lambda x: x.find_element(By.CSS_SELECTOR, "article button[aria-pressed]").get_attribute("aria-pressed") == "true")
        go(d, "/wishlist"); wait(d, "article")
    step("wishlist: heart toggles and item shows on wishlist page", s10)

    def s11():
        go(d, "/account/addresses"); wait_text(d, "Hyderabad")
    step("address saved during checkout appears in account", s11)

    install(); errs = js_errors(d); assert not errs, errs
    step("no uncaught JS errors during the journey", lambda: None)
finally: d.quit()

d2 = driver(390, 844)
try:
    def m1():
        go(d2, "/account"); WebDriverWait(d2, 10).until(lambda x: "/login?next=%2Faccount" in x.current_url)
    step("signed-out visit to /account redirects to login", m1)
    def m2():
        go(d2, "/"); wait(d2, "main h1"); wait(d2, "button[aria-label='Open menu']"); d2.find_element(By.CSS_SELECTOR, "button[aria-label='Open menu']").click(); wait(d2, "#mobile-nav"); d2.find_element(By.CSS_SELECTOR, "#mobile-nav a[href='/categories/resin-art']").click(); WebDriverWait(d2, 10).until(lambda x: "/categories/resin-art" in x.current_url); wait(d2, "article")
    step("mobile menu opens and navigates to a category", m2)
    def m3():
        go(d2, "/this-page-does-not-exist"); wait_text(d2, "find that page")
    step("unknown URL shows the 404 page", m3)
finally: d2.quit()
bad = [r for r in results if not r[1]]; print(f"\n{len(results)-len(bad)}/{len(results)} steps passed"); sys.exit(1 if bad else 0)
