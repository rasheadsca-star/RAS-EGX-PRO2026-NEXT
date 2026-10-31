# V4 Pages publisher collision — detected 2026-10-31

Status: **BLOCKED — DO NOT MERGE OR DEPLOY**.

## Evidence
- PR #187 CI run **41205300117** fails at "Enforce only one Pages publisher".
- Guard reports **40+** existing workflows with `actions/deploy-pages@` including `static.yml`, `mobile-hotfix-deploy.yml`, multiple historical V13–V17 jobs and `astra-development-final-certification.yml`.
- Passing static source check does **not** mean the published Pages artifact will remain V4; any competing publisher may overwrite it.
- Existing experimental guard is intentionally fail-closed, and PR remains a draft.
- Do not alter `data/central_history.sqlite`, frozen V4 ZIP, `data/seed_opportunities.json`, reference recommendations, or original V4 interface.

## Independent reviewer (Claude / Codex) required
1. Inventory each workflow: exact trigger (push/schedule/workflow_run/dispatch), branch, Pages artifact path and environment, last successful deployment, owner, and dependencies.
2. Classify each as active Pages publisher versus dormant/archival. A textual grep alone does not establish which one actively deploys.
3. Recommend minimal non-destructive retirement/disablement of competing publishers, while preserving historic workflows and archived results. No mass deletion and no Astra activation.
4. Identify the one designated publisher for `/RAS-EGX-PRO2026-NEXT/paper-v4/index.html`, with protected branch and release approvals.
5. Prove it with live HTTP 200, V4 identity, dated 2026-10-29 seed, and repeated checks after a scheduled publisher would normally run.
6. Present a PR and rollback plan; no production merge before independent review and green checks.

## Current decision
Do not weaken this guard to 'PASS' merely by whitelisting all existing publishers. Resolve the deployment architecture first.
