// @ts-check

/**
 * Descriptive statistics module.
 * All functions match R defaults (sd uses n-1, quantile uses type=7).
 * @module stats
 */

import { shuffle, sampleWithReplacement } from './prng.js';

/**
 * Arithmetic mean.
 * @param {number[]} arr
 * @returns {number} Mean, or NaN if arr is empty
 */
export function mean(arr) {
    if (arr.length === 0) return NaN;
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s / arr.length;
}

/**
 * Sum of array elements.
 * @param {number[]} arr
 * @returns {number} Sum, or 0 if arr is empty
 */
export function sum(arr) {
    let s = 0;
    for (let i = 0; i < arr.length; i++) s += arr[i];
    return s;
}

/**
 * Sample variance (n-1 denominator).
 * @param {number[]} arr
 * @returns {number} Variance, or NaN if arr.length < 2
 */
export function variance(arr) {
    if (arr.length < 2) return NaN;
    const m = mean(arr);
    let ss = 0;
    for (let i = 0; i < arr.length; i++) {
        const d = arr[i] - m;
        ss += d * d;
    }
    return ss / (arr.length - 1);
}

/**
 * Sample standard deviation (n-1 denominator).
 * @param {number[]} arr
 * @returns {number} SD, or NaN if arr.length < 2
 */
export function sd(arr) {
    return Math.sqrt(variance(arr));
}

/**
 * Median (average of middle two for even-length arrays).
 * @param {number[]} arr
 * @returns {number} Median, or NaN if arr is empty
 */
