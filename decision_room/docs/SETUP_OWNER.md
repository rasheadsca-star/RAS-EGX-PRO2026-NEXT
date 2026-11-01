# تهيئة التشغيل اليومي — خطوات المالك (لم تُنفَّذ بعد)

لم أنشئ أي مورد خارجي ولا أملك أي بيانات اعتماد. الـworkflow `decision-room-daily` **متوقف افتراضيًا** (لا يعمل إلا إذا كان متغير المستودع `DECISION_ROOM_ENABLED=true`). بعد تفعيله يفشل بوضوح عند غياب أي شرط.

## 1) تخزين دائم خاص (S3 أو Cloudflare R2)
1. أنشئ bucket **خاصًا** وفعّل **Versioning** (التطبيق يرفض العمل بدونه).
2. أنشئ مفتاح وصول مقصورًا على هذا الـbucket فقط (قراءة/كتابة/قائمة).
3. أنشئ **Secrets** في المستودع: `EGX_STORE_BUCKET`, `EGX_STORE_ACCESS_KEY_ID`, `EGX_STORE_SECRET_ACCESS_KEY`، و`EGX_STORE_ENDPOINT` (لـR2 فقط). **Variables** اختيارية: `EGX_STORE_PREFIX` (الافتراضي egx-central)، `EGX_STORE_REGION`.
4. حمّل النسخة الأولى مرة واحدة من جهازك (القاعدة 231MB خارج Git):
   `EGX_STORE_BUCKET=… AWS_ACCESS_KEY_ID=… AWS_SECRET_ACCESS_KEY=… python3 decision_room/central_store.py bootstrap --db egx_central_research.sqlite`
   (يرفض إن كان المخزن مُهيَّأ مسبقًا). ثم: `central_store.py list` للتحقق، و`restore --manifest <key>` للرجوع لإصدار سابق.

## 2) مشروع Vercel معاينة مستقل
1. أنشئ مشروعًا جديدًا اسمه **egx-pro-decision-preview** (بلا ربط Git، بلا دومين إنتاج، لا تلمس مشاريع EGX القديمة).
2. Secrets: `VERCEL_TOKEN` (مقصور على الفريق)، `VERCEL_ORG_ID`، `VERCEL_PREVIEW_PROJECT_ID`.
3. إن كانت حماية النشر (Deployment Protection) مفعلة فستفشل خطوة التحقق بـHTTP 401 — إما تُعطّل الحماية لهذا المشروع أو تضيف bypass؛ ولن يُعلَن نجاح بلا تحقق.
4. الـworkflow ينشر معاينة فقط (بلا `--prod`).

## 3) مصدر البيانات
متغير المستودع `DECISION_ROOM_DATA_REF` = الفرع/الوسم الذي تُكتب فيه `data/history/*.json` يوميًا (الفرع الذي يعمل عليه جامع البيانات الحالي). إن كان الأحدث عمره >4 أيام يفشل التشغيل ولا يُنشر شيء.

## 4) التفعيل
اضبط `DECISION_ROOM_ENABLED=true` ثم شغّل الـworkflow يدويًا (workflow_dispatch) وراجع الـartifact. لا دمج في main قبل اعتماد GPT-6.
