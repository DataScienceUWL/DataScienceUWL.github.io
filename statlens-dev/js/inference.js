// @ts-check
/**
 * Shared inference computations for StatLens.
 * Provides test statistics, p-values, and confidence intervals
 * for all parametric inference pages.
 *
 * Requires distributions.js to be initialized first (jStat loaded).
 */

import { normalCDF, normalInv, tCDF, tInv, chisqCDF, fCDF, pdfT, pdfNormal, pdfChisq } from './distributions.js';
import { mean, sd } from './stats.js';

// ── One-sample t ─────────────────────────────────────────────────────

/**
 * @typedef {object} OneMeanResult
 * @property {number} xbar - Sample mean
 * @property {number} s - Sample standard deviation
 * @property {number} n - Sample size
 * @property {number} se - Standard error (s / sqrt(n))
 * @property {number} tStat - t test statistic
 * @property {number} df - Degrees of freedom (n - 1)
 * @property {number} pValue - p-value for the given alternative
 * @property {number} ciLower - CI lower bound
 * @property {number} ciUpper - CI upper bound
 * @property {string} alternative - 'less' | 'greater' | 'two-sided'
 * @property {number} mu0 - Null hypothesis mean
 * @property {number} confLevel - Confidence level
 */

/**
 * One-sample t-test and confidence interval.
 * @param {number[]} data - Sample values
 * @param {object} options
 * @param {number} [options.mu0=0] - Null hypothesis mean
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95] - Confidence level
 * @returns {OneMeanResult}
 */
export function oneMeanT(data, options = {}) {
  const mu0 = options.mu0 ?? 0;
  const alternative = options.alternative ?? 'two-sided';
  const confLevel = options.confLevel ?? 0.95;

  const n = data.length;
  const xbar = mean(data);
  const s = sd(data);
  const se = s / Math.sqrt(n);
  const tStat = (xbar - mu0) / se;
  const df = n - 1;

  let pValue;
  if (alternative === 'less') {
    pValue = tCDF(tStat, df);
  } else if (alternative === 'greater') {
    pValue = 1 - tCDF(tStat, df);
  } else {
    pValue = 2 * (1 - tCDF(Math.abs(tStat), df));
  }

  const alpha = 1 - confLevel;
  const tCrit = tInv(1 - alpha / 2, df);
  const ciLower = xbar - tCrit * se;
  const ciUpper = xbar + tCrit * se;

  return { xbar, s, n, se, tStat, df, pValue, ciLower, ciUpper, alternative, mu0, confLevel };
}

/**
 * One-sample t-test from summary statistics.
 * @param {number} xbar - Sample mean
 * @param {number} s - Sample standard deviation
 * @param {number} n - Sample size
 * @param {object} options
 * @param {number} [options.mu0=0]
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @returns {OneMeanResult}
 */
export function oneMeanTSummary(xbar, s, n, options = {}) {
  const mu0 = options.mu0 ?? 0;
  const alternative = options.alternative ?? 'two-sided';
  const confLevel = options.confLevel ?? 0.95;

  const se = s / Math.sqrt(n);
  const tStat = (xbar - mu0) / se;
  const df = n - 1;

  let pValue;
  if (alternative === 'less') {
    pValue = tCDF(tStat, df);
  } else if (alternative === 'greater') {
    pValue = 1 - tCDF(tStat, df);
  } else {
    pValue = 2 * (1 - tCDF(Math.abs(tStat), df));
  }

  const alpha = 1 - confLevel;
  const tCrit = tInv(1 - alpha / 2, df);
  const ciLower = xbar - tCrit * se;
  const ciUpper = xbar + tCrit * se;

  return { xbar, s, n, se, tStat, df, pValue, ciLower, ciUpper, alternative, mu0, confLevel };
}

// ── One-proportion z ─────────────────────────────────────────────────

