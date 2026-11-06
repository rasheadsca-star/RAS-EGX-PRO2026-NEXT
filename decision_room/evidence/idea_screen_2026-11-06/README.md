# فحص 6 أفكار تعتمد على بنية سوق EGX (مسجّل مسبقًا، التزام 59d0155)
اكتشاف 2017–2021، تحقق 2022–2024، 2025–2026 معلوماتية. تكلفة 0.96% للدورة، المعيار: متوسط الأسهم المؤهلة بنفس الأفق.
**النتيجة: لا فكرة مرشحة** (I1 استمرار صعود الحد الأعلى، I2 ارتداد هبوط الحد الأدنى، I3 اختراق بحجم، I4 تغيّر الشهر، I6 تشبع بيعي في اتجاه صاعد، I7 قفزة سيولة). كلها ≤0 صافيًا في التحقق؛ I1 فقط موجبة الوسط (+1.3%، n=43) لكن حدها الأدنى سالب والعينة صغيرة وانعكست في 2025–2026.
أيام الأسبوع (وصفي): متوسط عائد يومي الاثنين −0.115%، الأحد +0.076%، الثلاثاء +0.136%، الأربعاء +0.018%، الخميس +0.159%.

## v2 (Amendment 1) — supersedes v1
v1 (`idea_screen.json`) is RETRACTED as the formal screen (defects: future-conditioned |ret|<=60% filter, I4 clip/fillna and no benchmark, one cost for a daily-rebalanced I4, impact ignored, exclusions unlogged, hardcoded parameters).
Registered before the rerun: `config/idea_screen_prereg_2026-11-06_AMENDMENT1.json` (commit bd5e948). Result: `idea_screen_v2.json`, exclusions/missing log: `idea_screen_v2_events.csv`.
Same DB as v1 (sha256 9c891244...8a28). Benchmark is now equally costed (so excess ~ gross edge over the universe).
**Result: no candidate.** All 6 lower bounds (alpha 0.001) < 0. Most positive: I1 (limit-up continuation) mean net excess +2.3% / +2.5% (discovery/validation) but n=42/43 (<100 required) and lb<0 — noise-level, not a lead. Missing outcomes <=2.3% except exposed I1 (12%, informational only). Multiplicity: alpha 0.05/6 covers these 6 ideas only; project-wide count is larger, hence the strict 0.001 gate.
Limits: impact uses ADV20 at signal; no T-bill hurdle; exposed 2025-26 informational only.
