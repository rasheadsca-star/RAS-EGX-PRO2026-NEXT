# EGX PRO — تشغيل خدمة الاستيراد الدائم (مرحلة ما قبل الإنتاج)

**الحالة:** تم إعداد Docker Compose، لكن لم يتم نشره على خادم عام. لا توجد قاعدة بيانات إنتاج حاليًا.

## المتطلبات

- خادم VPS أو Managed Container يدعم Docker Compose وأقراص بيانات دائمة.
- اسم نطاق فرعي مملوك لك يشير إلى عنوان الخادم، مع منافذ 80 و443 مفتوحة.
- Python وNode ضمن الحاوية؛ TLS تلقائي بواسطة Caddy.
- تخزين Docker volume `egx_data` يستمر بعد إعادة تشغيل الحاويات، لكنه يحتاج نسخًا احتياطيًا مستقلًا.

## التحضير على الخادم (مرة واحدة)

```bash
git clone https://github.com/rasheadsca-star/RAS-EGX-PRO2026-NEXT.git
cd RAS-EGX-PRO2026-NEXT/egx-pro-research-12nov2026/operations
cp .env.example .env
python3 -c 'import secrets; print(secrets.token_urlsafe(48))'
```

حرّر `.env`: اضبط `EGX_DOMAIN` على نطاق حقيقي، وضع المفتاح العشوائي في `EGX_UPLOAD_KEY`. لا ترسل المفتاح في المحادثة أو في GitHub. اترك `EGX_FETCH_ENABLED=false` حتى يتم تأكيد رابط مباشر صحيح للنشرة الرسمية؛ الرابط الافتراضي غير مثبت.

```bash
chmod 600 .env
docker compose build
docker compose up -d
docker compose ps
docker compose exec api python -c "import sqlite3; print('SQLite ready')"
```

بعد ضبط DNS وشهادة HTTPS، استخدم:

`https://<your-domain>/admin`

الرفع من الواجهة الإدارية يصل إلى `POST /api/ingest`، ويستخدم نفس قاعدة البيانات الدائمة المشتركة مع الحاوية `scheduler`.

## اختبار المسار الآلي يدويًا على الخادم

```bash
docker compose cp /private/path/DiscDoc_ID1022_19-Nov-2026_ENG.pdf scheduler:/tmp/report.pdf
docker compose exec scheduler python scheduled_worker.py --once --file /tmp/report.pdf
docker compose exec api python -c "import os,sqlite3; c=sqlite3.connect('/data/ingest.sqlite3'); print(c.execute('select session,state,count(*) from ingests group by session,state').fetchall())"
```

**مهم:** CLI باستخدام `--file` يحاكي وصول PDF من الجلب، لكنه لا يثبت نجاح الوصول إلى موقع EGX. لا تُفعّل الجلب الآلي قبل تجربة رابط المصدر والتحقق من التاريخ والملف المخرج.

## اختبارات تشغيل قبول إلزامية

1. رفع جلسة 18/11/2026 من صفحة /admin والتحقق من SHA-256 والسجل.
2. استيراد جلسة 19/11/2026 من حاوية scheduler إلى نفس `/data/ingest.sqlite3`.
3. إعادة رفع الملف نفسه: `duplicate=true` وعدد السجلات ثابت.
4. إعادة تشغيل `docker compose restart` والتأكد من بقاء البيانات في volume.
5. رفض مفتاح خاطئ، محتوى غير PDF، ملف كبير، وتاريخ غير واضح.
6. مراجعة سجلات الأخطاء ونسخ volume احتياطيًا إلى مخزن خارج الخادم.

**بوابات إصدار التداول الورقي لا تزال مغلقة**: هذا المسار يحفظ/يستخرج/يفحص فقط؛ لا يحدث التوصيات آليًا، ولا ينشر بيانات `latest.json`، ولا يملك سجل ISIN مكتملًا.

## مواضع الاستقرار والأمن المتبقية

- صلاحية النشر على خادم أو مشروع سحابي.
- مراجعة أمنية إنتاجية تشمل إدارة المستخدمين، تحديد المعدل، سجل المشغل، CSRF عند إضافة cookie auth، الحماية من الملفات الخبيثة.
- مصدر بيانات EGX الموثوق وتوقيت توفر التقرير وتواريخ العطلات.
- معالجة تعارض ملفين بنفس تاريخ الجلسة، واسترداد حالات STAGED بعد تعطل مفاجئ.
- النسخ الاحتياطي والتنبيه والمراقبة واستعادة البيانات.
- نشر التوصيات ذريًا بعد استكمال 200 سهم موثق ISIN/خطوة سعر، وسجل الأداء التاريخي.

لا ترفع نسخة API إلى الإنترنت بدون TLS أو تنشر مفتاحها في JavaScript ثابت. لا يمكن لـ GitHub Pages وحده أن يستضيف SQLite أو نقطة رفع خادمية.
