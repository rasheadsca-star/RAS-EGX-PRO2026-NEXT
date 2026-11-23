const stocks={
  "OIH": {
    "name": "Orascom Investment Holding",
    "high": 1.64,
    "low": 1.48,
    "close": 1.64,
    "change": 10.81
  },
  "ICFC": {
    "name": "International Company For Fertilizers & Chemicals",
    "high": 26.4,
    "low": 23.92,
    "close": 26.1,
    "change": 9.94
  },
  "AMII": {
    "name": "Arabian Metal Industries And Industrial Investments",
    "high": 8.49,
    "low": 8.01,
    "close": 8.48,
    "change": 8.16
  },
  "AMER": {
    "name": "Amer Group Holding",
    "high": 3.77,
    "low": 3.6,
    "close": 3.77,
    "change": 5.6
  },
  "BIOC": {
    "name": "Glaxo Smith Kline",
    "high": 393.9,
    "low": 359.01,
    "close": 387.0,
    "change": 7.8
  },
  "COPR": {
    "name": "Copper For Commercial Investment & Real Estate",
    "high": 0.425,
    "low": 0.371,
    "close": 0.416,
    "change": 13.35
  },
  "CERA": {
    "name": "The Arab Ceramic CO.- Ceramica Remas",
    "high": 1.03,
    "low": 0.98,
    "close": 1.03,
    "change": 6.19
  }
};
const rankings={
  "50/30/20": [
    "OIH",
    "ICFC",
    "AMII",
    "AMER",
    "BIOC"
  ],
  "20/40/40": [
    "ICFC",
    "OIH",
    "AMER",
    "AMII",
    "BIOC"
  ],
  "30/30/40": [
    "ICFC",
    "OIH",
    "AMER",
    "BIOC",
    "AMII"
  ],
  "60/20/20": [
    "OIH",
    "ICFC",
    "AMII",
    "BIOC",
    "COPR"
  ],
  "50/20/30": [
    "ICFC",
    "OIH",
    "BIOC",
    "AMII",
    "AMER"
  ],
  "40/40/20": [
    "OIH",
    "ICFC",
    "AMII",
    "AMER",
    "CERA"
  ],
  "40/30/30": [
    "OIH",
    "ICFC",
    "AMII",
    "AMER",
    "BIOC"
  ],
  "30/40/30": [
    "OIH",
    "ICFC",
    "AMER",
    "AMII",
    "CERA"
  ],
  "33/33/34": [
    "ICFC",
    "OIH",
    "AMER",
    "AMII",
    "BIOC"
  ]
};
class EgxSessionRankings extends HTMLElement {
  connectedCallback() {
    if (this.shadowRoot) return;
    const root=this.attachShadow({mode:'open'});
    root.innerHTML="<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#081929;color:#eaf3fb;font:15px/1.85 Tahoma,Arial,sans-serif}header{background:#0d2c44;padding:22px max(18px,calc((100vw - 1130px)/2));border-bottom:1px solid #315b75}main{max-width:1130px;margin:auto;padding:20px}h1{margin:0}h2{margin:0 0 9px;font-size:20px}.panel{background:#102b42;border:1px solid #2c5670;border-radius:13px;padding:18px;margin:15px 0}.warn{background:#302b22;border:1px solid #9e7b39;color:#ffdfa8;padding:13px;border-radius:9px}.stat{display:inline-block;background:#153a54;border-radius:9px;padding:10px 15px;margin:6px}.muted{color:#afc7d8;font-size:13px}.scroll{overflow-x:auto}table{border-collapse:collapse;min-width:970px;width:100%}th,td{padding:10px;border-bottom:1px solid #34536d;text-align:right}th{color:#aee2fa;background:#153950}a{color:#81d6ff}.btn,button{display:inline-block;background:#17618a;border:1px solid #69c5f5;color:white;border-radius:9px;padding:9px 14px;text-decoration:none;font:inherit;cursor:pointer}input,select{font:inherit;padding:8px;background:#0b2d49;color:white;border:1px solid #6295b2;border-radius:9px;max-width:100%}.risk{color:#ffc987}.good{color:#87e8bb}footer{font-size:12px;color:#a6c3d4}:host{display:block;color:#eaf3fb;font:15px/1.85 Tahoma,Arial,sans-serif;direction:rtl}</style><section class=\"panel\"><h2>أفضل خمسة أسهم حسب الأوزان — مع الدخول والأهداف والمخاطرة</h2><label for=\"weights\">استراتيجية الأوزان: </label><select id=\"weights\"></select><p class=\"muted\">التغير اليومي / موقع الإغلاق داخل نطاق الجلسة / قيمة التداول؛ ترتيب مئوي مبدئي بين الأسهم التي اجتازت فحص الأسعار.</p><div class=\"scroll\"><table><thead><tr><th>#</th><th>السهم</th><th>الشركة</th><th>الإغلاق</th><th>تغير اليوم</th><th>الدخول الشرطي</th><th>هدف 1</th><th>هدف 2</th><th>الوقف</th><th>المخاطرة السعرية</th><th>الشارت</th></tr></thead><tbody id=\"rankrows\"></tbody></table></div><p class=\"muted\">الأهداف 1R و2R تقديرية؛ الدخول = قمة الجلسة + 0.01 والوقف = القاع − 0.01، قبل تدقيق خطوة السعر والعمولات والانزلاق. مخاطرة تفوق 8% تُعرض للتنبيه لا للإقرار.</p></section>";
    const $=id=>root.getElementById(id),fix=v=>Number(v).toFixed(2);Object.keys(rankings).forEach(w=>{const o=document.createElement('option');o.value=w;o.textContent=w;$('weights').append(o)});$('weights').value='30/40/30';function draw(){const tbody=$('rankrows');tbody.replaceChildren();rankings[$('weights').value].forEach((sym,i)=>{const s=stocks[sym],entry=+(s.high+.01).toFixed(2),stop=+(s.low-.01).toFixed(2),r=entry-stop,vals=[i+1,sym,s.name,fix(s.close),fix(s.change)+'%',fix(entry),fix(entry+r),fix(entry+2*r),fix(stop),fix(r/entry*100)+'%'];const tr=document.createElement('tr');vals.forEach((v,j)=>{const td=document.createElement('td');td.textContent=v;if(j===9&&r/entry>.08)td.className='risk';tr.append(td)});const td=document.createElement('td'),a=document.createElement('a');a.href=new URL('../../chart.html?stock='+encodeURIComponent(sym), import.meta.url).href;a.textContent='عرض';td.append(a);tr.append(td);tbody.append(tr)})} $('weights').onchange=draw;draw();
  }
}
customElements.define('egx-session-rankings', EgxSessionRankings);
