#!/usr/bin/env python3
from __future__ import annotations

import json
import math
import sys
from datetime import date
from pathlib import Path
from statistics import mean

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

try:
    from scripts.v18.forward import verify_ledger
except Exception:
    verify_ledger = None

TRANSACTION_COST_PCT = 0.6
DEFAULT_POLICY = {
    "schemaVersion": "18.0.0-production-qualification-policy-1",
    "transactionCostPct": TRANSACTION_COST_PCT,
    "evidenceGate": {
        "minimumResolvedCohorts": 30,
        "minimumResolvedMembers": 100,
        "minimumObservedCalendarDays": 90,
    },
    "pairedGate": {"minimumResolvedPairedCohorts": 30},
}


def load_policy(root):
    path = root / "config" / "v18-production-qualification.json"
    return json.loads(path.read_text()) if path.exists() else DEFAULT_POLICY


def _finite(value):
    try:
        value = float(value)
        return value if math.isfinite(value) else None
    except (TypeError, ValueError):
        return None


def _valid_ohlc(row):
    try:
        date.fromisoformat(str(row.get("date")))
    except (TypeError, ValueError):
        return False
    o, h, l, c = (_finite(row.get(k)) for k in ("open", "high", "low", "close"))
    return (
        None not in (o, h, l, c)
        and o > 0
        and l > 0
        and h >= max(o, c, l)
        and l <= min(o, c, h)
    )


def next_session(history, signal_date):
    rows = [r for r in (history.get("sessions") or []) if _valid_ohlc(r)]
    rows.sort(key=lambda r: r["date"])
    return next((r for r in rows if r["date"] > signal_date), None)


def evaluate_next_session(
    selection,
    history,
    signal_date,
    transaction_cost_pct=TRANSACTION_COST_PCT,
):
    """Conservative standardized next-session outcome for paired comparison.

    The next-session open must be inside the frozen entry range. If target and stop are
    both touched in the same daily bar, stop wins. This mirrors the V16.9 ledger policy.
    """
    row = next_session(history, signal_date)
    base = {"ticker": selection.get("ticker"), "signalDate": signal_date}
    if row is None:
        return {
            **base,
            "resolved": False,
            "executable": False,
            "state": "PENDING_NEXT_SESSION",
        }

    low = _finite(selection.get("entryLow"))
    high = _finite(selection.get("entryHigh"))
    stop = _finite(selection.get("stop"))
    target = _finite(selection.get("target"))
    if None in (low, high, stop, target) or not (
        0 < low <= high and stop < high and target > low
    ):
        return {
            **base,
            "resolved": True,
            "executable": False,
            "state": "INVALID_FROZEN_GEOMETRY",
            "outcomeDate": row["date"],
        }

    o, h, l, c = (float(row[k]) for k in ("open", "high", "low", "close"))
    common = {
        **base,
        "resolved": True,
        "outcomeDate": row["date"],
        "open": o,
        "high": h,
        "low": l,
        "close": c,
    }
    if not (low <= o <= high):
        return {
            **common,
            "executable": False,
            "state": "NOT_ENTERED_OPEN_OUTSIDE_RANGE",
            "netReturnPct": 0.0,
        }

    target_touched = h >= target
    stop_touched = l <= stop
    if stop_touched:
        state = "AMBIGUOUS_TREATED_AS_STOP" if target_touched else "STOP_TOUCHED"
        exit_price = stop
    elif target_touched:
        state = "TARGET_TOUCHED"
        exit_price = target
    else:
        state = "CLOSED_AT_SESSION_END"
        exit_price = c

    gross = (exit_price / o - 1.0) * 100.0
    net = gross - float(transaction_cost_pct)
    return {
        **common,
        "executable": True,
        "state": state,
        "exitPrice": round(exit_price, 6),
        "targetTouched": target_touched,
        "stopTouched": stop_touched,
        "ambiguousSameSession": target_touched and stop_touched,
        "grossReturnPct": round(gross, 4),
        "netReturnPct": round(net, 4),
    }


