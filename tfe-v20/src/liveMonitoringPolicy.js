export const EGX_LIVE_MONITORING_POLICY = Object.freeze({
  schemaVersion: 'egx.live-monitoring-policy.1',
  researchOnly: true,
  timezone: 'Africa/Cairo',
  tradingDays: Object.freeze(['SUN', 'MON', 'TUE', 'WED', 'THU']),
  sessionOpenLocal: '10:00',
  sessionCloseLocal: '14:30',
  pollIntervalMinutes: 10,
  refreshImmediatelyOnPageOpen: true,
  refreshImmediatelyOnSessionChange: true,
  skipDuplicateMarketTimestamp: true,
  appendOnlyLifecycleEvents: true,
  originalRecommendationImmutable: true,
  scoringImpact: 'NONE',
  alphaWeight: 0,
  productionAuthority: false,
});

export function shouldPollEgxNow({ dayCode, localTimeHHMM } = {}) {
  if (!EGX_LIVE_MONITORING_POLICY.tradingDays.includes(String(dayCode || '').toUpperCase())) return false;
  const t = String(localTimeHHMM || '');
  if (!/^\d{2}:\d{2}$/.test(t)) return false;
  return t >= EGX_LIVE_MONITORING_POLICY.sessionOpenLocal && t <= EGX_LIVE_MONITORING_POLICY.sessionCloseLocal;
}

export function nextPollDelayMs() {
  return EGX_LIVE_MONITORING_POLICY.pollIntervalMinutes * 60 * 1000;
}
