# خطة الدمج الآمن إلى main — للمراجعة فقط، لم تُنفَّذ

الحالة: بحث فقط، `NO_STRATEGY_APPROVED`، `qualifiedTradeCount=0`. لا دمج ولا نشر ولا تداول.

## 1) ترتيب الـPRs (الحالة الفعلية من GitHub REST)
| PR | base ← head |
|---|---|
| #197 | main ← claude/decision-room-v3-20261101 |
| #198 | claude/decision-room-v3-20261101 ← feature/paper-scenarios-review-20261102 |
| #207 | claude/decision-room-v3-20261101 ← claude/official-map-walkforward-20261104 |
| #206 | main ← fix/paper-v4-official-coverage-audit-20261104 (مستقل، يُراجع منفصلًا) |

الترتيب المقترح (كل خطوة بقرار المالك): (a) دمج #198 في v3، (b) دمج #207 في v3 بعد مراجعته، (c) مراجعة نهائية لـ#197 كاملًا ثم دمجه في main بـ squash أو merge commit حسب سياسة المالك. #207 لا يُدمج في main مباشرة.

## 2) بوابات ما قبل الدمج (كلها إلزامية)
1. CI أخضر على آخر SHA: decision-room-ci (unit + browser) وS2 وSecret Scan.
2. `git diff --stat origin/main...HEAD` يمس فقط `decision_room/**` وملفي workflow (`decision-room-ci.yml`, `decision-room-daily.yml`). أي ملف آخر = إيقاف.
3. لا ملفات `*.sqlite` أو `*.gz` للبيانات في الشجرة (فحص: `git ls-files | grep -Ei '\.(sqlite|db|gz)$'`).
4. مراجعة مالك + مراجعة مستقلة (GPT) على الأدلة في `evidence/`.
5. الـworkflows الفاشلة مسبقًا (v15، fix-v13-3) لا ترتبط بالتغيير؛ تُوثَّق ولا تُصلح ضمن الدمج.
6. `decision-room-daily` يبقى معطّلًا حتى تُضبط `DECISION_ROOM_ENABLED` و`STORAGE_OWNER_APPROVED` يدويًا من المالك.
7. التراجع: `git revert -m 1 <merge-sha>`؛ لا يمس البيانات لأن قاعدة البيانات خارج المستودع.

## 3) ربط القاعدة المركزية بمحرك Vercel
```
R2 (egx-pro-central-db)  ──fetch+SHA──►  CI runner  ──run_daily.py──►  snapshot (public/releases/<id>)
 immutable *.sqlite.gz                   (الملف الخاص لا يخرج)         prepare_preview.py ► dist ساكن
 manifest + LATEST pointer                                                │ preflight.py deploy (hash)
                                                                          ▼
                                                     Vercel: egx-pro-decision-preview (ليس --prod)
```
- القاعدة الخاصة لا تُرفع إلى Vercel ولا إلى المستودع؛ Vercel يخدم فقط لقطة ثابتة + MANIFEST.
- `central_store.py` لا يملك عملية حذف؛ النشر `publish --expect-parent <sha>` يمنع الكتابة فوق نسخة أحدث.
- ترقية القاعدة المرحلية إلى R2 تحتاج موافقة صريحة منفصلة (لم تُجرَ أي عملية R2 ولا إنفاق).

## 4) فحص توافق القاعدة المرحلية (تم محليًا بلا R2)
- `final.sqlite` اجتازت `check_db` (الجداول المطلوبة + السلامة) عبر `LocalBackend`: bootstrap ثم fetch، وتطابق SHA256 (73a1fc2c14a8ea95…).
- `run_daily.py` على القاعدة نفسها: status=OK، ranked=1، watchlist=9، blocked=191، market_state=CASH، اللقطة 2026-11-04.

## 5) ما يلزم قبل أي تشغيل إنتاجي (خارج نطاق هذه المرحلة)
نشرات EGX الرسمية الناقصة (انظر `needed_official_bulletins.csv`)، إفصاح EXPA الرسمي، تعميم حدود الأسعار، واجتياز استراتيجية مجمّدة اختبارًا مستقلًا بعد التكاليف.
