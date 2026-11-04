"""WCAG 2.1 A/AA scan with axe-core on the main public pages. Needs `npm i axe-core` somewhere; set AXE_PATH to its axe.min.js."""
import os, sys, time, json
sys.path.insert(0, os.path.dirname(__file__))
from browser import *
axe = open(os.environ.get("AXE_PATH", "node_modules/axe-core/axe.min.js")).read()
pages = ["/", "/shop", "/categories/jewellery", "/cart", "/login", "/register", "/faq", "/become-a-creator", "/search?q=bracelet"]
d = driver(1280, 900); total = 0
try:
    go(d, "/shop"); wait(d, "article a"); pages.insert(3, d.find_element(By.CSS_SELECTOR, "article a").get_attribute("href").replace(BASE, ""))
    for p in pages:
        go(d, p); wait(d, "main h1, main h2"); time.sleep(1.5)
        d.execute_script(axe)
        res = d.execute_async_script("const cb=arguments[arguments.length-1]; axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}}).then(r=>cb(r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.slice(0,3).map(n=>n.target.join(' ')+' :: '+(n.any[0]?.message||n.all[0]?.message||''))}))))")
        total += len(res); print(f"{p:40} violations={len(res)}")
        for v in res: print(f"   [{v['impact']}] {v['id']}: {v['help']}"); [print("        ", n[:170]) for n in v['nodes']]
finally: d.quit()
print("TOTAL", total)
