"""Real-browser acceptance check (Playwright/Chromium). usage: browser_check.py <real_out_dir> <shots_dir>"""
import sys,json,pathlib,datetime,re
from playwright.sync_api import sync_playwright
out=pathlib.Path(sys.argv[1]).resolve();shots=pathlib.Path(sys.argv[2]).resolve();shots.mkdir(exist_ok=True,parents=True)
html=(out/"index.html").read_text(encoding="utf-8")
res=[]
def ck(name,cond,extra=""):res.append((name,bool(cond),extra));print(("PASS" if cond else "FAIL"),name,extra)
def variant(sub):  # make a modified page
    p=out/"_tmp_variant.html";p.write_text(sub,encoding="utf-8");return p
with sync_playwright() as p:
    b=p.chromium.launch()
    def open_page(path,clock,w=1280,h=900):
        pg=b.new_page(viewport={"width":w,"height":h});errs=[]
        pg.on("pageerror",lambda e:errs.append(str(e)));pg.on("console",lambda m:errs.append(m.text) if m.type=="error" else None)
        pg.clock.install(time=datetime.datetime.fromisoformat(clock));pg.goto("file://"+str(path));return pg,errs
    # 1 fresh desktop
    pg,errs=open_page(out/"index.html","2026-11-02T08:00:00+00:00")
    ck("fresh: banner says data fresh","البيانات حديثة" in pg.inner_text("#fresh"))
    ck("fresh: no JS errors",not errs,str(errs))
    ck("fresh: H1 labelled experimental/unapproved","غير معتمد" in pg.inner_text("#mkwhy"))
    ck("fresh: exposure = no recommendation","لا توصية" in pg.inner_text("#expo"))
    ck("fresh: levels disabled text present","غير معتمد" in pg.inner_text("#body") and "الدخول / الوقف / الأهداف" in pg.inner_text("#body"))
    ck("fresh: no entry/stop numbers rendered as orders","هدف أول" not in pg.inner_text("body"))
    n=pg.locator("button.sym").count();ck("fresh: list has symbols",n>0,str(n))
    pg.locator("button.sym").nth(2).click();ck("detail switches",pg.locator("button.sym.active").count()==1)
    pg.fill("input","DCCC");ck("blocked filter works","DCCC" in pg.inner_text("#body") and "STALE" in pg.inner_text("#body"))
    pg.screenshot(path=str(shots/"desktop_fresh.png"),full_page=True)
    pg.set_viewport_size({"width":390,"height":800});pg.screenshot(path=str(shots/"mobile_fresh.png"),full_page=True)
    ck("mobile: no horizontal scroll",pg.evaluate("document.documentElement.scrollWidth<=window.innerWidth+1"))
    # 2 stale
    pg,errs=open_page(out/"index.html","2026-11-20T08:00:00+00:00")
    t=pg.inner_text("#fresh");ck("stale: red banner","بيانات قديمة" in t)
    ck("stale: market hidden","غير متاح" in pg.inner_text("#mk") and "لا توصية" in pg.inner_text("#expo"))
    ck("stale: no symbol buttons",pg.locator("button.sym").count()==0)
    pg.screenshot(path=str(shots/"desktop_stale.png"),full_page=True)
    # 3 corrupt payload
    bad=re.sub(r'(<script id="payload" type="application/json">).*?(</script>)',r'\1{broken\2',html,flags=re.S)
    pg,errs=open_page(variant(bad),"2026-11-02T08:00:00+00:00");ck("corrupt: fail-closed message","تعذر تحميل" in pg.inner_text("#fresh") and pg.locator("button.sym").count()==0)
    pg.screenshot(path=str(shots/"desktop_error.png"))
    # 4 zero opportunities
    d=json.loads(re.search(r'<script id="payload" type="application/json">(.*?)</script>',html,re.S).group(1).replace("<\\/","</"))
    d["ranked"]=[];d["watchlist"]=[];d["counts"]["ranked"]=0;d["counts"]["watchlist"]=0
    z=re.sub(r'(<script id="payload" type="application/json">).*?(</script>)',lambda m:m.group(1)+json.dumps(d,ensure_ascii=False).replace("</","<\\/")+m.group(2),html,flags=re.S)
    pg,errs=open_page(variant(z),"2026-11-02T08:00:00+00:00");ck("empty: 'لا فرص اليوم' shown","لا فرص اليوم" in pg.inner_text("#body") and not errs,str(errs))
    pg.screenshot(path=str(shots/"desktop_empty.png"),full_page=True)
    b.close()
(out/"_tmp_variant.html").unlink(missing_ok=True)
json.dump([dict(check=a,passed=p,detail=c) for a,p,c in res],open(shots/"browser_results.json","w"),ensure_ascii=False,indent=1)
print("TOTAL",sum(p for _,p,_ in res),"/",len(res));sys.exit(0 if all(p for _,p,_ in res) else 1)
