# V11.5 Batch Backfill Controller

هذا الإصدار يعالج مشكلة أن محرك V11.4 كان يفحص عددًا كبيرًا من الأسهم دفعة واحدة، فيطول تشغيل GitHub Actions أو يتم إلغاؤه قبل كتابة التقرير النهائي.

## ما الجديد؟

- تشغيل البحث التاريخي على دفعات صغيرة بدل 224 سهم مرة واحدة.
- الحجم الافتراضي للدفعة: 40 سهم.
- حفظ نقطة استكمال في:
  - `data/v11-5-backfill-checkpoint.json`
- حفظ تقرير الدفعة في:
  - `data/v11-5-batch-backfill-report.json`
- كل تشغيل جديد مع `history_maintenance=true` يكمل من آخر موضع بدل البدء من الصفر.
- تقليل timeout لكل مصدر حتى لا يتوقف الـ Workflow مدة طويلة.

## التشغيل

من GitHub:

`Actions → Update EGX Market Data → Run workflow → history_maintenance = true`

ثم افتح التطبيق مع كاش جديد:

`?v=115-batch-backfill`

## ملاحظات مهمة

- لا توجد بيانات وهمية.
- لا يوجد CSV يدوي.
- لا يتم قبول أي جلسة تاريخية إلا بعد فحص OHLCV.
- إذا ظل `Parsed = 0`، راجع:
  - `data/v11-5-batch-backfill-report.json`
  - `data/debug/history-fetch-samples/`