/**
 * @typedef {object} OnePropResult
 * @property {number} pHat - Sample proportion
 * @property {number} n - Sample size
 * @property {number} successes - Number of successes
 * @property {number} se - Standard error (for CI: sqrt(pHat*(1-pHat)/n))
 * @property {number} seNull - Standard error under null (sqrt(p0*(1-p0)/n))
 * @property {number} zStat - z test statistic
 * @property {number} pValue - p-value
 * @property {number} ciLower - CI lower bound (Wald)
 * @property {number} ciUpper - CI upper bound (Wald)
 * @property {string} alternative
 * @property {number} p0 - Null hypothesis proportion
 * @property {number} confLevel
 */

/**
 * One-proportion z-test and confidence interval.
 * Test uses null SE; CI uses Wald (sample SE).
 * @param {number} successes
 * @param {number} n
 * @param {object} options
 * @param {number} [options.p0=0.5] - Null hypothesis proportion
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @returns {OnePropResult}
 */
export function onePropZ(successes, n, options = {}) {
  const p0 = options.p0 ?? 0.5;
  const alternative = options.alternative ?? 'two-sided';
  const confLevel = options.confLevel ?? 0.95;

  const pHat = successes / n;
  const seNull = Math.sqrt(p0 * (1 - p0) / n);
  const se = Math.sqrt(pHat * (1 - pHat) / n);
  const zStat = (pHat - p0) / seNull;

  let pValue;
  if (alternative === 'less') {
    pValue = normalCDF(zStat);
  } else if (alternative === 'greater') {
    pValue = 1 - normalCDF(zStat);
  } else {
    pValue = 2 * (1 - normalCDF(Math.abs(zStat)));
  }

  const alpha = 1 - confLevel;
  const zCrit = normalInv(1 - alpha / 2);
  const ciLower = pHat - zCrit * se;
  const ciUpper = pHat + zCrit * se;

  return { pHat, n, successes, se, seNull, zStat, pValue, ciLower, ciUpper, alternative, p0, confLevel };
}

// ── Two-sample t ─────────────────────────────────────────────────────

/**
 * @typedef {object} TwoMeanResult
 * @property {number} xbar1 - Group 1 mean
 * @property {number} xbar2 - Group 2 mean
 * @property {number} s1 - Group 1 SD
 * @property {number} s2 - Group 2 SD
 * @property {number} n1 - Group 1 size
 * @property {number} n2 - Group 2 size
 * @property {number} diff - xbar1 - xbar2
 * @property {number} se - Standard error of difference
 * @property {number} tStat - t test statistic
 * @property {number} df - Welch degrees of freedom
 * @property {number} pValue
 * @property {number} ciLower
 * @property {number} ciUpper
 * @property {string} alternative
 * @property {number} confLevel
 */

/**
 * Two-sample t-test and CI (Welch's, unequal variances).
 * @param {number[]} group1
 * @param {number[]} group2
 * @param {object} options
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @param {number} [options.nullDiff=0] - Null hypothesis difference (μ₁ − μ₂ = nullDiff)
 * @returns {TwoMeanResult}
 */
export function twoMeanT(group1, group2, options = {}) {
  const alternative = options.alternative ?? 'two-sided';
  const confLevel = options.confLevel ?? 0.95;
  const nullDiff = options.nullDiff ?? 0;

  const n1 = group1.length, n2 = group2.length;
  const xbar1 = mean(group1), xbar2 = mean(group2);
  const s1 = sd(group1), s2 = sd(group2);
  const diff = xbar1 - xbar2;
  const v1 = s1 * s1 / n1, v2 = s2 * s2 / n2;
  const se = Math.sqrt(v1 + v2);
  const tStat = (diff - nullDiff) / se;

  // Welch-Satterthwaite degrees of freedom
  const df = (v1 + v2) ** 2 / (v1 * v1 / (n1 - 1) + v2 * v2 / (n2 - 1));

  let pValue;
  if (alternative === 'less') {
    pValue = tCDF(tStat, df);
  } else if (alternative === 'greater') {
    pValue = 1 - tCDF(tStat, df);
  } else {
    pValue = 2 * (1 - tCDF(Math.abs(tStat), df));
  }

  const alpha = 1 - confLevel;
  const tCrit = tInv(1 - alpha / 2, df);
  const ciLower = diff - tCrit * se;
  const ciUpper = diff + tCrit * se;

  return { xbar1, xbar2, s1, s2, n1, n2, diff, se, tStat, df, pValue, ciLower, ciUpper, alternative, confLevel };
}

