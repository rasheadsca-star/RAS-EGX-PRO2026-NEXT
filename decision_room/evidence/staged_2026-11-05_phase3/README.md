# Phase 3 (بحثي فقط) — 2026-11-05
- strategy_holdout.json: اختبار مسجَّل مسبقًا (config/strategy_preregistration_2026-11-05.json)؛ النتيجة NO_STRATEGY_APPROVED.
- execution_gate.json: لا سهم تنفيذي (qualifiedTradeCount=0).
- event_evidence.json: EXPA (مصدر صحفي فقط، معامل 0.75556 مقابل 0.75586 ملاحظ؛ الإفصاح الرسمي غير موجود → محجوب) وCAED (حدود الأسعار بلا تعميم رسمي → JUMP باقٍ).
- basis_separation.json: فصل RAW عن Adjusted.
- needed_official_bulletins.csv: 46 نشرة مطلوبة (P1=5، P2=10، P3=31).
- ranking/symbols_status: 10 مؤهلة (AJWA مرتبة، 9 مراقبة)، 191 محجوبة.
لا ملفات SQLite هنا؛ القاعدة تُسلَّم خارج المستودع.

## إضافة 2026-11-05 (موافقة المستخدم): جدول official_close_only
- المصدر: تقارير EGX "Main Market Year to DD/MM/2026 Statistics" (DiscDoc_ID55xxx) لـ19 جلسة من 1 إلى 28 أكتوبر (الناقص: 8 أكتوبر — يُرجَّح عطلة).
- أداة: tools/official_close_evidence.py (+ test). لا تعديل على canonical_bars (التحقق: عدد وإجمالي close وvolume متطابقان قبل/بعد).
- النتيجة: CONFIRMED 1534، DB_CLOSE_DIFFERS 515، DB_BAR_MISSING 103، NOT_VERIFIED 2196.
- اكتشاف: جلستان فيهما كل الشموع نسخة من اليوم السابق (close وvolume): 2026-08-27 (145/145) و2026-10-08 (163/163). مشتبه بهما كجلسات وهمية؛ لم تُعدَّل بانتظار موافقة.
