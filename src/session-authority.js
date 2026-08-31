export function validateExchangeCalendar(calendar) {
  if (!calendar?.version || !Array.isArray(calendar.sessions)) throw new Error('INVALID_EXCHANGE_CALENDAR');
  let prev='';
  for (const s of calendar.sessions) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s.session) || !s.closeAt) throw new Error('INVALID_EXCHANGE_CALENDAR_SESSION');
    const t=Date.parse(s.closeAt); if (!Number.isFinite(t)) throw new Error('INVALID_EXCHANGE_CALENDAR_CLOSE');
    if (s.session <= prev) throw new Error('NON_MONOTONIC_EXCHANGE_CALENDAR'); prev=s.session;
  }
  return true;
}
export function latestCompletedSession(calendar, now=new Date()) {
  validateExchangeCalendar(calendar);
  const n=now instanceof Date?now:new Date(now);
  if (!Number.isFinite(n.getTime())) throw new Error('INVALID_NOW');
  const completed=calendar.sessions.filter(s=>Date.parse(s.closeAt)<=n.getTime());
  return completed.at(-1)?.session ?? null;
}
export function assessSessionDataAvailability({calendar,now,availableSessions}) {
  const expectedSession=latestCompletedSession(calendar,now);
  if (!expectedSession) return {engineState:'DATA_NOT_READY',expectedSession:null,latestVerifiedSession:null,reason:'NO_COMPLETED_SESSION'};
  const set=new Set(availableSessions||[]);
  if (!set.has(expectedSession)) {
    const latest=[...set].filter(s=>s<=expectedSession).sort().at(-1)??null;
    return {engineState:'DATA_NOT_READY',expectedSession,latestVerifiedSession:latest,reason:'LATEST_SESSION_DATA_MISSING'};
  }
  return {engineState:'READY_FOR_DATA_VALIDATION',expectedSession,latestVerifiedSession:expectedSession,reason:null};
}
