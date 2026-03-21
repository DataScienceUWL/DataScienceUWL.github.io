// @ts-check
/**
 * Simulation engine for StatLens.
 * Handles requestAnimationFrame batching, pause/resume, and prefers-reduced-motion.
 */

import { prefersReducedMotion } from './chart-utils.js';
import { quantile } from './stats.js';

/** Resamples per animation frame (~50 * 60fps = 3000/sec). */
const BATCH_SIZE = 50;

/**
 * @typedef {object} SimulationController
 * @property {() => void} pause
 * @property {() => void} resume
 * @property {() => boolean} isPaused
 */

/**
 * @typedef {object} SimulationResult
 * @property {number[]} stats - All computed statistics
 * @property {number} elapsed - Milliseconds elapsed
 */

/**
 * Run a simulation with animated progress updates.
 *
 * If prefers-reduced-motion is set, runs all iterations synchronously
 * and calls onComplete immediately.
 *
 * @param {object} config
 * @param {number} config.B - Number of iterations
 * @param {() => number} config.computeOne - Function that computes one statistic (uses rng internally)
 * @param {(stats: number[], i: number, B: number) => void} [config.onProgress] - Called each frame with current results
 * @param {(result: SimulationResult) => void} config.onComplete - Called when all iterations finish
 * @param {number} [config.batchSize=50] - Iterations per animation frame
 * @returns {SimulationController}
 */
export function runSimulation(config) {
  const {
    B,
    computeOne,
    onProgress,
    onComplete,
    batchSize = BATCH_SIZE,
  } = config;

  const stats = [];
  const startTime = performance.now();

  // Reduced motion: run synchronously
  if (prefersReducedMotion()) {
    for (let i = 0; i < B; i++) {
      stats.push(computeOne());
    }
    const elapsed = performance.now() - startTime;
    if (onProgress) onProgress(stats, B, B);
    onComplete({ stats, elapsed });
    return {
      pause() {},
      resume() {},
      isPaused() { return false; },
    };
  }

  // Animated: use requestAnimationFrame batching
  let i = 0;
  let paused = false;

  function frame() {
    if (paused) return;

    const end = Math.min(i + batchSize, B);
    while (i < end) {
      stats.push(computeOne());
      i++;
    }

    if (onProgress) onProgress(stats, i, B);

    if (i < B) {
      requestAnimationFrame(frame);
    } else {
      const elapsed = performance.now() - startTime;
      onComplete({ stats, elapsed });
    }
  }

  requestAnimationFrame(frame);

  return {
    pause() { paused = true; },
    resume() {
      if (paused) {
        paused = false;
        requestAnimationFrame(frame);
      }
    },
    isPaused() { return paused; },
  };
}

/**
 * Compute a bootstrap confidence interval from an array of bootstrap statistics.
 * Uses R type-7 interpolated quantiles (the standard percentile method).
 *
 * Note: For discrete data (proportions), CI bounds are constrained to
 * multiples of 1/n and may shift as more resamples are added. This is
 * inherent to the percentile method — more resamples (5000+) stabilize
 * the bounds.
 *
 * @param {number[]} bootStats - Array of bootstrap statistics
 * @param {number} ciLevel - Confidence level in percent (e.g., 95)
 * @returns {{ ci: [number, number], se: number }}
 */
export function bootstrapCI(bootStats, ciLevel) {
  const B = bootStats.length;
  const alpha = (100 - ciLevel) / 100;
  const lo = quantile(bootStats, alpha / 2);
  const hi = quantile(bootStats, 1 - alpha / 2);

  // Standard error
  const mean = bootStats.reduce((s, v) => s + v, 0) / B;
  const variance = bootStats.reduce((s, v) => s + (v - mean) ** 2, 0) / (B - 1);
  const se = Math.sqrt(variance);

  return { ci: [lo, hi], se };
}

/**
 * Compute a p-value from permutation test statistics.
 *
 * @param {number[]} permStats - Array of permutation statistics
 * @param {number} observedStat - Observed test statistic
 * @param {'left'|'right'|'both'} direction - Tail direction
 * @returns {{ pValue: number, extremeCount: number }}
 */
export function permutationPValue(permStats, observedStat, direction) {
  let extremeCount = 0;
  const B = permStats.length;

  for (const stat of permStats) {
    if (direction === 'right' && stat >= observedStat) {
      extremeCount++;
    } else if (direction === 'left' && stat <= observedStat) {
      extremeCount++;
    } else if (direction === 'both' && Math.abs(stat) >= Math.abs(observedStat)) {
      extremeCount++;
    }
  }

  return { pValue: extremeCount / B, extremeCount };
}
