'use strict';

const METRIC_ALIASES = Object.freeze({
  revenue: ['revenue', 'revenues', 'sales', 'net sales', 'الإيرادات', 'ايرادات', 'المبيعات', 'صافي المبيعات'],
  grossProfit: ['gross profit', 'مجمل الربح', 'إجمالي الربح'],
  operatingProfit: ['operating profit', 'operating income', 'الربح التشغيلي', 'أرباح التشغيل'],
  ebitda: ['ebitda', 'earnings before interest tax depreciation and amortization'],
  interestExpense: ['interest expense', 'finance expenses and interest', 'finance cost', 'مصروفات الفوائد', 'تكلفة التمويل'],
  profitBeforeTax: ['profit before tax', 'net profit before tax', 'الربح قبل الضريبة'],
  netProfit: ['net profit', 'net income', 'net profit after taxes', 'صافي الربح', 'صافي أرباح الفترة'],
  netIncomeAttributable: ['profit attributable to shareholders', 'net income attributable to shareholders', 'صافي الربح المنسوب لمساهمي الشركة'],
  eps: ['earnings per share', 'basic earnings per share', 'eps', 'نصيب السهم في الأرباح', 'ربحية السهم'],
  totalAssets: ['total assets', 'إجمالي الأصول', 'اجمالي الاصول'],
  currentAssets: ['total current assets', 'current assets', 'الأصول المتداولة'],
  cash: ['cash and cash equivalents', 'cash at banks and time deposits', 'النقدية وما في حكمها', 'النقدية'],
  inventory: ['inventories', 'inventory', 'المخزون'],
  receivables: ['trade and notes receivable', 'trade and other receivables', 'العملاء وأوراق القبض'],
  totalLiabilities: ['total liabilities', 'إجمالي الالتزامات', 'اجمالي الالتزامات'],
  currentLiabilities: ['total current liabilities', 'current liabilities', 'الالتزامات المتداولة'],
  shortTermDebt: ['short term debt', 'current loans', 'قروض قصيرة الأجل'],
  longTermDebt: ['long term debt', 'non-current loans', 'قروض طويلة الأجل'],
  totalDebt: ['total debt', 'إجمالي الدين', 'اجمالي القروض'],
  totalEquity: ['total equity', 'shareholders equity', 'حقوق الملكية', 'إجمالي حقوق الملكية'],
  operatingCashFlow: ['net cash flow provided from operating activities', 'net cash from operating activities', 'التدفقات النقدية من التشغيل', 'صافي التدفقات النقدية من أنشطة التشغيل'],
  capex: ['capital expenditure', 'payments for purchase of fixed assets', 'الإنفاق الرأسمالي', 'مدفوعات شراء أصول ثابتة'],
  sharesOutstanding: ['shares outstanding', 'number of listed shares', 'عدد الأسهم القائمة', 'عدد الأسهم'],
  dividendPerShare: ['dividend per share', 'توزيعات السهم', 'نصيب السهم في التوزيعات'],
});

function canonicalMetric(label) {
  const normalized = String(label || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const candidates = Object.entries(METRIC_ALIASES).flatMap(([metric, aliases]) => aliases.map(alias => ({ metric, alias: alias.toLowerCase() })))
    .filter(candidate => normalized === candidate.alias || normalized.includes(candidate.alias))
    .sort((a, b) => Number(normalized === b.alias) - Number(normalized === a.alias) || b.alias.length - a.alias.length);
  return candidates[0]?.metric || null;
}

module.exports = { METRIC_ALIASES, canonicalMetric };
