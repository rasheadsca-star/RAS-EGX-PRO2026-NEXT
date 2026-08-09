# V17 Fundamental Analysis and Source Audit

## Current source decision

The V17 Historical Recovery module does not currently have a verified, lawful, stable, machine-readable source that supplies normalized financial statements for the full canonical EGX ordinary-equity universe.

- EGX disclosures are the preferred original company evidence. Individual disclosure documents may be used only after issuer identity, reporting period, currency, unit and publication date are verified. A stable public market-wide structured endpoint was not verified during this milestone.
- FRA publications are authoritative for regulatory rules, decisions and notices. They are not a normalized company-financial database.
- Company investor-relations statements are original evidence, but formats and publication channels vary by issuer.
- Yahoo Finance fundamentals are supplementary only. Coverage and endpoint stability are not sufficient to treat the service as authoritative financial-statement or corporate-action evidence for EGX.

The machine-readable audit is stored in `data/v17/historical-recovery/fundamentals/source-audit.json`. Current verified market-wide financial coverage is therefore zero. This is reported as `UNAVAILABLE`, never as a neutral score.

Authoritative references used to establish the disclosure hierarchy include the [Egyptian Exchange](https://www.egx.com.eg/) and the [Financial Regulatory Authority](https://fra.gov.eg/). FRA's listing rules and current decisions confirm that listed issuers have financial-statement and disclosure obligations, but that obligation does not itself create a uniform public data API.

## Input contract

Verified company inputs live only in `data/v17/historical-recovery/fundamentals/verified-input.json`. Every company record must contain:

- exact ticker and company identity;
- sector model;
- annual or quarterly reporting periods;
- period end and publication date;
- currency and unit;
- source URL or official reference;
- retrieval timestamp and confidence;
- explicit missing fields.

Currency conversion is accepted only with an explicit conversion rate and retained source currency. Units are expanded deterministically. Missing values are never fabricated.

## Transparent scoring

For non-financial companies, the quality score is computed only when at least four sufficiently populated components are available:

| Component | Weight |
|---|---:|
| Profitability | 25% |
| Growth | 20% |
| Balance-sheet strength | 20% |
| Cash-flow quality | 20% |
| Earnings stability | 15% |

Each component retains its contributing metrics, raw values and metric scores. Banks use ROE, ROA, capital adequacy, non-performing loans, equity growth and earnings stability; industrial Debt/EBITDA-style assumptions are not applied to banks. Separate model identifiers are supported for banks, non-bank financial services, real estate, industrials, petrochemicals, consumer, healthcare, technology/services and holding companies.

## Financial risk and valuation

Financial risk is independent of investment classification. Evidence includes recurring losses, persistent negative operating cash flow, leverage, weak liquidity, declining equity, poor interest coverage, stale statements and low source confidence.

Valuation is sector-aware. A score is emitted only when at least two supported valuation measures exist. Otherwise the status is `VALUATION_DATA_INSUFFICIENT` and the score is `null`.

## Value-trap policy

Historical decline never adds fundamental-quality points. Value-trap evidence includes falling revenue, recurring losses, persistent negative operating cash flow, rising debt, deteriorating equity, severe financial risk, weak quality combined with apparently cheap valuation, and unresolved material negative events. A high value-trap classification blocks a positive integrated classification.
