"""Browser regression for live-root homepage; fixture requests, no financial claims."""
from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[2]
MAIN={"sessionDate":"2026-11-02","executionAllowed":False,"executionReady":False,
      "status":"V16_10_CASH_MODE","researchWatchlist":[{
        "ticker":"ARVA","companyNameAr":"العربية للمحابس","entryLow":14.95,
        "entryHigh":15.03,"stopLoss":14.50,"target1":15.64
      }]}
QUANT={"sessionId":"2026-11-02","liveExecutionEnabled":False,"status":"WATCH_ONLY",
       "watchCandidates":[{"ticker":"AJWA","companyNameAr":"أجواء للصناعات الغذائية",
        "signalDate":"2026-11-02","statusLabelAr":"مراقبة مشروطة",
        "price":214.92,"plan":{"entryLow":213.63,"entryHigh":216.57,"stopLoss":203.27,"target1":236.39},
        "dataQuality":{"latestHistorySession":"2026-11-02"}}]}
HEALTH={"coveragePct":96,"delayed":True}
def launch(page,responses):
    def handle(route):
        path=route.request.url.split("?")[0]
        for k,value in responses.items():
            if path.endswith(k):
                if value is None:route.fulfill(status=503,body="source unavailable")
                else:route.fulfill(status=200,content_type="application/json",body=json.dumps(value,ensure_ascii=False))
                return
        route.continue_()
    page.route("**/raw.githubusercontent.com/**",handle)
    page.goto((ROOT/"index.html").as_uri())
    page.wait_for_selector("#reload:not([disabled])",timeout=15000)

def run():
    routes={
        "data/stable/v16-main-app-current.json":MAIN,
        "data/quant/daily-recommendations.json":QUANT,
        "data/source-health.json":HEALTH,
    }
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page()
        try:
            launch(page,routes)
            assert page.locator("#main-session").inner_text()=="2026-11-02"
            assert page.locator("#quant-session").inner_text()=="2026-11-02"
            assert "214.92" in page.locator("#quant-rows").inner_text()
            assert "ARVA" in page.locator("#main-rows").inner_text()
            assert "DELAYED" in page.locator("#quality").inner_text()
            assert "paper-v4/index.html" in page.locator('a[href="./paper-v4/index.html"]').get_attribute("href")
            assert "RESEARCH ONLY" in page.locator("body").inner_text()
            assert "NO_STRATEGY_APPROVED" in page.locator("body").inner_text()
            print("PASS: correct 2-Nov source dates, watch candidates, disabled execution, separate archive")
        finally:browser.close()
        browser=p.chromium.launch(headless=True)
        page=browser.new_page()
        try:
            launch(page,{**routes,"data/quant/daily-recommendations.json":None})
            assert "فشل جلب أحدث ملفات البيانات" in page.locator("#headline").inner_text()
            assert "لا نعرض بيانات قديمة بديلة" in page.locator("#quant-rows").inner_text()
            assert page.locator("#main-session").inner_text()=="غير متاح"
            print("PASS: failed source refuses stale fallback")
        finally:browser.close()

if __name__=="__main__":
    run()
