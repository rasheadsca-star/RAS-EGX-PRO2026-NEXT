# EGX GANN FUSION X — Architecture Contract

## الهدف
بناء طبقة تحليل مستقلة تستفيد من أدلة المحركات السابقة دون تعديلها أو الكتابة في ملفاتها.

## قواعد غير قابلة للتفاوض
1. مجلد `gann-fusion-x/` فقط هو نطاق الكتابة للمحرك الجديد.
2. `preview-v16/`, `data/stable/`, `scripts/stable/` مصادر قراءة فقط.
3. لا أوامر تداول آلية ولا تكامل تنفيذ وساطة.
4. لا إشارة مرتفعة الثقة عند قدم البيانات أو تعارض الجلسات.
5. لا يتم اختلاق حسابات Gann عند عدم توفر تاريخ OHLCV كافٍ.
6. سجل الإشارات مستقل ولا يعيد تسمية توصيات المحركات القديمة كإشارات Fusion X.
7. الاختبار التاريخي يمنع future leakage ويعامل لمس الهدف والوقف في الجلسة نفسها بصورة تحفظية.
8. المصطلحات الإنجليزية تعرض معها صياغة عربية مبسطة.

## المحركات الداخلية
- Gann Time Cycles
- Square of Nine price confluence
- Trend
- Relative Strength
- Breakout structure
- Volume confirmation
- Momentum
- Fundamental/quality adapter
- Entry quality
- Risk/Reward research plan
- Market regime
- Consensus & Conflict
- Acceptance review
- Conservative backtest

## الواجهات
الخلاصة، اليومي، الأسبوعي، Gann Radar، Breakout Radar، Accumulation Radar، Avoid/Cool-off، Market, Consensus, History, Backtest, Data Quality, Methodology/Glossary.