def aggregate_member_outcomes(rows):
    resolved = [r for r in rows if r.get("resolved")]
    executable = [r for r in resolved if r.get("executable")]
    returns = [float(r.get("netReturnPct", 0.0)) for r in executable]
    wins = [v for v in returns if v > 0]
    losses = [v for v in returns if v < 0]
    profit_factor = (
        sum(wins) / abs(sum(losses))
        if losses
        else (None if not wins else float("inf"))
    )
    return {
        "members": len(rows),
        "resolvedMembers": len(resolved),
        "pendingMembers": len(rows) - len(resolved),
        "executableMembers": len(executable),
        "wins": len(wins),
        "losses": len(losses),
        "winRatePct": round(100.0 * len(wins) / len(executable), 4)
        if executable
        else None,
        "averageNetReturnPct": round(mean(returns), 4) if returns else None,
        "profitFactor": (
            round(profit_factor, 4)
            if isinstance(profit_factor, float) and math.isfinite(profit_factor)
            else ("INF" if profit_factor == float("inf") else None)
        ),
    }


def _history_for(root, ticker, cache):
    ticker = str(ticker or "").strip().upper()
    if ticker not in cache:
        path = root / "data" / "history" / f"{ticker}.json"
        cache[ticker] = json.loads(path.read_text()) if path.exists() else None
    return cache[ticker]


def _entry_has_buy_candidate(entry):
    return entry.get("portfolioDecision") != "NO_TRADE" and any(
        s.get("decision") == "BUY_CANDIDATE" for s in entry.get("selections", [])
    )


def evaluate_v18_shadow(root, ledger, transaction_cost_pct=TRANSACTION_COST_PCT):
    cache = {}
    cohort_rows = []
    all_members = []
    promotion_members = []
    for entry in ledger.get("entries", []):
        members = []
        native_candidates = []
        for selection in entry.get("selections", []):
            history = _history_for(root, selection.get("ticker"), cache)
            if history is None:
                outcome = {
                    "ticker": selection.get("ticker"),
                    "signalDate": entry.get("sessionDate"),
                    "resolved": False,
                    "executable": False,
                    "state": "MISSING_HISTORY",
                }
            else:
                outcome = evaluate_next_session(
                    selection,
                    history,
                    entry.get("sessionDate"),
                    transaction_cost_pct,
                )
            outcome["decision"] = selection.get("decision")
            members.append(outcome)
            all_members.append(outcome)
            if (
                entry.get("portfolioDecision") != "NO_TRADE"
                and selection.get("decision") == "BUY_CANDIDATE"
            ):
                native_candidates.append(outcome)
                promotion_members.append(outcome)
        cohort_rows.append(
            {
                "signalId": entry.get("signalId"),
                "sessionDate": entry.get("sessionDate"),
                "portfolioDecision": entry.get("portfolioDecision"),
                "productionAuthority": bool(entry.get("productionAuthority")),
                "shadowMembers": members,
                "promotionEligibleMembers": native_candidates,
                "shadowResolved": bool(members)
                and all(m.get("resolved") for m in members),
                "promotionResolved": bool(native_candidates)
                and all(m.get("resolved") for m in native_candidates),
            }
        )
    return cohort_rows, all_members, promotion_members


def _observed_days(entries, cohort_rows):
    promotion_entries = [e for e in entries if _entry_has_buy_candidate(e)]
    if not promotion_entries:
        return 0
    starts = [e.get("sessionDate") for e in promotion_entries if e.get("sessionDate")]
    eligible_sessions = {e.get("sessionDate") for e in promotion_entries}
    outcome_dates = [
        m.get("outcomeDate")
        for c in cohort_rows
        if c.get("sessionDate") in eligible_sessions
        for m in c.get("promotionEligibleMembers", [])
        if m.get("outcomeDate")
    ]
    if not starts:
        return 0
    start = date.fromisoformat(min(starts))
    end = date.fromisoformat(max(outcome_dates)) if outcome_dates else start
    return max(0, (end - start).days)


def _extract_reference(v17_current):
    evidence = v17_current.get("evidence") or {}
    champion = v17_current.get("championChallenger") or {}
    return {
        "activeEngine": champion.get("activeEngine")
        or (v17_current.get("engine") or {}).get("id"),
        "challengerStatus": champion.get("status"),
        "promotionAllowed": bool(champion.get("promotionAllowed")),
        "v16_9LegacyMethodEvidence": evidence.get("legacyMethodEvidence"),
        "v17NativeEvidence": evidence.get("nativeV17"),
        "researchAudit": evidence.get("researchAudit"),
    }


