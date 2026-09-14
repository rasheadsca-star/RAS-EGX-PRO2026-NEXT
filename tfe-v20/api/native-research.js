const REPO = 'rasheadsca-star/RAS-EGX-PRO2026-NEXT';
const BRANCH = 'develop/v20-integrated-decision-platform';
const RAW = `https://raw.githubusercontent.com/${REPO}/${BRANCH}`;

async function getJson(path) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(`${RAW}/${path}`, {
      signal: controller.signal,
      headers: { 'user-agent': 'EGX-TFE-V20-NATIVE-RESEARCH' },
      cache: 'no-store',
    });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store, max-age=0');
  res.setHeader('x-egx-source', 'V20_NATIVE_RESEARCH');

  try {
    const requested = Number(req.query?.limit ?? 30);
    const limit = Number.isFinite(requested) ? Math.max(1, Math.min(30, Math.trunc(requested))) : 30;
    const [snapshot, freshness] = await Promise.all([
      getJson('data/v20/native-current.json'),
      getJson('data/v20/native-freshness-status.json').catch(() => null),
    ]);

    const all = Array.isArray(snapshot?.publishedCandidates) ? snapshot.publishedCandidates : [];
    const candidates = all.slice(0, limit).map((x) => ({
      rank: x.rank ?? null,
      ticker: x.ticker ?? null,
      nameAr: x.nameAr ?? null,
      nameEn: x.nameEn ?? null,
      sessionDate: x.sessionDate ?? snapshot?.sessionDate ?? null,
      price: x.price ?? null,
      nativeResearchScore: x.nativeResearchScore ?? null,
      nativeResearchTier: x.nativeResearchTier ?? null,
      discoveryScore: x.discoveryScore ?? null,
      liquidity2Score: x.liquidity2Score ?? null,
      srConfluenceScore: x.srConfluenceScore ?? null,
      srMethodCount: x.srMethodCount ?? null,
      technicalScore: x.technicalScore ?? null,
      netRiskReward: x.netRiskReward ?? null,
      entryLow: x.entryLow ?? x.tradePlan?.entryLow ?? null,
      entryHigh: x.entryHigh ?? x.tradePlan?.entryHigh ?? null,
      stop: x.stop ?? x.tradePlan?.stop ?? null,
      target1: x.target1 ?? x.tradePlan?.target1 ?? null,
      target2: x.target2 ?? x.tradePlan?.target2 ?? null,
      alignmentState: x.alignmentState ?? x.tradePlan?.alignmentState ?? null,
      entryDistancePct: x.entryDistancePct ?? x.tradePlan?.entryDistancePct ?? null,
      researchOnly: true,
      grantsExecutionPermission: false,
      grantsProductionAllocation: false,
    }));

    return res.status(200).json({
      ok: true,
      source: 'V20_NATIVE_RESEARCH',
      engine: snapshot?.engineId ?? 'V20_FULL_MARKET_NATIVE_SELECTION_V1',
      generatedAt: snapshot?.generatedAt ?? null,
      sessionDate: snapshot?.sessionDate ?? null,
      forNextTradingSession: freshness?.forNextTradingSession ?? null,
      freshnessStatus: freshness?.status ?? null,
      mode: 'RESEARCH_ONLY',
      authoritativeFor: snapshot?.authoritativeFor ?? 'FULL_MARKET_NATIVE_RESEARCH_RANKING',
      permissions: {
        researchOnly: true,
        executionAllowed: false,
        productionAllocation: false,
        automaticOrders: false,
        automaticPromotion: false,
      },
      summary: {
        universeCount: snapshot?.summary?.universeCount ?? null,
        nativeResearchRecommendationCount: snapshot?.summary?.nativeResearchRecommendationCount ?? null,
        publishedResearchCandidateCount: snapshot?.summary?.publishedResearchCandidateCount ?? all.length,
        returned: candidates.length,
      },
      candidates,
    });
  } catch (error) {
    console.error('[V20_NATIVE_RESEARCH_API]', error?.stack ?? error?.message ?? error);
    return res.status(503).json({
      ok: false,
      error: 'V20_NATIVE_RESEARCH_UNAVAILABLE',
      detail: error?.message ?? 'unknown error',
      mode: 'RESEARCH_ONLY',
    });
  }
}
