// @ts-check
/**
 * Centralized chart configuration for StatLens.
 *
 * Single source of truth for thresholds, precision, bin counts, domain padding,
 * chart type selection, and the unified renderSimChart() function.
 * Every page imports from here instead of making independent decisions.
 */

import * as d3Scale from 'd3-scale';
import { drawHistogram, computeBins, snappedPropThresholds } from './histogram.js';
import { drawDotplot } from './dotplot.js';
import { renderSimPills } from './chart-utils.js';
import { formatStat } from './stats.js';
import { wrapWithStepper } from './page-utils.js';

// ─── Constants (single source of truth) ─────────────────────────────

/** Max simulations before auto-switching from dotplot to histogram. */
export const DOTPLOT_AUTO_THRESHOLD = 1000;

/** Default max bins for dotplots. */
export const DOTPLOT_MAX_BINS = 40;

/** Default max bins for histograms (Sturges' cap). */
export const HIST_MAX_BINS = 50;

/** Min bins for bin adjuster. */
export const BIN_MIN = 3;

/** Domain padding ratio for chart axes. */
export const DOMAIN_PADDING = 0.05;

// ─── Chart type ─────────────────────────────────────────────────────

/**
 * Determine the active chart type, resolving 'auto'.
 * @param {number} n - Number of data points / simulated stats
 * @param {string} userChoice - 'auto', 'dotplot', 'histogram', or 'spike'
 * @returns {'dotplot'|'histogram'|'spike'}
 */
export function resolveChartType(n, userChoice) {
  if (userChoice && userChoice !== 'auto') return /** @type {any} */ (userChoice);
  return n <= DOTPLOT_AUTO_THRESHOLD ? 'dotplot' : 'histogram';
}

// ─── Bin counts ─────────────────────────────────────────────────────

/**
 * Compute the number of bins for a dotplot.
 * For proportions, uses sampleN so bin centers align with possible k/n values.
 * @param {number} n - Number of data points
 * @param {object} [opts]
 * @param {boolean} [opts.proportion] - Is the statistic a proportion?
 * @param {number} [opts.sampleN] - Original sample size (for proportion alignment)
 * @param {number} [opts.userBins] - User-specified bin count override
 * @returns {number}
 */
export function dotplotBins(n, opts = {}) {
  if (opts.userBins != null) return opts.userBins;
  if (opts.proportion && opts.sampleN) return opts.sampleN;
  return Math.min(n, DOTPLOT_MAX_BINS);
}

/**
 * Compute thresholds for a histogram.
 * For proportions, snaps to k/n grid so bars align with possible values.
 * @param {object} opts
 * @param {boolean} [opts.proportion]
 * @param {number} [opts.sampleN]
 * @param {[number,number]} [opts.domain]
 * @param {number} [opts.dataLength]
 * @returns {number[]|undefined}
 */
export function histogramThresholds(opts = {}) {
  if (opts.proportion && opts.sampleN && opts.domain && opts.dataLength) {
    return snappedPropThresholds(opts.sampleN, opts.domain, opts.dataLength);
  }
  return undefined;
}

// ─── Precision ──────────────────────────────────────────────────────

/**
 * Determine display precision for chart labels and stat values.
 * @param {number} dataPrecision - Precision detected from source data
 * @param {object} [opts]
 * @param {boolean} [opts.proportion]
 * @param {number} [opts.sampleN]
 * @returns {number}
 */
export function displayPrecision(dataPrecision, opts = {}) {
  if (opts.proportion && opts.sampleN) {
    return Math.max(3, String(opts.sampleN).length);
  }
  return dataPrecision;
}

// ─── Domain ─────────────────────────────────────────────────────────

/**
 * Compute a padded domain for chart axes.
 * @param {number[]} values
 * @param {object} [opts]
 * @param {number} [opts.padding] - Padding ratio (default DOMAIN_PADDING)
 * @param {number} [opts.includeValue] - Extra value to include (e.g. observed stat)
 * @param {boolean} [opts.startAtZero] - Force domain to start at 0 (for chi-sq, proportions)
 * @returns {[number, number]}
 */
export function computeDomain(values, opts = {}) {
  const padding = opts.padding ?? DOMAIN_PADDING;
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (opts.includeValue != null) {
    lo = Math.min(lo, opts.includeValue);
    hi = Math.max(hi, opts.includeValue);
  }
  const range = hi - lo || 1;
  const pad = range * padding;
  lo = opts.startAtZero ? 0 : lo - pad;
  hi = hi + pad;
  return [lo, hi];
}

// ─── Extreme / region predicates ────────────────────────────────────

/**
 * Check if a value is in the extreme tail relative to an observed statistic.
 * Used by randomization tests.
 * @param {number} v - Simulated value
 * @param {number} observed - Observed test statistic
 * @param {'left'|'right'|'both'} direction
 * @param {number} [nullCenter] - Center of null distribution (for 'both' direction)
 * @returns {boolean}
 */