/**
 * Two-sample Welch t-test from summary statistics.
 * @param {number} xbar1 @param {number} s1 @param {number} n1
 * @param {number} xbar2 @param {number} s2 @param {number} n2
 * @param {object} options
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @returns {import('./inference.js').TwoMeanResult}
 */
export function twoMeanTSummary(xbar1, s1, n1, xbar2, s2, n2, options = {}) {
  const alternative = options.alternative ?? 'two-sided';
  const confLevel = options.confLevel ?? 0.95;
  const nullDiff = options.nullDiff ?? 0;

  const diff = xbar1 - xbar2;
  const v1 = s1 * s1 / n1, v2 = s2 * s2 / n2;
  const se = Math.sqrt(v1 + v2);
  const tStat = (diff - nullDiff) / se;

  const df = (v1 + v2) ** 2 / (v1 * v1 / (n1 - 1) + v2 * v2 / (n2 - 1));

  let pValue;
  if (alternative === 'less') {
    pValue = tCDF(tStat, df);
  } else if (alternative === 'greater') {
    pValue = 1 - tCDF(tStat, df);
  } else {
    pValue = 2 * (1 - tCDF(Math.abs(tStat), df));
  }

  const alpha = 1 - confLevel;
  const tCrit = tInv(1 - alpha / 2, df);
  const ciLower = diff - tCrit * se;
  const ciUpper = diff + tCrit * se;

  return { xbar1, xbar2, s1, s2, n1, n2, diff, se, tStat, df, pValue, ciLower, ciUpper, alternative, confLevel };
}

// ── Paired t ─────────────────────────────────────────────────────────

/**
 * @typedef {object} PairedResult
 * @property {number} dbar - Mean of differences
 * @property {number} sd - SD of differences
 * @property {number} n - Number of pairs
 * @property {number} se - Standard error
 * @property {number} tStat
 * @property {number} df
 * @property {number} pValue
 * @property {number} ciLower
 * @property {number} ciUpper
 * @property {string} alternative
 * @property {number} confLevel
 */

/**
 * Paired t-test and CI.
 * @param {number[]} diffs - Paired differences
 * @param {object} options
 * @param {number} [options.mu0=0] - Null hypothesis mean difference
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @returns {PairedResult}
 */
export function pairedT(diffs, options = {}) {
  const result = oneMeanT(diffs, { mu0: options.mu0 ?? 0, alternative: options.alternative, confLevel: options.confLevel });
  return {
    dbar: result.xbar,
    sd: result.s,
    n: result.n,
    se: result.se,
    tStat: result.tStat,
    df: result.df,
    pValue: result.pValue,
    ciLower: result.ciLower,
    ciUpper: result.ciUpper,
    alternative: result.alternative,
    confLevel: result.confLevel,
  };
}

/**
 * Paired t-test from summary statistics of the differences.
 * @param {number} dbar - Mean of differences
 * @param {number} sdVal - SD of differences
 * @param {number} n - Number of pairs
 * @param {object} options
 * @param {number} [options.mu0=0]
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @returns {PairedResult}
 */
