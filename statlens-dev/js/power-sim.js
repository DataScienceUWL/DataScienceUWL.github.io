// @ts-check
/**
 * Shared simulation engine for the power / decision-errors conceptual tools.
 *
 * Models the same known-σ one-sample z-test as `distribution/power/`:
 *   H0: μ = 0   vs   H1: μ = δ,   with X̄ ~ N(μ, σ/√n).
 *
 * Both the simple "Decision Errors" page and the fuller "Power Lab" page import
 * this module. The empirical reject-rate produced by repeatedly calling
 * {@link simulateStudy} + {@link isReject} converges to {@link analyticPower}.
 *
 * NOTE: callers must have initialised jStat via `setJStat()` (from
 * `js/distributions.js`) before using the analytic / p-value helpers, exactly as
 * the distribution calculator pages do.
 */

import { normalInv, normalCDF } from './distributions.js';
import { randNormal } from './prng.js';

/** @typedef {'left'|'right'|'both'} Tail */

/**
 * Critical value(s) on the x̄ scale under the null X̄ ~ N(0, se), se = σ/√n.
 * These depend only on α, n, σ, and the tail — not on the true effect — so the
 * same cutoffs decide both the "real effect" and "no effect" worlds.
 * @param {number} alpha
 * @param {number} n
 * @param {number} sigma
 * @param {Tail} tail
 * @returns {{ critLow: number, critHigh: number, se: number }}
 */
export function criticalValues(alpha, n, sigma, tail) {
  const se = sigma / Math.sqrt(n);
  let critLow = -Infinity;
  let critHigh = Infinity;
  if (tail === 'right') {
    critHigh = normalInv(1 - alpha, 0, se);
  } else if (tail === 'left') {
    critLow = normalInv(alpha, 0, se);
  } else {
    critLow = normalInv(alpha / 2, 0, se);
    critHigh = normalInv(1 - alpha / 2, 0, se);
  }
  return { critLow, critHigh, se };
}

/**
 * Analytic power (1−β) and the decision cutoffs, matching `distribution/power/`.
 * @param {{ alpha: number, n: number, delta: number, sigma: number }} p
 * @param {Tail} tail
 * @returns {{ power: number, beta: number, critLow: number, critHigh: number, se: number }}
 */
export function analyticPower(p, tail) {
  const { critLow, critHigh, se } = criticalValues(p.alpha, p.n, p.sigma, tail);
  const mu1 = p.delta; // μ1 = μ0 + δ, μ0 = 0
  let power;
  if (tail === 'right') {
    power = 1 - normalCDF(critHigh, mu1, se);
  } else if (tail === 'left') {
    power = normalCDF(critLow, mu1, se);
  } else {
    power = normalCDF(critLow, mu1, se) + (1 - normalCDF(critHigh, mu1, se));
  }
  return { power, beta: 1 - power, critLow, critHigh, se };
}

/**
 * Run one study: draw n observations ~ N(trueMu, σ), return the sample mean and
 * its z-statistic against μ0 = 0.
 * @param {() => number} rng
 * @param {number} trueMu  the real population mean (0 = no effect, δ = real effect)
 * @param {number} sigma
 * @param {number} n
 * @returns {{ xbar: number, z: number, se: number }}
 */
export function simulateStudy(rng, trueMu, sigma, n) {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += randNormal(trueMu, sigma, rng);
  const xbar = sum / n;
  const se = sigma / Math.sqrt(n);
  return { xbar, z: xbar / se, se };
}

/**
 * Does this sample mean fall in the rejection region?
 * @param {number} xbar
 * @param {number} critLow
 * @param {number} critHigh
 * @param {Tail} tail
 * @returns {boolean}
 */
export function isReject(xbar, critLow, critHigh, tail) {
  if (tail === 'right') return xbar >= critHigh;
  if (tail === 'left') return xbar <= critLow;
  return xbar <= critLow || xbar >= critHigh;
}

/**
 * Two- or one-sided p-value from a z-statistic (standard normal).
 * @param {number} z
 * @param {Tail} tail
 * @returns {number}
 */
export function pValue(z, tail) {
  if (tail === 'right') return 1 - normalCDF(z, 0, 1);
  if (tail === 'left') return normalCDF(z, 0, 1);
  return 2 * Math.min(normalCDF(z, 0, 1), 1 - normalCDF(z, 0, 1));
}
