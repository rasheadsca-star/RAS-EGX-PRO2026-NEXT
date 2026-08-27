# SEPA-X Read-Only Adapter Contract

Gann Fusion X لا يكتب إلى SEPA-X ولا يعتمد على DOM الخاص بواجهته.

عند توفر snapshot أو JSON endpoint موثق، يقبل الموصل أي مصفوفة باسم `stocks` أو `results` أو `recommendations`، ويبحث عن:
- ticker / symbol / code
- qvuaScore / score / qualityScore
- trendScore
- rsScore / relativeStrength
- breakoutScore / entryScore
- financialVerified / verified

إذا لم يتوفر مصدر منظم، تظهر الواجهة بوضوح أن SEPA-X غير متصل بدل اختلاق بيانات بديلة.
