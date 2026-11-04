"""Shared Selenium helpers (Firefox headless). Playwright's browser download is blocked in the build environment,
so these scripts use Selenium + geckodriver; the same flows can be ported to Playwright where its browsers can be installed."""
import os, time
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC

BASE = os.environ.get("BASE_URL", "http://localhost:5173")
FF = os.environ.get("FIREFOX_BIN", "/home/claude/mamba/envs/ff/bin/firefox")
GD = os.environ.get("GECKODRIVER", "/home/claude/mamba/envs/ff/bin/geckodriver")

def driver(width=1280, height=900):
    o = Options(); o.binary_location = FF; o.add_argument("-headless")
    d = webdriver.Firefox(options=o, service=Service(GD, log_output=os.devnull)); d.set_window_size(width, height); d.implicitly_wait(0)
    return d
def wait(d, css, t=15): return WebDriverWait(d, t).until(EC.visibility_of_element_located((By.CSS_SELECTOR, css)))
def wait_text(d, text, t=15): return WebDriverWait(d, t).until(EC.visibility_of_element_located((By.XPATH, f"//*[contains(normalize-space(.), '{text}')]")))
def go(d, path): d.get(BASE + path)
def click_text(d, tag, text, t=15):
    el = WebDriverWait(d, t).until(EC.element_to_be_clickable((By.XPATH, f"//{tag}[contains(normalize-space(.), '{text}')]"))); d.execute_script("arguments[0].scrollIntoView({block:'center'})", el); el.click(); return el
def fill(d, label, value):
    el = d.find_element(By.XPATH, f"//label[contains(normalize-space(.), '{label}')]"); i = el.get_attribute("for")
    f = d.find_element(By.ID, i) if i else el.find_element(By.XPATH, ".//input|.//select|.//textarea")
    if f.tag_name == "select":
        from selenium.webdriver.support.ui import Select; Select(f).select_by_visible_text(value)
    else:
        from selenium.webdriver.common.keys import Keys
        f.send_keys(Keys.CONTROL, "a"); f.send_keys(Keys.DELETE); f.send_keys(value)  # works for controlled React inputs too
def js_errors(d):
    # Surface uncaught errors via window.onerror hook installed by install_error_hook
    return d.execute_script("return window.__errs || []")
def install_error_hook(d):
    d.execute_script("if(!window.__errs){window.__errs=[];window.addEventListener('error',e=>window.__errs.push(String(e.message)));window.addEventListener('unhandledrejection',e=>window.__errs.push('rejection: '+String(e.reason)));}")

def click_exact(d, tag, text, t=15):
    el = WebDriverWait(d, t).until(EC.element_to_be_clickable((By.XPATH, f"//{tag}[normalize-space()='{text}']"))); d.execute_script("arguments[0].scrollIntoView({block:'center'})", el); el.click(); return el

def wait_xpath(d, xp, t=15): return WebDriverWait(d, t).until(EC.visibility_of_element_located((By.XPATH, xp)))
def alerts(d): return [a.text for a in d.find_elements(By.CSS_SELECTOR, "[role=alert]")]

def field(d, label):
    """The input/select/textarea for a label, whether nested in it or linked by for=."""
    el = d.find_element(By.XPATH, f"//label[contains(normalize-space(.), '{label}')]"); i = el.get_attribute("for")
    return d.find_element(By.ID, i) if i else el.find_element(By.XPATH, ".//input|.//select|.//textarea")
def choose(d, label, option):
    from selenium.webdriver.support.ui import Select
    Select(field(d, label)).select_by_visible_text(option)  # fires a real change event (keystrokes to a controlled <select> do not)