export function pairedTSummary(dbar, sdVal, n, options = {}) {
  const result = oneMeanTSummary(dbar, sdVal, n, { mu0: options.mu0 ?? 0, alternative: options.alternative, confLevel: options.confLevel });
  return {
    dbar: result.xbar,
    sd: result.s,
    n: result.n,
    se: result.se,
    tStat: result.tStat,
    df: result.df,
    pValue: result.pValue,
    ciLower: result.ciLower,
    ciUpper: result.ciUpper,
    alternative: result.alternative,
    confLevel: result.confLevel,
  };
}

// ── Two-proportion z ─────────────────────────────────────────────────

/**
 * @typedef {object} TwoPropResult
 * @property {number} pHat1
 * @property {number} pHat2
 * @property {number} n1
 * @property {number} n2
 * @property {number} diff - pHat1 - pHat2
 * @property {number} pooledP - Pooled proportion (for test)
 * @property {number} sePooled - SE under null (pooled)
 * @property {number} se - SE for CI (unpooled)
 * @property {number} zStat
 * @property {number} pValue
 * @property {number} ciLower
 * @property {number} ciUpper
 * @property {string} alternative
 * @property {number} confLevel
 */

/**
 * Two-proportion z-test and CI.
 * Test uses pooled SE; CI uses unpooled SE.
 * @param {number} x1 - Successes in group 1
 * @param {number} n1 - Size of group 1
 * @param {number} x2 - Successes in group 2
 * @param {number} n2 - Size of group 2
 * @param {object} options
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @param {number} [options.nullDiff=0] - Null hypothesis difference (p₁ − p₂ = nullDiff)
 * @returns {TwoPropResult}
 */
export function twoPropZ(x1, n1, x2, n2, options = {}) {
  const alternative = options.alternative ?? 'two-sided';
  const confLevel = options.confLevel ?? 0.95;
  const nullDiff = options.nullDiff ?? 0;

  const pHat1 = x1 / n1, pHat2 = x2 / n2;
  const diff = pHat1 - pHat2;
  const pooledP = (x1 + x2) / (n1 + n2);
  const sePooled = Math.sqrt(pooledP * (1 - pooledP) * (1 / n1 + 1 / n2));
  const se = Math.sqrt(pHat1 * (1 - pHat1) / n1 + pHat2 * (1 - pHat2) / n2);
  const zStat = (diff - nullDiff) / sePooled;

  let pValue;
  if (alternative === 'less') {
    pValue = normalCDF(zStat);
  } else if (alternative === 'greater') {
    pValue = 1 - normalCDF(zStat);
  } else {
    pValue = 2 * (1 - normalCDF(Math.abs(zStat)));
  }

  const alpha = 1 - confLevel;
  const zCrit = normalInv(1 - alpha / 2);
  const ciLower = diff - zCrit * se;
  const ciUpper = diff + zCrit * se;

  return { pHat1, pHat2, n1, n2, diff, pooledP, sePooled, se, zStat, pValue, ciLower, ciUpper, alternative, confLevel };
}

// ── Chi-square test ──────────────────────────────────────────────────

/**
 * @typedef {object} ChisqResult
 * @property {number} chiSq - Chi-square statistic
 * @property {number} df - Degrees of freedom
 * @property {number} pValue - p-value (always right-tail)
 * @property {number[][]} observed - Observed counts
 * @property {number[][]} expected - Expected counts
 * @property {string[]} rowLabels
 * @property {string[]} colLabels
 */

/**
 * Chi-square test of independence.
 * @param {number[][]} observed - 2D array of observed counts [row][col]
 * @param {string[]} rowLabels
 * @param {string[]} colLabels
 * @returns {ChisqResult}
 */