export function isExtreme(v, observed, direction, nullCenter) {
  if (direction === 'left') return v <= observed;
  if (direction === 'both') {
    const c = nullCenter ?? 0;
    return Math.abs(v - c) >= Math.abs(observed - c);
  }
  return v >= observed;
}

// ─── Chart type toggle ──────────────────────────────────────────────

/**
 * Create and insert a chart type toggle (segmented control) before a container element.
 * Returns the element and a function to get/set the current chart type.
 *
 * @param {HTMLElement} container - The chart container element
 * @param {object} opts
 * @param {Array<[string, string]>} [opts.types] - [value, label] pairs
 * @param {string} [opts.initial] - Initial chart type ('auto' resolves on render)
 * @param {(chartType: string) => void} opts.onChange - Called when user changes chart type
 * @returns {{ fieldset: HTMLElement, setSelected: (type: string) => void }}
 */
export function createChartToggle(container, opts) {
  const types = opts.types ?? [['dotplot', 'Dotplot'], ['histogram', 'Histogram']];
  const initial = opts.initial ?? 'dotplot';

  const seg = document.createElement('div');
  seg.className = 'seg-control chart-type-toggle';
  seg.setAttribute('role', 'group');
  seg.setAttribute('aria-label', 'Chart type');

  /** @type {Map<string, HTMLButtonElement>} */
  const btnMap = new Map();
  for (const [value, label] of types) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.dataset.value = value;
    btn.setAttribute('aria-pressed', String(value === initial));
    btn.addEventListener('click', () => {
      setSelected(value);
      opts.onChange(value);
    });
    seg.appendChild(btn);
    btnMap.set(value, btn);
  }

  const parent = container.parentElement;
  if (parent) parent.insertBefore(seg, container);

  function setSelected(type) {
    for (const [v, btn] of btnMap) {
      btn.setAttribute('aria-pressed', String(v === type));
    }
  }

  return { fieldset: seg, setSelected };
}

// ─── Bin adjuster ───────────────────────────────────────────────────

/**
 * @typedef {object} BinAdjusterControl
 * @property {HTMLLabelElement} element - The label element
 * @property {(mode: 'dotplot'|'histogram') => void} setMode - Update label text for chart type
 * @property {(value: number) => void} setValue - Set the input value programmatically
 */

/**
 * Create a bin/stack count adjuster control and append it to a parent element.
 * Label changes between "Stacks" (dotplot) and "Bins" (histogram).
 *
 * @param {HTMLElement} parent - Container to append the control to
 * @param {object} opts
 * @param {number} opts.currentBins - Current bin count
 * @param {number} [opts.min] - Minimum bins (default BIN_MIN)
 * @param {number} [opts.max] - Maximum bins (default HIST_MAX_BINS)
 * @param {(bins: number) => void} opts.onChange - Called when bin count changes
 * @returns {BinAdjusterControl}
 */
export function createBinAdjuster(parent, opts) {
  const min = opts.min ?? BIN_MIN;
  const max = opts.max ?? HIST_MAX_BINS;
  const label = document.createElement('label');
  const labelSpan = document.createElement('span');
  labelSpan.textContent = 'Bins:';
  label.appendChild(labelSpan);
  label.insertAdjacentHTML('beforeend', ` <input type="number" id="bin-count" min="${min}" max="${max}" step="1">`);
  label.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
  parent.appendChild(label);

  const input = /** @type {HTMLInputElement} */ (label.querySelector('input'));
  input.style.cssText = 'width:3.5rem;padding:0.15rem 0.3rem;font-size:0.85rem;';
  input.value = String(opts.currentBins);
  wrapWithStepper(input);

  input.addEventListener('input', () => {
    const n = parseInt(input.value, 10);
    if (isFinite(n) && n >= min) opts.onChange(n);
  });

  return {
    element: label,
    setMode: (mode) => {
      labelSpan.textContent = mode === 'dotplot' ? 'Stacks:' : 'Bins:';
    },
    setValue: (value) => {
      input.value = String(value);
    },
  };
}

// ─── Unified sim chart renderer ─────────────────────────────────────

/**
 * @typedef {object} SimChartResult
 * @property {import('./types.js').ChartFrame} frame
 * @property {any} xScale
 * @property {any} [yScale]
 * @property {any[]} [bins]
 * @property {[number,number]} [domain]
 * @property {number} [maxStack]
 * @property {number} [binWidth]
 */