export function median(arr) {
    if (arr.length === 0) return NaN;
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = sorted.length >> 1;
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Quantile using R's type=7 algorithm.
 * @param {number[]} arr
 * @param {number} p - Probability in [0, 1]
 * @returns {number}
 * @throws {RangeError} If p < 0 or p > 1
 */
export function quantile(arr, p) {
    if (p < 0 || p > 1) throw new RangeError('p must be in [0, 1]');
    if (arr.length === 0) return NaN;
    const sorted = arr.slice().sort((a, b) => a - b);
    const n = sorted.length;
    if (n === 1) return sorted[0];
    const h = (n - 1) * p;
    const j = Math.floor(h);
    const frac = h - j;
    if (j + 1 >= n) return sorted[n - 1];
    return sorted[j] + frac * (sorted[j + 1] - sorted[j]);
}

/**
 * Interquartile range (Q3 - Q1, using type=7 quantiles).
 * @param {number[]} arr
 * @returns {number}
 */
export function iqr(arr) {
    return quantile(arr, 0.75) - quantile(arr, 0.25);
}

/**
 * Tukey's five-number summary: min, lower hinge, median, upper hinge, max.
 * Matches R fivenum().
 * @param {number[]} arr
 * @returns {[number, number, number, number, number]}
 */
export function fivenum(arr) {
    if (arr.length === 0) return /** @type {any} */ ([NaN, NaN, NaN, NaN, NaN]);
    const sorted = arr.slice().sort((a, b) => a - b);
    const n = sorted.length;
    const med = _medianSorted(sorted, 0, n - 1);

    // Lower hinge: median of lower half
    // Upper hinge: median of upper half
    // R fivenum includes the median in both halves for odd n
    const m = Math.floor((n - 1) / 2);
    const lowerEnd = n % 2 ? m : m;
    const upperStart = n % 2 ? m : m + 1;

    const lowerHinge = _medianSorted(sorted, 0, lowerEnd);
    const upperHinge = _medianSorted(sorted, upperStart, n - 1);

    return [sorted[0], lowerHinge, med, upperHinge, sorted[n - 1]];
}

/**
 * Median of a sorted array slice [lo..hi] inclusive.
 * @param {number[]} sorted
 * @param {number} lo
 * @param {number} hi
 * @returns {number}
 */
function _medianSorted(sorted, lo, hi) {
    const len = hi - lo + 1;
    const mid = lo + (len >> 1);
    return len % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Range: [min, max].
 * @param {number[]} arr
 * @returns {[number, number]}
 */
export function range(arr) {
    if (arr.length === 0) return /** @type {any} */ ([NaN, NaN]);
    let lo = arr[0], hi = arr[0];
    for (let i = 1; i < arr.length; i++) {
        if (arr[i] < lo) lo = arr[i];
        if (arr[i] > hi) hi = arr[i];
    }
    return [lo, hi];
}

/**
 * Pearson correlation coefficient.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {number} r in [-1, 1], or NaN if either has sd=0
 * @throws {RangeError} If x.length !== y.length or length < 2
 */
export function cor(x, y) {
    if (x.length !== y.length) throw new RangeError('Arrays must have same length');
    if (x.length < 2) throw new RangeError('Need at least 2 observations');
    const mx = mean(x);
    const my = mean(y);
    let num = 0, dx2 = 0, dy2 = 0;
    for (let i = 0; i < x.length; i++) {
        const dx = x[i] - mx;
        const dy = y[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    const denom = Math.sqrt(dx2 * dy2);
    if (denom === 0) return NaN;
    return num / denom;
}

/**
 * Simple linear regression (ordinary least squares).
 * @param {number[]} x - Predictor values
 * @param {number[]} y - Response values
 * @returns {import('./types.js').LinregResult}
 * @throws {RangeError} If x.length !== y.length or length < 2
 */
export function linreg(x, y) {
    if (x.length !== y.length) throw new RangeError('Arrays must have same length');
    const n = x.length;
    if (n < 2) throw new RangeError('Need at least 2 observations');

    const mx = mean(x);
    const my = mean(y);
    let ssxy = 0, ssxx = 0;
    for (let i = 0; i < n; i++) {
        const dx = x[i] - mx;
        ssxy += dx * (y[i] - my);
        ssxx += dx * dx;
    }

    const slope = ssxx === 0 ? NaN : ssxy / ssxx;
    const intercept = my - slope * mx;
    const r = cor(x, y);
    const r2 = r * r;

    const fitted = x.map(xi => intercept + slope * xi);
    const residuals = y.map((yi, i) => yi - fitted[i]);
    const sse = residuals.reduce((s, e) => s + e * e, 0);
    const se_slope = n > 2 ? Math.sqrt(sse / (n - 2) / ssxx) : NaN;
    const t_slope = se_slope === 0 || isNaN(se_slope) ? NaN : slope / se_slope;

    // p-value for slope (two-tailed) — requires t-distribution
    // We compute this using the incomplete beta function relationship
    // For now, leave as NaN since distributions.js isn't loaded here
    const p_slope = n > 2 ? _tPValue(t_slope, n - 2) : NaN;

    return { slope, intercept, r, r2, se_slope, t_slope, p_slope, residuals, fitted };
}

/**
 * Approximate two-tailed p-value for t-statistic.
 * Uses the regularized incomplete beta function.
 * @param {number} t - t-statistic
 * @param {number} df - degrees of freedom
 * @returns {number}
 */
function _tPValue(t, df) {
    if (!isFinite(t) || !isFinite(df) || df <= 0) return NaN;
    const x = df / (df + t * t);
    return _betaRegularized(x, df / 2, 0.5);
}

/**
 * Regularized incomplete beta function I_x(a, b) via continued fraction.
 * @param {number} x
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function _betaRegularized(x, a, b) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    const lnBeta = _lnGamma(a) + _lnGamma(b) - _lnGamma(a + b);
    const front = Math.exp(Math.log(x) * a + Math.log(1 - x) * b - lnBeta);
    if (x < (a + 1) / (a + b + 2)) {
        return front * _betaCF(x, a, b) / a;
    }
    return 1 - front * _betaCF(1 - x, b, a) / b;
}

/**
 * Continued fraction for incomplete beta function.
 * @param {number} x
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
function _betaCF(x, a, b) {
    const maxIter = 200;
    const eps = 1e-14;
    let m2, aa, del;
    let qab = a + b;
    let qap = a + 1;
    let qam = a - 1;
    let c = 1;
    let d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    d = 1 / d;
    let h = d;
    for (let m = 1; m <= maxIter; m++) {
        m2 = 2 * m;
        aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + aa / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d;
        h *= d * c;
        aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1 + aa * d;
        if (Math.abs(d) < 1e-30) d = 1e-30;
        c = 1 + aa / c;
        if (Math.abs(c) < 1e-30) c = 1e-30;
        d = 1 / d;
        del = d * c;
        h *= del;
        if (Math.abs(del - 1) < eps) break;
    }
    return h;
}

/**
 * Log-gamma function (Lanczos approximation).
 * @param {number} x
 * @returns {number}
 */
function _lnGamma(x) {
    const g = 7;
    const c = [
        0.99999999999980993, 676.5203681218851, -1259.1392167224028,
        771.32342877765313, -176.61502916214059, 12.507343278686905,
        -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (x < 0.5) {
        return Math.log(Math.PI / Math.sin(Math.PI * x)) - _lnGamma(1 - x);
    }
    x -= 1;
    let a = c[0];
    const t = x + g + 0.5;
    for (let i = 1; i < g + 2; i++) {
        a += c[i] / (x + i);
    }
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/**
 * Compute proportions for each category.
 * @param {string[]} arr
 * @returns {Object<string, number>}
 */
export function proportions(arr) {
    if (arr.length === 0) return {};
    /** @type {Object<string, number>} */
    const counts = {};
    for (const v of arr) {
        counts[v] = (counts[v] || 0) + 1;
    }
    const n = arr.length;
    /** @type {Object<string, number>} */
    const result = {};
    for (const k of Object.keys(counts)) {
        result[k] = counts[k] / n;
    }
    return result;
}

/**
 * Chi-square test statistic from a contingency table.
 * @param {number[][]} observed - 2D array of observed counts
 * @returns {number}
 */
export function chisqStat(observed) {
    const nrows = observed.length;
    if (nrows === 0) return NaN;
    const ncols = observed[0].length;
    if (ncols === 0) return NaN;

    const rowSums = observed.map(row => row.reduce((a, b) => a + b, 0));
    const colSums = new Array(ncols).fill(0);
    for (let i = 0; i < nrows; i++) {
        for (let j = 0; j < ncols; j++) {
            colSums[j] += observed[i][j];
        }
    }
    const total = rowSums.reduce((a, b) => a + b, 0);
    if (total === 0) return NaN;

    let stat = 0;
    for (let i = 0; i < nrows; i++) {
        for (let j = 0; j < ncols; j++) {
            const expected = (rowSums[i] * colSums[j]) / total;
            if (expected === 0) continue;
            stat += (observed[i][j] - expected) ** 2 / expected;
        }
    }
    return stat;
}

/**
 * F-statistic for one-way ANOVA.
 * @param {number[][]} groups - Array of numeric arrays, one per group
 * @returns {number}
 */
export function fStat(groups) {
    if (groups.length < 2) return NaN;
    const k = groups.length;
    const allValues = groups.flat();
    const N = allValues.length;
    if (N <= k) return NaN;

    const grandMean = mean(allValues);

    let ssBetween = 0;
    let ssWithin = 0;
    for (const g of groups) {
        if (g.length === 0) return NaN;
        const gm = mean(g);
        ssBetween += g.length * (gm - grandMean) ** 2;
        for (const v of g) {
            ssWithin += (v - gm) ** 2;
        }
    }

    const dfBetween = k - 1;
    const dfWithin = N - k;
    if (dfWithin === 0) return NaN;

    return (ssBetween / dfBetween) / (ssWithin / dfWithin);
}

/**
 * Bootstrap resample: sample with replacement from arr (same size as arr).
 * @param {number[]|string[]} arr
 * @param {() => number} rng
 * @returns {number[]|string[]}
 */
export function resample(arr, rng) {
    return /** @type {any} */ (sampleWithReplacement(arr, arr.length, rng));
}

/**
 * Permutation step: shuffle combined array and split at n1.
 * @param {Array<*>} arr1
 * @param {Array<*>} arr2
 * @param {() => number} rng
 * @returns {[Array<*>, Array<*>]}
 */
export function permute(arr1, arr2, rng) {
    const combined = arr1.concat(arr2);
    shuffle(combined, rng);
    return [combined.slice(0, arr1.length), combined.slice(arr1.length)];
}

// ─── Display formatting ──────────────────────────────────────────────

/**
 * Detect the maximum decimal places present in source data.
 * Returns 0 for integer data, 1 for one-decimal data, etc.
 * @param {number[]} values
 * @returns {number}
 */
export function detectPrecision(values) {
    let maxDec = 0;
    for (const v of values) {
        if (!isFinite(v)) continue;
        const s = String(v);
        const dot = s.indexOf('.');
        if (dot >= 0) {
            const dec = s.length - dot - 1;
            if (dec > maxDec) maxDec = dec;
        }
    }
    return maxDec;
}

/**
 * Format a statistic for display using the "one more digit than source" rule.
 *
 * Convention:
 * - 'stat' (default): d + 1 decimals (mean, median, SD, IQR, quartiles, etc.)
 * - 'variance': d + 2 decimals
 * - 'proportion': max(d + 1, 3) decimals (p-hat, proportions in tables)
 * - 'correlation': 3 decimals (r, R²)
 * - 'pvalue': 4 decimals, or "< 0.0001" when tiny
 * - 'count': integer (no decimals)
 * - 'percent': 1 decimal + "%" suffix
 *
 * @param {number} value
 * @param {number} d - Decimal places in source data (from detectPrecision)
 * @param {'stat'|'variance'|'proportion'|'correlation'|'pvalue'|'count'|'percent'} [type='stat']
 * @returns {string}
 */
export function formatStat(value, d, type = 'stat') {
    if (!isFinite(value)) return '\u2014';
    switch (type) {
        case 'variance':
            return value.toFixed(d + 2);
        case 'proportion':
            return value.toFixed(Math.max(d + 1, 3));
        case 'correlation':
            return value.toFixed(3);
        case 'pvalue':
            if (value === 0) return 'p \u2248 0';
            if (value < 0.0001) return 'p < 0.0001';
            return value.toFixed(4);
        case 'count':
            return String(Math.round(value));
        case 'percent':
            return value.toFixed(1) + '%';
        default:
            return value.toFixed(d + 1);
    }
}

/**
 * LOESS (locally weighted scatterplot smoothing).
 * For each evaluation point, fits a weighted linear regression using a tricube kernel.
 *
 * @param {number[]} xValues - Predictor values
 * @param {number[]} yValues - Response values
 * @param {object} [options]
 * @param {number} [options.span] - Proportion of data used per local fit (default: 0.75)
 * @param {number} [options.numPoints] - Number of evaluation points to return (default: 100)
 * @returns {Array<{x: number, y: number}>} Smoothed curve points, sorted by x
 */
export function loess(xValues, yValues, options = {}) {
    const { span = 0.75, numPoints = 100 } = options;
    const n = Math.min(xValues.length, yValues.length);
    if (n < 3) return [];

    // Sort by x for evaluation grid
    const idx = Array.from({ length: n }, (_, i) => i).sort((a, b) => xValues[a] - xValues[b]);
    const xs = idx.map(i => xValues[i]);
    const ys = idx.map(i => yValues[i]);

    const xMin = xs[0];
    const xMax = xs[n - 1];
    if (xMin === xMax) return [];

    const k = Math.max(3, Math.ceil(span * n)); // number of neighbors

    /** Tricube kernel weight */
    function tricube(d) {
        if (d >= 1) return 0;
        const t = 1 - d * d * d;
        return t * t * t;
    }

    const result = [];
    for (let p = 0; p < numPoints; p++) {
        const xEval = xMin + (xMax - xMin) * p / (numPoints - 1);

        // Find distances and k nearest neighbors
        const dists = xs.map(xi => Math.abs(xi - xEval));
        const sortedDists = [...dists].sort((a, b) => a - b);
        const maxDist = sortedDists[k - 1] || sortedDists[sortedDists.length - 1];
        const h = Math.max(maxDist, 1e-10);

        // Weighted linear regression: minimize Σ wᵢ(yᵢ - a - b·xᵢ)²
        let sw = 0, swx = 0, swy = 0, swxx = 0, swxy = 0;
        for (let i = 0; i < n; i++) {
            const w = tricube(dists[i] / h);
            if (w === 0) continue;
            sw += w;
            swx += w * xs[i];
            swy += w * ys[i];
            swxx += w * xs[i] * xs[i];
            swxy += w * xs[i] * ys[i];
        }

        if (sw === 0) continue;

        const det = sw * swxx - swx * swx;
        if (Math.abs(det) < 1e-12) {
            result.push({ x: xEval, y: swy / sw }); // fallback: weighted mean
        } else {
            const b = (sw * swxy - swx * swy) / det;
            const a = (swy - b * swx) / sw;
            result.push({ x: xEval, y: a + b * xEval });
        }
    }

    return result;
}