export function chisqTest(observed, rowLabels, colLabels) {
  const nRows = observed.length;
  const nCols = observed[0].length;

  const rowTotals = observed.map(row => row.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: nCols }, (_, j) =>
    observed.reduce((sum, row) => sum + row[j], 0));
  const total = rowTotals.reduce((a, b) => a + b, 0);

  const expected = observed.map((row, i) =>
    row.map((_, j) => rowTotals[i] * colTotals[j] / total));

  let chiSq = 0;
  for (let i = 0; i < nRows; i++) {
    for (let j = 0; j < nCols; j++) {
      const diff = observed[i][j] - expected[i][j];
      chiSq += diff * diff / expected[i][j];
    }
  }

  const df = (nRows - 1) * (nCols - 1);
  const pValue = 1 - chisqCDF(chiSq, df);

  return { chiSq, df, pValue, observed, expected, rowLabels, colLabels };
}

// ── Regression t ─────────────────────────────────────────────────────

/**
 * @typedef {object} SlopeResult
 * @property {number} slope
 * @property {number} intercept
 * @property {number} se - Standard error of slope
 * @property {number} tStat
 * @property {number} df
 * @property {number} pValue
 * @property {number} ciLower
 * @property {number} ciUpper
 * @property {number} r - Correlation
 * @property {number} rSquared
 * @property {number} n
 * @property {string} alternative
 * @property {number} confLevel
 */

/**
 * t-test and CI for regression slope.
 * @param {number[]} x
 * @param {number[]} y
 * @param {object} options
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @returns {SlopeResult}
 */
export function slopeT(x, y, options = {}) {
  const alternative = options.alternative ?? 'two-sided';
  const confLevel = options.confLevel ?? 0.95;

  const n = x.length;
  const xbar = mean(x), ybar = mean(y);
  const sxx = x.reduce((s, xi) => s + (xi - xbar) ** 2, 0);
  const sxy = x.reduce((s, xi, i) => s + (xi - xbar) * (y[i] - ybar), 0);
  const syy = y.reduce((s, yi) => s + (yi - ybar) ** 2, 0);

  const slope = sxy / sxx;
  const intercept = ybar - slope * xbar;

  // Residual standard error
  const sse = syy - slope * sxy;
  const df = n - 2;
  const mse = sse / df;
  const se = Math.sqrt(mse / sxx);

  const tStat = slope / se;

  let pValue;
  if (alternative === 'less') {
    pValue = tCDF(tStat, df);
  } else if (alternative === 'greater') {
    pValue = 1 - tCDF(tStat, df);
  } else {
    pValue = 2 * (1 - tCDF(Math.abs(tStat), df));
  }

  const alpha = 1 - confLevel;
  const tCrit = tInv(1 - alpha / 2, df);
  const ciLower = slope - tCrit * se;
  const ciUpper = slope + tCrit * se;

  const r = sxy / Math.sqrt(sxx * syy);
  const rSquared = r * r;

  return { slope, intercept, se, tStat, df, pValue, ciLower, ciUpper, r, rSquared, n, alternative, confLevel };
}

/**
 * Regression slope t-test from summary statistics.
 * @param {number} slope - Estimated slope (b₁)
 * @param {number} se - Standard error of slope
 * @param {number} n - Sample size
 * @param {object} options
 * @param {'less'|'greater'|'two-sided'} [options.alternative='two-sided']
 * @param {number} [options.confLevel=0.95]
 * @returns {SlopeResult}
 */
export function slopeTSummary(slope, se, n, options = {}) {
  const alternative = options.alternative ?? 'two-sided';
  const confLevel = options.confLevel ?? 0.95;

  const df = n - 2;
  const tStat = slope / se;

  let pValue;
  if (alternative === 'less') {
    pValue = tCDF(tStat, df);
  } else if (alternative === 'greater') {
    pValue = 1 - tCDF(tStat, df);
  } else {
    pValue = 2 * (1 - tCDF(Math.abs(tStat), df));
  }

  const alpha = 1 - confLevel;
  const tCrit = tInv(1 - alpha / 2, df);
  const ciLower = slope - tCrit * se;
  const ciUpper = slope + tCrit * se;

  // Can't compute intercept, r, rSquared from summary stats alone
  return { slope, intercept: NaN, se, tStat, df, pValue, ciLower, ciUpper, r: NaN, rSquared: NaN, n, alternative, confLevel };
}

