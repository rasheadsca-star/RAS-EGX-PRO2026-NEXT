# تهيئة التشغيل اليومي — خطوات المالك (لم تُنفَّذ بعد)

لم أنشئ أي مورد خارجي ولا أملك أي بيانات اعتماد. الـworkflow `decision-room-daily` **متوقف افتراضيًا** (لا يعمل إلا إذا كان متغير المستودع `DECISION_ROOM_ENABLED=true`). بعد تفعيله يفشل بوضوح عند غياب أي شرط.

## 1) تخزين Cloudflare R2 (الـbucket `egx-pro-central-db` أُنشئ بالفعل)
**اقرأ أولًا `docs/STORAGE_COST_RISK.md`** (التجاوز يُحاسَب ولا يُوقَف). R2 لا يدعم Versioning على نمط S3، فالتصميم الآن نسخ غير قابلة للاستبدال بأسماء فريدة + manifest + مؤشر + سجل مؤشرات، بدون حذف.
1. أنشئ **API Token** لـR2 بصلاحية Object Read & Write على هذا الـbucket فقط.
2. Secrets: `EGX_STORE_BUCKET`=egx-pro-central-db, `EGX_STORE_ENDPOINT`=https://<ACCOUNT_ID>.r2.cloudflarestorage.com, `EGX_STORE_ACCESS_KEY_ID`, `EGX_STORE_SECRET_ACCESS_KEY` (انظر `config/storage.example.env`).
3. اختياريًا خفّض الحدود بالمتغيرات `EGX_STORE_LIMIT_*` (لا يمكن رفعها فوق السقف).
4. من جهازك، مرة واحدة ومراقَبة: `python3 decision_room/central_store.py check-config` ثم `bootstrap --db egx_central_research.sqlite`، ثم `usage` و`list`. للتجربة بلا أي اتصال: `pytest`-style tests تعمل على LocalBackend.
5. **لا تضبط** `STORAGE_OWNER_APPROVED=true` إلا بعد موافقتك على المخاطر.
## 2) مشروع Vercel معاينة مستقل
1. أنشئ مشروعًا جديدًا اسمه **egx-pro-decision-preview** (بلا ربط Git، بلا دومين إنتاج، لا تلمس مشاريع EGX القديمة).
2. Secrets: `VERCEL_TOKEN` (مقصور على الفريق)، `VERCEL_ORG_ID`، `VERCEL_PREVIEW_PROJECT_ID`.
3. إن كانت حماية النشر (Deployment Protection) مفعلة فستفشل خطوة التحقق بـHTTP 401 — إما تُعطّل الحماية لهذا المشروع أو تضيف bypass؛ ولن يُعلَن نجاح بلا تحقق.
4. الـworkflow ينشر معاينة فقط (بلا `--prod`).

## 3) مصدر البيانات
متغير المستودع `DECISION_ROOM_DATA_REF` = الفرع/الوسم الذي تُكتب فيه `data/history/*.json` يوميًا (الفرع الذي يعمل عليه جامع البيانات الحالي). إن كان الأحدث عمره >4 أيام يفشل التشغيل ولا يُنشر شيء.

## 4) التفعيل
اضبط `DECISION_ROOM_ENABLED=true` و`STORAGE_OWNER_APPROVED=true` ثم شغّل الـworkflow يدويًا (workflow_dispatch) وراجع الـartifact. لا دمج في main قبل اعتماد GPT-6.