def _paired_status(v18_ledger, v17_ledger, cohort_rows):
    v18_by_session = {
        e.get("sessionDate"): c
        for e, c in zip(v18_ledger.get("entries", []), cohort_rows)
        if e.get("sessionDate") and _entry_has_buy_candidate(e)
    }
    control_by_session = {
        e.get("sessionDate"): e
        for e in v17_ledger.get("entries", [])
        if e.get("engineId") == "V16_9_EQUAL_WEIGHT_BASKET"
        and e.get("sessionDate")
    }
    common = sorted(set(v18_by_session) & set(control_by_session))
    resolved = []
    pending = []
    for session in common:
        v18_done = bool(v18_by_session[session].get("promotionResolved"))
        control = control_by_session[session]
        control_done = control.get("status") == "RESOLVED" and bool(
            (control.get("outcome") or {}).get("resolved")
        )
        row = {
            "sessionDate": session,
            "v18Resolved": v18_done,
            "v16_9Resolved": control_done,
        }
        (resolved if v18_done and control_done else pending).append(row)
    return {
        "commonCohorts": len(common),
        "resolvedPairedCohorts": len(resolved),
        "pendingPairedCohorts": len(pending),
        "resolved": resolved,
        "pending": pending,
    }


def _data_alignment(current, ledger):
    if not current:
        return {
            "available": False,
            "reason": "CURRENT_ARTIFACT_NOT_AVAILABLE",
        }
    entries = ledger.get("entries", [])
    last = entries[-1] if entries else None
    hash_match = bool(
        last and current.get("artifactHash") == last.get("sourceArtifactHash")
    )
    readiness = current.get("dataReadiness") or []
    selected = {s.get("ticker") for s in (last or {}).get("selections", [])}
    by_ticker = {r.get("ticker"): r for r in readiness}
    selected_dates = {
        t: (by_ticker.get(t) or {}).get("lastSession") for t in selected
    }
    selected_aligned = bool(selected) and all(
        d == (last or {}).get("sessionDate") for d in selected_dates.values()
    )
    ready = (current.get("dataset") or {}).get("ready") or 0
    files = (current.get("dataset") or {}).get("files") or 0
    readiness_pct = 100.0 * ready / files if files else 0.0
    return {
        "available": True,
        "sourceArtifactHashMatchesLatestFrozenCohort": hash_match,
        "note": "Hash comparison is diagnostic only; historical frozen cohorts are validated by their immutable snapshot hash and prospective sourceSessionEvidence.",
        "selectedLastSessions": selected_dates,
        "selectedSessionAligned": selected_aligned,
        "ready": ready,
        "files": files,
        "readinessPct": round(readiness_pct, 4),
    }


