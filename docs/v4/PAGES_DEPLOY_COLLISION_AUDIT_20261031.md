# V4 Pages deployment collision: corrected source audit (31 October 2026)

## Scope and evidence
Read current `.github/workflows/{static,mobile-hotfix-deploy,v14-stable-decision-system,egx-elite-pages,astra-development-final-certification}.yml` on `main`.

| Workflow | Real publish action | Trigger details | Risk |
| --- | --- | --- | --- |
| `static.yml` | `actions/deploy-pages@v5`, root artifact | push main; dispatch; schedule `15 12-21 * * 0-5` | intended broad publisher; may contend with other workflows |
| `mobile-hotfix-deploy.yml` | `actions/deploy-pages@v4`, root artifact | dispatch; selected pushes; schedule `35 11-20 * * 0-4` | another independent scheduled publisher |
| `v14-stable-decision-system.yml` | `actions/deploy-pages@v4` (three fallback attempts), root artifact | dispatch; data change pushes; 3 scheduled times Sun-Thu | another independent scheduled publisher |
| `egx-elite-pages.yml` | `actions/deploy-pages@v4`, root artifact | selective push main; dispatch | additional occasional publisher |
| `astra-development-final-certification.yml` | **NO** deployment action; string appears in shell grep guard | push development branch; dispatch | **false positive** if counted by substring |

## Important correction
PR #187 initial policy used a naive substring search for `actions/deploy-pages@`. It therefore flagged comments/shell grep expressions in dormant workflows as if they were actual deploy steps. The CI **failure is real**, but the raw count is **not an accurate count of active publishers**. A source-level parser, workflow-trigger inspection, and run-history inventory are required before removing any jobs.

## Release decision
- Do not merge PR #187 as-is; its check would block all current CI and exaggerate publisher count.
- Do not disable unrelated legacy pipelines, modify frozen V4 assets, or introduce Astra routing.
- Plan a **dedicated independent V4 deployment target/environment**, or consolidate all publishing on one scrutinized workflow with arbitration and rollback.
- The static V4 summary does not operate the original SQLite/pipeline or auto-refresh.
- No live host verification or GitHub Pages deployment control was executed in this audit.
