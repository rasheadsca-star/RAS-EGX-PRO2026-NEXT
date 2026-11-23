const stocks={
  "HRHO": {
    "name": "EFG Holding",
    "close": 25.5,
    "high": 25.9,
    "low": 24.12,
    "change": 0
  },
  "ADIB": {
    "name": "Abu Dhabi Islamic Bank- Egypt",
    "close": 45.89,
    "high": 46.29,
    "low": 44.5,
    "change": -0.67
  },
  "ETEL": {
    "name": "Telecom Egypt",
    "close": 137,
    "high": 141.9,
    "low": 134.1,
    "change": -0.01
  },
  "FWRY": {
    "name": "Fawry For Banking Technology And Electronic Payment",
    "close": 16.98,
    "high": 17.07,
    "low": 16.73,
    "change": -1.85
  },
  "CLHO": {
    "name": "Cleopatra Hospital Company",
    "close": 14,
    "high": 14,
    "low": 13.12,
    "change": -0.28
  },
  "ATQA": {
    "name": "Misr National Steel - Ataqa",
    "close": 10.02,
    "high": 10.7,
    "low": 9.58,
    "change": -0.99
  }
};
const rankings={
  "30/40/30": [
    "HRHO",
    "ADIB",
    "FWRY",
    "ETEL",
    "CLHO"
  ],
  "50/30/20": [
    "HRHO",
    "ADIB",
    "ETEL",
    "FWRY",
    "CLHO"
  ],
  "20/40/40": [
    "HRHO",
    "ETEL",
    "ADIB",
    "FWRY",
    "ATQA"
  ],
  "30/30/40": [
    "HRHO",
    "ETEL",
    "ADIB",
    "FWRY",
    "ATQA"
  ],
  "60/20/20": [
    "HRHO",
    "ETEL",
    "ADIB",
    "FWRY",
    "CLHO"
  ],
  "50/20/30": [
    "HRHO",
    "ETEL",
    "ADIB",
    "ATQA",
    "FWRY"
  ],
  "40/40/20": [
    "HRHO",
    "ADIB",
    "FWRY",
    "CLHO",
    "ETEL"
  ],
  "40/30/30": [
    "HRHO",
    "ETEL",
    "ADIB",
    "FWRY",
    "ATQA"
  ],
  "33/33/34": [
    "HRHO",
    "ETEL",
    "ADIB",
    "FWRY",
    "ATQA"
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