def _promotion_contract_gate(ledger, transaction_cost_pct):
    eligible = [e for e in ledger.get("entries", []) if _entry_has_buy_candidate(e)]
    violations = []
    checked = []
    for entry in eligible:
        signal_id = entry.get("signalId")
        session = entry.get("sessionDate")
        execution = entry.get("executionPolicy") or {}
        allocation = entry.get("portfolioAllocationPolicy") or {}
        source = entry.get("sourceSessionEvidence") or {}
        lineage = entry.get("modelLineage") or {}
        candidates = sorted(
            s.get("ticker")
            for s in entry.get("selections", [])
            if s.get("decision") == "BUY_CANDIDATE" and s.get("ticker")
        )
        frozen_candidates = sorted(allocation.get("candidateTickers") or [])
        row_violations = []
        if execution.get("entry") != "NEXT_SESSION_OPEN_INSIDE_FROZEN_ENTRY_RANGE":
            row_violations.append("MISSING_FROZEN_ENTRY_POLICY")
        if execution.get("maxHoldingSessions") != 1:
            row_violations.append("MISSING_FROZEN_HOLDING_POLICY")
        if execution.get("sameSessionTargetStop") != "CONSERVATIVE_STOP_FIRST":
            row_violations.append("NON_CONSERVATIVE_AMBIGUITY_POLICY")
        if _finite(execution.get("transactionCostPct")) != float(transaction_cost_pct):
            row_violations.append("TRANSACTION_COST_POLICY_MISMATCH")
        if allocation.get("method") != "EQUAL_WEIGHT_BUY_CANDIDATES":
            row_violations.append("MISSING_FROZEN_ALLOCATION_POLICY")
        if candidates != frozen_candidates:
            row_violations.append("ALLOCATION_CANDIDATE_SET_MISMATCH")
        if source.get("requiredSession") != session or not source.get(
            "allSelectionsAligned"
        ):
            row_violations.append("FROZEN_SOURCE_SESSION_ALIGNMENT_NOT_PROVEN")
        if not lineage.get("explicitlyLinked"):
            row_violations.append("MODEL_LINEAGE_NOT_EXPLICITLY_LINKED")
        if entry.get("productionAuthority"):
            row_violations.append("UNEXPECTED_PRODUCTION_AUTHORITY")
        violations.extend(f"{signal_id}:{v}" for v in row_violations)
        checked.append(
            {
                "signalId": signal_id,
                "sessionDate": session,
                "candidateTickers": candidates,
                "passed": not row_violations,
                "violations": row_violations,
            }
        )
    return {
        "eligibleCohorts": len(eligible),
        "checked": checked,
        "violations": violations,
        "passed": bool(eligible) and not violations,
    }


