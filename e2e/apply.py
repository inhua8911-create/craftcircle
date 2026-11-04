"""Creator application journey in a real browser, including a real file upload. Usage: python3 e2e/apply.py"""
import sys, uuid, zlib, struct, tempfile, os
sys.path.insert(0, __file__.rsplit("/", 1)[0])
from browser import *

def make_png(path):
    raw = b"".join(b"\x00" + b"\xb0\x55\x3a" * 8 for _ in range(8))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    open(path, "wb").write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))
png = os.path.join(tempfile.mkdtemp(), "work.png"); make_png(png)
fake = os.path.join(os.path.dirname(png), "evil.png"); open(fake, "w").write("<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>")
results = []
def step(n, fn):
    try: fn(); results.append(True); print("PASS ", n)
    except Exception as e: results.append(False); print("FAIL ", n, repr(e)[:250]); d.save_screenshot("/tmp/shots/apply-fail.png"); print("      page:", d.find_element(By.TAG_NAME, "main").text[:300].replace("\n", " / "))
d = driver(1280, 1100)
try:
    def a():
        go(d, "/creator/apply"); WebDriverWait(d, 10).until(lambda x: "/login" in x.current_url); click_text(d, "a", "Create an account")
        fill(d, "Full name", "Meera Potter"); fill(d, "Email", f"apply-{uuid.uuid4().hex[:8]}@example.com"); fill(d, "Password", "correct-horse-battery"); click_text(d, "button", "Create account")
        WebDriverWait(d, 15).until(lambda x: "/creator/apply" in x.current_url or "/account" in x.current_url)
        go(d, "/creator/apply"); wait_text(d, "Apply to become a creator"); wait(d, "#photos")
    step("signed-out visit redirects to login; sign up; reach the form", a)
    def b():
        # Both files are chosen together (the input is `multiple`): the bad one is rejected by name, the good one still uploads.
        d.find_element(By.ID, "photos").send_keys(fake + "\n" + png)
        wait_text(d, "evil.png: Only JPEG, PNG or WebP"); wait(d, "img[alt='Your uploaded work']")
        assert len(d.find_elements(By.CSS_SELECTOR, "img[alt='Your uploaded work']")) == 1
    step("a disguised SVG is rejected by name while the real PNG still uploads", b)
    def c():
        fill(d, "Phone", "9876543210"); fill(d, "City", "Pune"); fill(d, "State", "Maharashtra")
        fill(d, "About you", "I make hand-painted terracotta planters and small ceramics in Pune."); d.find_element(By.XPATH, "//label[contains(., 'Jewellery')]//input").click()
        d.find_element(By.XPATH, "//label[contains(., 'I confirm that the products')]//input").click(); d.find_element(By.XPATH, "//label[contains(., 'I accept the creator terms')]//input").click()
        click_text(d, "button", "Save draft"); wait_text(d, "Draft saved")
    step("complete the form and save a draft", c)
    def e():
        click_text(d, "button", "Submit application"); wait_text(d, "Application submitted")
        go(d, "/creator/apply"); wait_text(d, "Application submitted")
    step("submit -> 'submitted' status persists after reload", e)
    def f():
        go(d, "/account"); wait_text(d, "Your details"); assert "creator dashboard" not in d.page_source.lower()
    step("applicant is still a customer (no creator access before approval)", f)
finally: d.quit()
print(f"\n{sum(results)}/{len(results)} steps passed"); sys.exit(0 if all(results) else 1)
