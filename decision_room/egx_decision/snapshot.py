import datetime,json,hashlib,pandas as pd
from . import SCHEMA_VERSION,config as K
from .ingest import load,DataError
from .quality import evaluate,waterfall
from .screening import indicators,reasons
from .ranking import split
from .regime import compute as h1_compute
def _name(ident,t):
    for col in("name_ar","name_en"):
        v=ident[col].get(t) if t in ident.index else None
        if isinstance(v,str) and v.strip():return v.strip()
    return ""
def build(db,now=None,asof=None):
    now=now or datetime.datetime.now(datetime.timezone.utc)
    data=load(db,asof)
    res,nobars,session=evaluate(data)
    if session.date()>now.date():raise DataError(f"future session {session.date()} > now {now.date()}")
    wf=waterfall(res,nobars)
    bars=data["bars"];ident=data["ident"].set_index("ticker")
    gates=data["gates"].set_index("ticker")
    rows=[];blocked=[]
    for _,q in res.iterrows():
        t=q["ticker"];nm=_name(ident,t)
        if not q["passed"]:
            blocked.append(dict(ticker=t,name=nm,last_date=q["last_date"],adv20=round(q["adv20"],0),reasons=q["reasons"]));continue
        g=bars[(bars.ticker==t)&(bars.date<=session)].drop_duplicates("date",keep="last").set_index("date").sort_index()
        ind=indicators(g,session);tier=g["evidence_tier"].iloc[-1]
        warn=[]
        if tier!="OFFICIAL_EGX":warn.append("آخر إغلاق من مصدر واحد/غير رسمي")
        warn.append("مستويات الدخول والوقف والأهداف غير معتمدة")
        row=dict(ticker=t,name=nm,date=g.index[-1].date().isoformat(),source=tier,**ind,reasons=reasons(ind,tier),warnings=warn,
                 gate_research=bool(gates.research_ready.get(t,0)),gate_paper=bool(gates.paper_ready.get(t,0)),
                 levels=dict(status="UNAPPROVED_NO_TESTED_RULE",entry=None,stop=None,target1=None,target2=None,
                             note="لا دخول معتمد: لا توجد استراتيجية مثبتة ولم يُتحقق من خطوة السعر الرسمية"))
        rows.append(row)
    ranked,watch=split(rows)
    h1=h1_compute(data,session.date().isoformat())
    h1_ok=h1.get("state") in("CASH","IN_MARKET") and h1.get("session")==session.date().isoformat()
    market=h1 if h1_ok else dict(state="UNKNOWN",reason=h1.get("reason","H1 غير مطابق للبيانات"))
    market["guidance"]=("لا توصية تعرّض: لا توجد استراتيجية معتمدة ولا بيانات مراكزك. القراءة تجريبية للاختبار الأمامي فقط."
                        if h1_ok else "حالة السوق غير معروفة: لا قراءة سوقية.")
    core=dict(schema=SCHEMA_VERSION,source_session=session.date().isoformat(),market=market,counts=dict(wf,ranked=len(ranked),watchlist=len(watch)),
        strategy_approved=False,live_execution_enabled=False,live_ready=0,paper_signals_generated=0,verdict="NO_STRATEGY_APPROVED",
        ranked=ranked,watchlist=watch,blocked=sorted(blocked,key=lambda b:b["ticker"]),no_bars_symbols=nobars)
    core["content_sha256"]=hashlib.sha256(json.dumps(core,sort_keys=True,ensure_ascii=False,separators=(",",":"),allow_nan=False).encode()).hexdigest()
    out=dict(core);out["generated_utc"]=now.isoformat()
    json.dumps(out,allow_nan=False)  # fail loudly on NaN/Inf: invalid JSON would blank the UI
    return out
def decision_facts(snap):
    """Time-free facts for the immutable journal."""
    return dict(session=snap["source_session"],market_state=snap["market"].get("state"),ranked=[r["ticker"] for r in snap["ranked"]],
        watchlist=[r["ticker"] for r in snap["watchlist"]],blocked=len(snap["blocked"]),verdict=snap["verdict"],content_sha256=snap["content_sha256"])
