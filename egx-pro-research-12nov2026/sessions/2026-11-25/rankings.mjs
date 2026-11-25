// Research-only watchlist from EGX Daily Report 25/11/2026, Annex 5. NOT a certified engine signal.
export const session="2026-11-25";
export const source="DiscDoc_ID1022_25-Nov-2026_ENG (2).pdf";
export const stocks=[
  {
    "symbol": "MTIE",
    "name": "MM Group For Industry And International Trade",
    "open": 6.6,
    "high": 7.1,
    "low": 6.56,
    "close": 6.75,
    "change": 2.27,
    "value": 175560143,
    "entry": 7.11,
    "stop": 6.55
  },
  {
    "symbol": "TMGH",
    "name": "T M G Holding",
    "open": 78.06,
    "high": 79.55,
    "low": 76.6,
    "close": 78.95,
    "change": 1.14,
    "value": 360799697,
    "entry": 79.56,
    "stop": 76.59
  },
  {
    "symbol": "HRHO",
    "name": "EFG Holding",
    "open": 26.2,
    "high": 26.9,
    "low": 26.05,
    "close": 26.33,
    "change": 0.5,
    "value": 261192639,
    "entry": 26.91,
    "stop": 26.04
  },
  {
    "symbol": "ICFC",
    "name": "International Company For Fertilizers & Chemicals",
    "open": 26.54,
    "high": 27.24,
    "low": 25.8,
    "close": 26.8,
    "change": 0.98,
    "value": 16634195,
    "entry": 27.25,
    "stop": 25.79
  },
  {
    "symbol": "BTFH",
    "name": "Beltone Holding",
    "open": 2.16,
    "high": 2.22,
    "low": 2.14,
    "close": 2.17,
    "change": 0.46,
    "value": 81302973,
    "entry": 2.23,
    "stop": 2.13
  },
  {
    "symbol": "MOED",
    "name": "Misr Oils & Soap",
    "open": 285,
    "high": 309.1,
    "low": 275.3,
    "close": 292.4,
    "change": 2.6,
    "value": 36811689,
    "entry": 309.11,
    "stop": 275.29
  },
  {
    "symbol": "ZEOT",
    "name": "Extracted Oils",
    "open": 12.59,
    "high": 13.98,
    "low": 12.5,
    "close": 13.31,
    "change": 5.72,
    "value": 83169790,
    "entry": 13.99,
    "stop": 12.49
  },
  {
    "symbol": "MCRO",
    "name": "Macro Group Pharmaceuticals",
    "open": 1.28,
    "high": 1.35,
    "low": 1.26,
    "close": 1.3,
    "change": 1.56,
    "value": 51485246,
    "entry": 1.36,
    "stop": 1.25
  }
];
const variants={"30/40/30":["MTIE","TMGH","HRHO","ICFC","BTFH"],"50/30/20":["MTIE","TMGH","ICFC","HRHO","BTFH"],"20/40/40":["TMGH","HRHO","MTIE","ICFC","BTFH"]};
class EgxSessionRankings extends HTMLElement {
connectedCallback(){if(this.shadowRoot)return;const root=this.attachShadow({mode:"open"});root.innerHTML=`<style>:host{display:block;color:#eff6ff;font:15px/1.9 Tahoma,Arial;direction:rtl}section{background:#102b42;padding:15px;border:1px solid #395578;border-radius:12px}.notice{color:#ffde9f;background:#342a1d;padding:12px;margin:10px 0}table{border-collapse:collapse;width:100%;min-width:900px}th,td{padding:10px;border-bottom:1px solid #385371;text-align:right}th{color:#b8e2fb}select{padding:8px}small{color:#bbccda}.scroll{overflow-x:auto}</style><section><h3>قائمة مراقبة بحثية لجلسة الخميس 26 نوفمبر — ليست إشارات معتمدة</h3><p class="notice">قائمة محدودة من 8 أسهم تم فحص بياناتها يدويًا من تقرير 25 نوفمبر، وليست نتيجة مسح السوق الكامل أو تشغيل الاستراتيجية التاريخية. الأسعار مشروطة بالاختراق في الجلسة التالية، وليست أوامر شراء. لا احتساب لعمولات أو انزلاق سعري.</p><label>ترتيب المراقبة: <select id="weights"><option>30/40/30</option><option>50/30/20</option><option>20/40/40</option></select></label><div class="scroll"><table><thead><tr><th>#</th><th>الرمز</th><th>الشركة</th><th>إغلاق 25/11</th><th>تغير الجلسة</th><th>دخول شرطي فوق القمة</th><th>هدف 1 (1R)</th><th>هدف 2 (2R)</th><th>وقف افتراضي</th><th>مخاطرة سعرية</th></tr></thead><tbody id="rows"></tbody></table></div><small>حساب تجريبي: الدخول = أعلى سعر + 0.01؛ الوقف = أدنى سعر − 0.01؛ الأهداف = 1R و2R. يلزم التحقق من Tick Size قبل التنفيذ؛ المخاطرة نسبة من سعر الدخول ولا تشمل فجوات الافتتاح.</small></section>`;const bySymbol=Object.fromEntries(stocks.map(s=>[s.symbol,s]));const draw=()=>{const body=root.getElementById("rows");body.replaceChildren();for(const [i,sym] of variants[root.getElementById("weights").value].entries()){const s=bySymbol[sym],r=s.entry-s.stop,p=100*r/s.entry;const vals=[i+1,s.symbol,s.name,s.close.toFixed(2),s.change.toFixed(2)+"%",s.entry.toFixed(2),(s.entry+r).toFixed(2),(s.entry+2*r).toFixed(2),s.stop.toFixed(2),p.toFixed(2)+"%"];const tr=document.createElement("tr");for(const v of vals){const td=document.createElement("td");td.textContent=v;tr.append(td)}body.append(tr)}};root.getElementById("weights").onchange=draw;draw()}}
customElements.define("egx-session-rankings",EgxSessionRankings);