/**
 * Render a simulation distribution chart (dotplot or histogram) with all
 * standard decorations: region shading, observed stat line, CI lines, pills.
 *
 * This is the single entry point for all simulation/conceptual pages that
 * need a dotplot-or-histogram with pills.
 *
 * @param {HTMLElement} container
 * @param {number[]} stats - Simulated statistics
 * @param {object} opts
 * @param {string} opts.chartType - 'dotplot' or 'histogram' (already resolved, not 'auto')
 * @param {string} opts.id - SVG id
 * @param {string} opts.xLabel
 * @param {string} [opts.titleText]
 * @param {[number,number]} [opts.domain]
 * @param {number} [opts.observedStat]
 * @param {[number,number]} [opts.ciLines]
 * @param {'left'|'right'|'both'} [opts.direction]
 * @param {number} [opts.nullCenter] - For 'both' direction isExtreme
 * @param {((v: number) => boolean)} [opts.regionPredicate] - Custom region predicate (overrides direction-based)
 * @param {number} [opts.highlightIndex]
 * @param {Set<number>} [opts.highlightIndices]
 * @param {number[]} [opts.prevBinCounts]
 * @param {number[]} [opts.thresholds] - Explicit histogram thresholds
 * @param {number} [opts.numBins] - Bin count override (dotplot or histogram)
 * @param {number} [opts.binWidth] - Locked bin width for dotplot (overrides numBins)
 * @param {number} [opts.binOrigin] - Bin origin for dotplot grid alignment
 * @param {number} [opts.precision]
 * @param {'randomization'|'bootstrap'} [opts.pillMode]
 * @param {number} [opts.pValue] - Pre-computed p-value for pills
 * @param {string} [opts.proportionLabel] - Pre-computed proportion label for bootstrap pills
 * @returns {SimChartResult}
 */
export function renderSimChart(container, stats, opts) {
  container.innerHTML = '';

  // Build region predicate from direction if not provided
  let regionPred = opts.regionPredicate;
  if (!regionPred && opts.observedStat != null && opts.direction) {
    const obs = opts.observedStat;
    const dir = opts.direction;
    const nc = opts.nullCenter;
    regionPred = (v) => isExtreme(v, obs, dir, nc);
  }

  /** @type {import('./types.js').ChartFrame} */
  let frame;
  /** @type {any} */
  let xScale;
  /** @type {any} */
  let yScale;
  /** @type {any[]} */
  let bins = [];
  /** @type {[number,number]|undefined} */
  let chartDomain = opts.domain;
  /** @type {number|undefined} */
  let dotMaxStack;
  /** @type {number|undefined} */
  let dotBinWidth;

  if (opts.chartType === 'dotplot') {
    const r = drawDotplot(container, stats, {
      id: opts.id,
      xLabel: opts.xLabel,
      titleText: opts.titleText ?? 'Null Distribution',
      isExtreme: regionPred,
      observedStat: opts.observedStat,
      ciLines: opts.ciLines,
      animate: false,
      domain: opts.domain,
      numBins: opts.numBins,
      binWidth: opts.binWidth,
      binOrigin: opts.binOrigin,
      highlightIndex: opts.highlightIndex ?? -1,
      highlightIndices: opts.highlightIndices,
      precision: opts.precision,
      baseFill: opts.baseFill,
      extremeFill: opts.extremeFill,
    });
    frame = r.frame;
    xScale = r.xScale;
    // Build a yScale from dotplot stack heights (for theory overlay)
    dotMaxStack = r.maxStack;
    dotBinWidth = r.binWidth;
    if (r.maxStack > 0 && frame) {
      yScale = d3Scale.scaleLinear()
        .domain([0, r.maxStack * 1.05])
        .range([frame.height, 0]);
    }
    chartDomain = opts.domain;
  } else {
    const r = drawHistogram(container, stats, {
      id: opts.id,
      xLabel: opts.xLabel,
      titleText: opts.titleText ?? 'Null Distribution',
      isTail: regionPred,
      observedStat: opts.observedStat,
      ciLines: opts.ciLines,
      animate: false,
      domain: opts.domain,
      thresholds: opts.thresholds,
      prevBinCounts: opts.prevBinCounts,
      numBins: opts.numBins,
      precision: opts.precision,
    });
    frame = r.frame;
    xScale = r.xScale;
    yScale = r.yScale;
    bins = r.bins;
    chartDomain = opts.domain || [0, 1];
  }

  // Add probability pills
  if (frame && xScale && stats.length > 0 && opts.pillMode) {
    if (opts.pillMode === 'randomization' && opts.observedStat != null && opts.direction) {
      renderSimPills(frame, xScale, {
        mode: 'randomization',
        pValue: opts.pValue ?? 0,
        observedStat: opts.observedStat,
        direction: opts.direction,
      });
    } else if (opts.pillMode === 'bootstrap' && opts.ciLines) {
      const propLabel = opts.proportionLabel ??
        formatStat(stats.filter(v => v >= opts.ciLines[0] && v <= opts.ciLines[1]).length / stats.length, 0, 'proportion');
      renderSimPills(frame, xScale, {
        mode: 'bootstrap',
        proportionLabel: propLabel,
        ci: opts.ciLines,
      });
    }
  }

  return { frame, xScale, yScale, bins, domain: chartDomain, maxStack: dotMaxStack, binWidth: dotBinWidth };
}
