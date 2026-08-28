# EGX TFE V20 Fusion RC2 — Safe Snapshot-Date Shell

This package is an additive, display-only shell. It does **not** modify the frozen TFE V20 Fusion RC2 runtime.

## Architecture

- `/` is a thin wrapper.
- `/core/` proxies to the immutable accepted RC2 production deployment.
- The RC2 UI runs same-origin inside an iframe, preserving its localStorage evidence.
- `snapshot-date-fix.js` is injected into that iframe at runtime and only corrects display semantics:
  - current market session
  - current published recommendation count
  - latest frozen recommendation snapshot date
- The proxy refuses mutable aliases to prevent recursive proxying after the shell is promoted on the same project.
- If the immutable deployment is protected, the proxy uses Vercel's official `VERCEL_AUTOMATION_BYPASS_SECRET` as `x-vercel-protection-bypass`.

## Required Vercel setting

In the target project, enable **Deployment Protection → Protection Bypass for Automation**, then redeploy this shell. Vercel provides `VERCEL_AUTOMATION_BYPASS_SECRET` as a system environment variable.

## Safety behavior

If Protection Bypass is absent and the immutable RC2 origin redirects to Vercel SSO, the proxy fails closed with HTTP 502 and `x-rc2-proxy-error: PROTECTION_BYPASS_REQUIRED`. It never falls back to the mutable production alias.

## Acceptance

1. `npm test` passes.
2. `/core/` loads the accepted frozen RC2 UI.
3. `/api/index?route=health` returns `TFE_V20_FUSION_RC2`.
4. Current market session and latest frozen recommendation snapshot are shown separately.
5. No frozen runtime files are modified.
