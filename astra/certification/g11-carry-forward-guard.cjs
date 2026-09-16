'use strict';

const UNSAFE_RULES = Object.freeze([
  {
    id: 'EXECUTABLE_CARRY_FORWARD_HELPER',
    description: 'Executable helper call that copies or promotes an older session into the current session.',
    regex: /\b(?:carryForward|copyPrevious|labelPreviousAsCurrent|synthesizeCurrent|usePreviousAsCurrent|fallbackToPreviousSession|promotePreviousAsCurrent)\s*\(/gi,
  },
  {
    id: 'CARRY_FORWARD_CONFIG_ENABLED',
    description: 'Configuration explicitly enables carry-forward or previous-as-current behavior.',
    regex: /\b(?:carryForward|allowCarryForward|usePreviousAsCurrent|promotePrevious(?:Price|Volume|Turnover)AsCurrent)\s*:\s*true\b/gi,
  },
  {
    id: 'PREVIOUS_VALUE_DIRECTLY_PROMOTED_AS_CURRENT',
    description: 'A current OHLC/price/volume/turnover field is assigned directly from a previous session/row.',
    regex: /\b(?:current(?:Open|High|Low|Close|Price|Volume|Turnover)|open|high|low|close|price|volume|turnover)\s*[:=]\s*(?:prev|previous)(?:Session|Row)?\s*(?:\?\.|\.)\s*(?:open|high|low|close|price|volume|turnover)\b/gi,
  },
  {
    id: 'PREVIOUS_VALUE_USED_AS_CURRENT_FALLBACK',
    description: 'A current OHLC/price/volume/turnover field falls back to an older session value.',
    regex: /\b(?:current(?:Open|High|Low|Close|Price|Volume|Turnover)|open|high|low|close|price|volume|turnover)\s*[:=][^,\n;}]{0,180}(?:\?\?|\|\|)\s*(?:prev|previous)(?:Session|Row)?\s*(?:\?\.|\.)\s*(?:open|high|low|close|price|volume|turnover)\b/gi,
  },
  {
    id: 'SYNTHETIC_CURRENT_ROW_FROM_PREVIOUS_SESSION',
    description: 'A row labelled as the expected/current session is constructed from previous-session market values.',
    regex: /\b(?:date|sessionDate)\s*:\s*(?:expected|expectedSession|currentSession)\b[\s\S]{0,500}?\b(?:open|high|low|close|price|volume|turnover)\s*:\s*(?:prev|previous)(?:Session|Row)?\s*(?:\?\.|\.)\s*(?:open|high|low|close|price|volume|turnover)\b/gi,
  },
]);

function stripComments(source) {
  const input = String(source || '');
  let out = '';
  let state = 'code';
  let escaped = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    const next = input[i + 1];
    if (state === 'line-comment') {
      if (ch === '\n') { out += ch; state = 'code'; }
      else out += ' ';
      continue;
    }
    if (state === 'block-comment') {
      if (ch === '*' && next === '/') { out += '  '; i += 1; state = 'code'; }
      else out += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'single' || state === 'double' || state === 'template') {
      out += ch;
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"') || (state === 'template' && ch === '`')) state = 'code';
      continue;
    }
    if (ch === '/' && next === '/') { out += '  '; i += 1; state = 'line-comment'; continue; }
    if (ch === '/' && next === '*') { out += '  '; i += 1; state = 'block-comment'; continue; }
    if (ch === "'") state = 'single';
    else if (ch === '"') state = 'double';
    else if (ch === '`') state = 'template';
    out += ch;
  }
  return out;
}

function contextFor(source, index, length) {
  const start = Math.max(0, index - 80);
  const end = Math.min(source.length, index + length + 120);
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

function analyzeCarryForwardSource(source) {
  const cleaned = stripComments(source);
  const findings = [];
  for (const rule of UNSAFE_RULES) {
    const regex = new RegExp(rule.regex.source, rule.regex.flags);
    let match;
    while ((match = regex.exec(cleaned)) !== null) {
      findings.push({
        ruleId: rule.id,
        description: rule.description,
        match: match[0],
        index: match.index,
        context: contextFor(cleaned, match.index, match[0].length),
      });
      if (match[0].length === 0) regex.lastIndex += 1;
    }
  }
  return findings;
}

const SELF_TEST_FIXTURES = Object.freeze([
  {
    id: 'SAFE_EXPLICIT_FORBIDDEN_POLICY',
    expectedUnsafe: false,
    source: "const sourcePolicy = { carryForwardForbidden: true, noCarryForward: true };",
  },
  {
    id: 'UNSAFE_EXECUTABLE_CARRY_FORWARD',
    expectedUnsafe: true,
    source: "const current = carryForward(previousRow, expectedSession);",
  },
  {
    id: 'SAFE_PROHIBITION_DOCUMENTATION',
    expectedUnsafe: false,
    source: "// carry forward is forbidden\nconst note = 'carry forward is forbidden';",
  },
  {
    id: 'UNSAFE_PREVIOUS_PRICE_PROMOTED_CURRENT',
    expectedUnsafe: true,
    source: "function buildCurrent(previousSession) { return { sessionDate: expectedSession, close: previousSession.close, volume: previousSession.volume }; }",
  },
]);

function runGuardSelfTests() {
  const cases = SELF_TEST_FIXTURES.map((fixture) => {
    const findings = analyzeCarryForwardSource(fixture.source);
    const observedUnsafe = findings.length > 0;
    return {
      id: fixture.id,
      expectedUnsafe: fixture.expectedUnsafe,
      observedUnsafe,
      pass: observedUnsafe === fixture.expectedUnsafe,
      findings,
    };
  });
  return {
    total: cases.length,
    passed: cases.filter((x) => x.pass).length,
    failed: cases.filter((x) => !x.pass).length,
    cases,
  };
}

module.exports = {
  UNSAFE_RULES,
  SELF_TEST_FIXTURES,
  stripComments,
  analyzeCarryForwardSource,
  runGuardSelfTests,
};