// ── One-way ANOVA ───────────────────────────────────────────────────

/**
 * @typedef {object} AnovaResult
 * @property {number} fStat - F test statistic
 * @property {number} dfBetween - Between-group df (k - 1)
 * @property {number} dfWithin - Within-group df (N - k)
 * @property {number} pValue - Right-tail p-value: P(F >= fStat)
 * @property {number} ssBetween - Sum of squares between groups
 * @property {number} ssWithin - Sum of squares within groups
 * @property {number} ssTotal - Total sum of squares
 * @property {number} msBetween - Mean square between
 * @property {number} msWithin - Mean square within
 * @property {number[]} groupMeans - Mean for each group
 * @property {number[]} groupSDs - SD for each group
 * @property {number[]} groupNs - Sample size for each group
 * @property {string[]} groupNames - Group labels
 * @property {number} grandMean - Overall mean
 */

/**
 * One-way ANOVA F-test from raw grouped data.
 * @param {number[][]} groups - Array of numeric arrays, one per group
 * @param {string[]} groupNames - Labels for each group
 * @returns {AnovaResult}
 */
export function anovaF(groups, groupNames) {
  const k = groups.length;
  const groupNs = groups.map(g => g.length);
  const N = groupNs.reduce((a, b) => a + b, 0);
  const groupMeans = groups.map(g => mean(g));
  const groupSDs = groups.map(g => g.length > 1 ? sd(g) : 0);
  const grandMean = mean(groups.flat());

  let ssBetween = 0;
  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    ssBetween += groupNs[i] * (groupMeans[i] - grandMean) ** 2;
    for (const v of groups[i]) {
      ssWithin += (v - groupMeans[i]) ** 2;
    }
  }

  const ssTotal = ssBetween + ssWithin;
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = dfWithin > 0 ? ssWithin / dfWithin : NaN;
  const fStat = msWithin > 0 ? msBetween / msWithin : NaN;
  const pValue = isFinite(fStat) ? 1 - fCDF(fStat, dfBetween, dfWithin) : NaN;

  return {
    fStat, dfBetween, dfWithin, pValue,
    ssBetween, ssWithin, ssTotal, msBetween, msWithin,
    groupMeans, groupSDs, groupNs, groupNames, grandMean,
  };
}

/**
 * One-way ANOVA F-test from summary statistics.
 * @param {number[]} means - Group means
 * @param {number[]} sds - Group standard deviations
 * @param {number[]} ns - Group sample sizes
 * @param {string[]} groupNames - Group labels
 * @returns {AnovaResult}
 */
export function anovaFSummary(means, sds, ns, groupNames) {
  const k = means.length;
  const N = ns.reduce((a, b) => a + b, 0);
  const grandMean = ns.reduce((sum, n, i) => sum + n * means[i], 0) / N;

  let ssBetween = 0;
  let ssWithin = 0;
  for (let i = 0; i < k; i++) {
    ssBetween += ns[i] * (means[i] - grandMean) ** 2;
    ssWithin += (ns[i] - 1) * sds[i] ** 2;
  }

  const ssTotal = ssBetween + ssWithin;
  const dfBetween = k - 1;
  const dfWithin = N - k;
  const msBetween = ssBetween / dfBetween;
  const msWithin = dfWithin > 0 ? ssWithin / dfWithin : NaN;
  const fStat = msWithin > 0 ? msBetween / msWithin : NaN;
  const pValue = isFinite(fStat) ? 1 - fCDF(fStat, dfBetween, dfWithin) : NaN;

  return {
    fStat, dfBetween, dfWithin, pValue,
    ssBetween, ssWithin, ssTotal, msBetween, msWithin,
    groupMeans: [...means], groupSDs: [...sds], groupNs: [...ns],
    groupNames: [...groupNames], grandMean,
  };
}