def build_report(root=ROOT):
    policy = load_policy(root)
    v18_path = root / "data" / "v18" / "forward-ledger.json"
    v17_current_path = root / "data" / "v17" / "current.json"
    v17_ledger_path = root / "data" / "v17" / "ledger.json"
    current_path = root / "data" / "v18" / "current.json"

    ledger = json.loads(v18_path.read_text())
    if verify_ledger is not None and not verify_ledger(ledger):
        raise ValueError("INVALID_V18_FORWARD_LEDGER")
    v17_current = json.loads(v17_current_path.read_text())
    v17_ledger = json.loads(v17_ledger_path.read_text())
    current = json.loads(current_path.read_text()) if current_path.exists() else None

    transaction_cost_pct = float(
        policy.get("transactionCostPct", TRANSACTION_COST_PCT)
    )
    cohorts, shadow_members, promotion_members = evaluate_v18_shadow(
        root, ledger, transaction_cost_pct
    )
    shadow_metrics = aggregate_member_outcomes(shadow_members)
    promotion_metrics = aggregate_member_outcomes(promotion_members)
    observed_days = _observed_days(ledger.get("entries", []), cohorts)
    resolved_promotion_cohorts = sum(
        1 for c in cohorts if c.get("promotionResolved")
    )
    paired = _paired_status(ledger, v17_ledger, cohorts)
    alignment = _data_alignment(current, ledger)
    contract_gate = _promotion_contract_gate(ledger, transaction_cost_pct)
    reference = _extract_reference(v17_current)

    eg = policy.get("evidenceGate") or {}
    min_cohorts = int(eg.get("minimumResolvedCohorts", 30))
    min_members = int(eg.get("minimumResolvedMembers", 100))
    min_days = int(eg.get("minimumObservedCalendarDays", 90))
    evidence_gate = {
        "minimumResolvedCohorts": min_cohorts,
        "minimumResolvedMembers": min_members,
        "minimumObservedCalendarDays": min_days,
        "resolvedCohorts": resolved_promotion_cohorts,
        "resolvedMembers": promotion_metrics["resolvedMembers"],
        "observedCalendarDays": observed_days,
    }
    evidence_gate.update(
        {
            "cohortGatePassed": evidence_gate["resolvedCohorts"] >= min_cohorts,
            "memberGatePassed": evidence_gate["resolvedMembers"] >= min_members,
            "timeGatePassed": evidence_gate["observedCalendarDays"] >= min_days,
        }
    )
    evidence_gate["passed"] = all(
        evidence_gate[k]
        for k in ("cohortGatePassed", "memberGatePassed", "timeGatePassed")
    )

    pg = policy.get("pairedGate") or {}
    min_pairs = int(pg.get("minimumResolvedPairedCohorts", 30))
    paired_gate = {
        "minimumResolvedPairedCohorts": min_pairs,
        "resolvedPairedCohorts": paired["resolvedPairedCohorts"],
        "passed": paired["resolvedPairedCohorts"] >= min_pairs,
    }

    blockers = []
    if promotion_metrics["members"] == 0:
        blockers.append("NO_PROMOTION_ELIGIBLE_V18_SELECTIONS")
    elif not contract_gate["passed"]:
        blockers.append("PROMOTION_COHORT_CONTRACT_VIOLATION")
    if not evidence_gate["passed"]:
        blockers.append("INSUFFICIENT_NATIVE_FORWARD_EVIDENCE")
    if not paired_gate["passed"]:
        blockers.append("INSUFFICIENT_SAME_SESSION_CHAMPION_PAIRS")
    if any(e.get("productionAuthority") for e in ledger.get("entries", [])):
        blockers.append("UNEXPECTED_PRODUCTION_AUTHORITY_IN_RESEARCH_LEDGER")
    blockers = sorted(set(blockers))

    decision = "KEEP_RESEARCH" if blockers else "ELIGIBLE_FOR_PROMOTION_REVIEW"
    safety_invariants = {
        "researchOnly": True,
        "automaticPromotionDisabled": True,
        "productionActivationAllowed": False,
        "ledgerProductionAuthorityAllFalse": not any(
            e.get("productionAuthority") for e in ledger.get("entries", [])
        ),
        "mainBranchMutationAllowed": False,
    }
    return {
        "schemaVersion": "18.0.0-production-qualification-2",
        "engine": "V18",
        "mode": "PRODUCTION_QUALIFICATION",
        "decision": decision,
        "promotionReviewEligible": decision == "ELIGIBLE_FOR_PROMOTION_REVIEW",
        "promotionAllowed": False,
        "safetyInvariants": safety_invariants,
        "policy": policy,
        "methodology": {
            "promotionEvidence": "Only frozen BUY_CANDIDATE selections from cohorts whose portfolioDecision is not NO_TRADE can count toward promotion.",
            "shadowBenchmark": "All frozen top-five shadow selections are evaluated for diagnostics only; NO_TRADE cohorts cannot promote the engine.",
            "pairedComparator": "V16.9 control uses the same signal session where available. Outcome comparison waits for both sides to resolve.",
            "standardizedOutcome": f"Next-session open must be inside entry range; same-session target/stop ambiguity is treated as stop; {transaction_cost_pct:g}% transaction cost.",
            "gateParity": "Evidence minimums mirror the V17 native evidence gate: 30 resolved cohorts, 100 resolved members, 90 calendar days.",
            "activation": "Passing evidence gates only makes V18 eligible for an independent promotion review; it never grants production authority automatically.",
        },
        "v18": {
            "forwardCohorts": len(ledger.get("entries", [])),
            "shadowBenchmark": shadow_metrics,
            "promotionEvidence": promotion_metrics,
            "evidenceGate": evidence_gate,
            "contractGate": contract_gate,
            "dataAlignmentDiagnostic": alignment,
            "cohorts": cohorts,
        },
        "championChallenge": {
            "paired": paired,
            "pairedGate": paired_gate,
            "referenceEvidence": reference,
        },
        "blockers": blockers,
        "nextRequiredAction": (
            "COLLECT_NEXT_FROZEN_SESSION_WITH_EXPLICIT_V18_EXECUTION_POLICY"
            if blockers
            else "INDEPENDENT_PROMOTION_REVIEW"
        ),
    }


def main():
    report = build_report(ROOT)
    out = ROOT / "data" / "v18" / "production-qualification.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(
        json.dumps(
            {
                "artifact": str(out),
                "decision": report["decision"],
                "promotionReviewEligible": report["promotionReviewEligible"],
                "promotionAllowed": report["promotionAllowed"],
                "blockers": report["blockers"],
                "contractGate": report["v18"]["contractGate"],
                "evidenceGate": report["v18"]["evidenceGate"],
                "pairedGate": report["championChallenge"]["pairedGate"],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
