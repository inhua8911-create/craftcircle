import os, sys, time
sys.path.insert(0, os.path.dirname(__file__))
from browser import *
"""axe-core WCAG 2.1 A/AA scan of the admin pages. Env: AXE_PATH (axe.min.js), ADMIN_EMAIL, ADMIN_PASSWORD."""
axe = open(os.environ.get("AXE_PATH", "node_modules/axe-core/axe.min.js")).read()
d = driver(1366, 1000); total = 0
try:
    go(d, "/login"); fill(d, "Email", os.environ.get("ADMIN_EMAIL", "admin@sample.craftcircle.test")); fill(d, "Password", os.environ.get("ADMIN_PASSWORD", "admin-password-123")); click_exact(d, "button", "Sign in"); WebDriverWait(d, 15).until(lambda x: "/login" not in x.current_url)
    go(d, "/admin/products?tab=all"); wait(d, "table tbody tr"); pid = d.find_element(By.CSS_SELECTOR, "table tbody tr a").get_attribute("href").replace(BASE, "")
    go(d, "/admin/orders"); wait(d, "table tbody tr"); oid = d.find_element(By.CSS_SELECTOR, "table tbody tr a").get_attribute("href").replace(BASE, "")
    go(d, "/admin/creators"); wait(d, "table tbody tr"); cid = d.find_element(By.CSS_SELECTOR, "table tbody tr a").get_attribute("href").replace(BASE, "")
    for p in ["/admin", "/admin/applications?status=approved", "/admin/creators", cid, "/admin/products?tab=all", pid, "/admin/orders", oid, "/admin/payouts", "/admin/promotions", "/admin/reports", "/admin/users", "/admin/settings", "/admin/audit"]:
        go(d, p); wait(d, "main h1"); time.sleep(1.8)
        d.execute_script(axe)
        res = d.execute_async_script("const cb=arguments[arguments.length-1]; axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>cb(r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,n:v.nodes.length,nodes:v.nodes.slice(0,2).map(n=>n.target.join(' ')+' :: '+(n.any[0]?.message||n.all[0]?.message||''))}))))")
        total += len(res); print(f"{p[:44]:46} violations={len(res)}")
        for v in res: print(f"   [{v['impact']}] {v['id']} x{v['n']}: {v['help']}"); [print("        ", n[:180]) for n in v['nodes']]
finally: d.quit()
print("TOTAL", total)
