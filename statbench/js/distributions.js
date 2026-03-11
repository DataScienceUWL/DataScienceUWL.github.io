// @ts-check

/**
 * Distribution functions module — thin wrappers around jStat.
 *
 * In the browser, jStat is loaded via importmap from CDN.
 * In Node (vitest), jStat is loaded from the npm package.
 *
 * @module distributions
 */

/** @type {any} */
let jStat;

/**
 * Initialize jStat. Must be called before using distribution functions.
 * In browser context, pass the jStat object from the importmap.
 * In Node/test context, auto-imports from the npm package.
 * @param {any} [jStatInstance] - jStat object (optional, auto-detected in Node)
 */
export async function initDistributions(jStatInstance) {
    if (jStatInstance) {
        jStat = jStatInstance;
    } else {
        const mod = await import('jstat');
        jStat = mod.default || mod;
    }
}

/**
 * Set jStat synchronously (for browser use with importmap).
 * @param {any} jStatInstance
 */
export function setJStat(jStatInstance) {
    jStat = jStatInstance;
}

/**
 * @returns {any} The jStat instance
 */
function _j() {
    if (!jStat) throw new Error('distributions.js: call initDistributions() first');
    return jStat;
}

// ── Normal ──────────────────────────────────────────────────────────

/**
 * Normal CDF: P(X <= x) for X ~ N(mu, sigma^2).
 * @param {number} x
 * @param {number} [mu=0]
 * @param {number} [sigma=1]
 * @returns {number}
 */
export function normalCDF(x, mu = 0, sigma = 1) {
    if (sigma <= 0) return NaN;
    return _j().normal.cdf(x, mu, sigma);
}

/**
 * Normal inverse CDF (quantile function).
 * @param {number} p - Probability in [0, 1]
 * @param {number} [mu=0]
 * @param {number} [sigma=1]
 * @returns {number}
 */
export function normalInv(p, mu = 0, sigma = 1) {
    if (sigma <= 0) return NaN;
    if (p < 0 || p > 1) return NaN;
    return _j().normal.inv(p, mu, sigma);
}

/**
 * Normal PDF: density at x.
 * @param {number} x
 * @param {number} [mu=0]
 * @param {number} [sigma=1]
 * @returns {number}
 */
export function pdfNormal(x, mu = 0, sigma = 1) {
    if (sigma <= 0) return NaN;
    return _j().normal.pdf(x, mu, sigma);
}

// ── Student's t ─────────────────────────────────────────────────────

/**
 * Student's t CDF: P(T <= t) for T ~ t(df).
 * @param {number} t
 * @param {number} df
 * @returns {number}
 */
export function tCDF(t, df) {
    if (df <= 0) return NaN;
    return _j().studentt.cdf(t, df);
}

/**
 * Student's t inverse CDF.
 * @param {number} p
 * @param {number} df
 * @returns {number}
 */
export function tInv(p, df) {
    if (df <= 0) return NaN;
    if (p < 0 || p > 1) return NaN;
    return _j().studentt.inv(p, df);
}

/**
 * Student's t PDF.
 * @param {number} t
 * @param {number} df
 * @returns {number}
 */
export function pdfT(t, df) {
    if (df <= 0) return NaN;
    return _j().studentt.pdf(t, df);
}

// ── Chi-square ──────────────────────────────────────────────────────

/**
 * Chi-square CDF: P(X <= x) for X ~ chi-sq(df).
 * @param {number} x
 * @param {number} df
 * @returns {number}
 */
export function chisqCDF(x, df) {
    if (df <= 0) return NaN;
    if (x < 0) return 0;
    return _j().chisquare.cdf(x, df);
}

/**
 * Chi-square inverse CDF.
 * @param {number} p
 * @param {number} df
 * @returns {number}
 */
export function chisqInv(p, df) {
    if (df <= 0) return NaN;
    if (p < 0 || p > 1) return NaN;
    return _j().chisquare.inv(p, df);
}

/**
 * Chi-square PDF.
 * @param {number} x
 * @param {number} df
 * @returns {number}
 */
export function pdfChisq(x, df) {
    if (df <= 0) return NaN;
    return _j().chisquare.pdf(x, df);
}

// ── F distribution ──────────────────────────────────────────────────

/**
 * F-distribution CDF: P(X <= x) for X ~ F(df1, df2).
 * @param {number} x
 * @param {number} df1
 * @param {number} df2
 * @returns {number}
 */
export function fCDF(x, df1, df2) {
    if (df1 <= 0 || df2 <= 0) return NaN;
    if (x < 0) return 0;
    return _j().centralF.cdf(x, df1, df2);
}

/**
 * F-distribution inverse CDF.
 * @param {number} p
 * @param {number} df1
 * @param {number} df2
 * @returns {number}
 */
export function fInv(p, df1, df2) {
    if (df1 <= 0 || df2 <= 0) return NaN;
    if (p < 0 || p > 1) return NaN;
    return _j().centralF.inv(p, df1, df2);
}

/**
 * F-distribution PDF.
 * @param {number} x
 * @param {number} df1
 * @param {number} df2
 * @returns {number}
 */
export function pdfF(x, df1, df2) {
    if (df1 <= 0 || df2 <= 0) return NaN;
    return _j().centralF.pdf(x, df1, df2);
}
