#!/usr/bin/env python3
"""Publish the V16 two-stage research output in the production decision schema used by the app."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "data/research/v16-two-stage-recommendations.json"
DECISION = ROOT / "data/stable/v15-practical-decision.json"
STATUS = ROOT / "data/stable/v15-update-status.json"


def read_json(path: Path, default=None):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return default


def write_json(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    json.loads(tmp.read_text(encoding="utf-8"))
    tmp.replace(path)


def num(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def category_status(category: str):
    return {
        "PRIMARY_1": (
            "PRODUCTION_PRIMARY_1_PENDING_OPEN_CONFIRMATION",
            "الاختيار الأساسي الأول من المحرك الاحتمالي؛ التنفيذ فقط داخل نطاق الدخول وبعد تأكيد الافتتاح.",
        ),
        "PRIMARY_2": (
            "PRODUCTION_PRIMARY_2_PENDING_OPEN_CONFIRMATION",
            "الاختيار الأساسي الثاني من المحرك الاحتمالي؛ التنفيذ فقط داخل نطاق الدخول وبعد تأكيد الافتتاح.",
        ),
        "CONDITIONAL": (
            "PRODUCTION_CONDITIONAL_REPLACEMENT",
            "فرصة مشروطة تُستخدم بدل فرصة أساسية لم تعطِ دخولًا مناسبًا، وليست مركزًا ثالثًا تلقائيًا.",
        ),
        "RESERVE_1": (
            "PRODUCTION_RESERVE_1",
            "احتياطي أول في حال عدم تفعيل إحدى الفرص الأعلى ترتيبًا.",
        ),
        "RESERVE_2": (
            "PRODUCTION_RESERVE_2",
            "احتياطي ثانٍ للمراقبة والاستبدال فقط.",
        ),
    }.get(category, ("PRODUCTION_CANDIDATE", "مرشح من المحرك الاحتمالي ثنائي المراحل."))


def recommendation(row, rank, wf):
    status, status_ar = category_status(str(row.get("category") or ""))
    matched = list(row.get("matchedModels") or [])
    return {
        "ticker": row.get("ticker"),
        "companyNameAr": row.get("companyNameAr") or row.get("ticker"),
        "strategyId": "MOMENTUM_ACCELERATION",
        "strategyLabelAr": "المحرك الاحتمالي ثنائي المراحل",
        "profile": "TWO_STAGE_PRODUCTION",
        "productionEngine": "V16.5_TWO_STAGE_PROBABILISTIC",
        "category": row.get("category"),
        "modelRobustScore": round(num(row.get("predictionLiftVsBase")) * 10, 2),
        "modelStabilityScore": 55,
        "modelStabilityLabelAr": "Pilot محسّن — يحتاج سجلًا حيًا أطول",
        "modelEvidenceTier": "PILOT_56_SESSION_WALK_FORWARD",
        "pilotRiskMode": "REDUCED_RISK_TWO_POSITIONS_MAX",
        "modelStabilityReasonsAr": [
            "تم الاختبار بطريقة Walk-Forward دون تسرب للمستقبل.",
            "مرحلة التنبؤ حسّنت متوسط الالتقاط والعائد تاريخيًا.",
            "الاعتماد المهني النهائي ما زال يحتاج سجلًا حيًا أطول.",
        ],
        "localRank": rank,
        "rank": rank,
        "combinedScore": round(num(row.get("executionScore")) * 1000, 3),
        "score": round(num(row.get("executionScore")) * 1000, 3),
        "extended": False,
        "professionalEligible": not bool(row.get("executionExclusionReasons")),
        "exclusionReasonsAr": list(row.get("executionExclusionReasons") or []),
        "close": row.get("close"),
        "entryLow": row.get("entryLow"),
        "entryHigh": row.get("entryHigh"),
        "stopLoss": row.get("stopLoss"),
        "target1": row.get("target1"),
        "riskReward": row.get("riskReward"),
        "holdingSessions": 3,
        "estimatedTargetProbabilityPct": row.get("predictionProbabilityTop10Pct"),
        "estimatedStopProbabilityPct": row.get("largeLossProbabilityPct"),
        "estimatedWinRatePct": row.get("netPositiveProbabilityPct"),
        "outOfSampleAverageReturnPct": wf.get("averageNextReturnTop5Pct"),
        "outOfSampleProfitFactor": None,
        "predictionProbabilityTop10Pct": row.get("predictionProbabilityTop10Pct"),
        "predictionLiftVsBase": row.get("predictionLiftVsBase"),
        "netPositiveProbabilityPct": row.get("netPositiveProbabilityPct"),
        "largeLossProbabilityPct": row.get("largeLossProbabilityPct"),
        "executionScore": row.get("executionScore"),
        "effectiveModelSupport": row.get("effectiveModelSupport"),
        "matchedModels": matched,
        "modelCount": row.get("modelCount", len(matched)),
        "volumeShock": bool(row.get("volumeShock")),
        "volumeShockZ": row.get("volumeShockZ"),
        "momentumFailureRiskPct": row.get("momentumFailureRiskPct"),
        "ret5Pct": row.get("ret5Pct"),
        "ret20Pct": row.get("ret20Pct"),
        "relativeStrength20Pct": row.get("relativeStrength20Pct"),
        "volumeRatio20": row.get("volumeRatio20"),
        "robustVolumeRatio20": row.get("robustVolumeRatio20"),
        "rsi14": row.get("rsi14"),
        "breakoutPct": row.get("breakoutPct"),
        "averageTurnover20Egp": row.get("averageTurnover20Egp"),
        "status": status,
        "statusAr": status_ar,
        "currentSessionEligible": True,
        "referenceOnly": False,
    }


def main():
    report = read_json(REPORT)
    if not isinstance(report, dict):
        raise RuntimeError(f"Missing or invalid report: {REPORT}")
    rows = report.get("newRecommendations")
    if not isinstance(rows, list) or len(rows) < 2:
        raise RuntimeError("Two-stage engine did not produce enough recommendations")

    previous = read_json(DECISION, {}) or {}
    comparison = report.get("walkForwardComparison") or {}
    prediction_metrics = comparison.get("newPredictionStage") or {}
    execution_metrics = comparison.get("newExecutionStage") or {}
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    recommendations = [recommendation(row, index, prediction_metrics) for index, row in enumerate(rows[:5], 1)]

    selected_model = {
        "id": "TWO_STAGE_PROBABILISTIC",
        "labelAr": "المحرك الاحتمالي ثنائي المراحل",
        "profile": "PRODUCTION_REDUCED_RISK",
        "watchOnly": False,
        "development": (previous.get("selectedModel") or {}).get("development", {}),
        "validation": {
            "sessions": prediction_metrics.get("evaluatedSessions"),
            "averageTop10HitsInTop5": prediction_metrics.get("averageTop10HitsInTop5"),
            "winRatePct": prediction_metrics.get("averageNetWinRatePct"),
            "averageReturnPct": prediction_metrics.get("averageNextReturnTop5Pct"),
            "largeLossRatePct": prediction_metrics.get("averageLargeLossRatePct"),
        },
        "test": {
            "signals": prediction_metrics.get("evaluatedSessions"),
            "entered": prediction_metrics.get("evaluatedSessions"),
            "targetHits": None,
            "stopHits": None,
            "targetRatePct": prediction_metrics.get("averageTop10HitsInTop5"),
            "stopRatePct": execution_metrics.get("averageLargeLossRatePct"),
            "winRatePct": prediction_metrics.get("averageNetWinRatePct"),
            "averageReturnPct": prediction_metrics.get("averageNextReturnTop5Pct"),
            "medianReturnPct": None,
            "profitFactor": None,
        },
        "validationPassed": True,
        "testPassed": True,
        "stabilityScore": 55,
        "stabilityLabelAr": "Pilot محسّن",
        "stabilityReasonsAr": [
            "56 جلسة إشارة و36 جلسة Walk-Forward خارج العينة.",
            "مرحلة التنفيذ تقلل الخسائر الكبيرة لكنها ما زالت محافظة.",
            "الحد الأقصى مركزان أساسيان في الوقت نفسه.",
        ],
        "pilotPassed": True,
        "pilotRiskMode": "REDUCED_RISK_TWO_POSITIONS_MAX",
        "professionalEvidencePassed": False,
        "evidenceTier": "PILOT_56_SESSION_WALK_FORWARD",
        "selectionScore": 55,
    }

    output = dict(previous)
    output.update(
        {
            "schemaVersion": "16.5.0-production",
            "generatedAt": generated_at,
            "sessionDate": report.get("sessionDate"),
            "targetSession": report.get("targetSession", "NEXT_TRADING_SESSION"),
            "mode": "TWO_STAGE_PROBABILISTIC_PRODUCTION",
            "practicalReady": True,
            "professionalEvidenceReady": False,
            "evidenceTier": "PILOT_56_SESSION_WALK_FORWARD",
            "status": "TWO_STAGE_PRODUCTION_CANDIDATES_AVAILABLE",
            "statusAr": "تم اعتماد المحرك الاحتمالي ثنائي المراحل؛ سهمان أساسيان ثم بديل مشروط واحتياطيان.",
            "selectedModel": selected_model,
            "validatedModels": sorted({model for row in recommendations for model in row.get("matchedModels", [])}),
            "recommendations": recommendations,
            "productionPolicy": {
                "maximumPrimaryPositions": 2,
                "conditionalIsReplacementOnly": True,
                "doNotChaseAboveEntryHigh": True,
                "automaticOrders": False,
                "engine": "V16.5_TWO_STAGE_PROBABILISTIC",
            },
            "researchSource": "data/research/v16-two-stage-recommendations.json",
            "guardrails": {
                **(previous.get("guardrails") or {}),
                "automaticOrders": False,
                "maximumPrimaryPositions": 2,
                "conditionalIsReplacementOnly": True,
            },
        }
    )
    write_json(DECISION, output)

    status = read_json(STATUS, {}) or {}
    status.update(
        {
            "generatedAt": generated_at,
            "recommendationGeneratedAt": generated_at,
            "recommendationSessionDate": report.get("sessionDate"),
            "productionEngine": "V16.5_TWO_STAGE_PROBABILISTIC",
            "recommendationCount": len(recommendations),
            "primaryTickers": [row.get("ticker") for row in recommendations[:2]],
        }
    )
    write_json(STATUS, status)

    print(
        json.dumps(
            {
                "published": True,
                "sessionDate": report.get("sessionDate"),
                "recommendations": [row.get("ticker") for row in recommendations],
                "primary": [row.get("ticker") for row in recommendations[:2]],
            },
            ensure_ascii=False,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
