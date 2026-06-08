// @ts-check
/**
 * Shared simulation page logic for StatLens.
 * Handles data input (URL params, paste), simulation controls, chart rendering, and results.
 */

import { parseParams } from './url-params.js';
import { parseCSV } from './csv-parser.js';
import { createRng } from './prng.js';
import { mean, median, sd, quantile, resample, permute, detectPrecision, formatStat } from './stats.js';
import { bootstrapCI, permutationPValue } from './sim-engine.js';
import * as d3Selection from 'd3-selection';
import { drawHistogram, computeBins, snappedPropThresholds } from './histogram.js';
import { drawDotplot, computeDotRadius } from './dotplot.js';
import { drawSpike } from './spike.js';
import { renderSimPills, formatMechStat, drawMiniBoxplot, morphMiniBoxplot, drawMiniChart, morphMiniChart, prefersReducedMotion, hasD3Transition } from './chart-utils.js';
import { initPlayPause, initHelp, initMechanismCollapse, animateDropToChart, flyDataStream, createExpertToggle, updateTabHint, getActiveTabId, getTabHintText, setPageTitle, initDataPanel } from './page-utils.js';
import { normalPdf, overlayTheoryCurve, removeTheoryOverlay, createTheoryToggle } from './theory-overlay.js';
import { resolveChartType, createChartToggle, displayPrecision, isExtreme as isExtremeShared, DOTPLOT_AUTO_THRESHOLD, createBinAdjuster } from './chart-defaults.js';
/**
 * @typedef {object} SimConfig
 * @property {'bootstrap'|'randomization'} mode
 * @property {string} [statLabel] - Display label for the statistic (randomization mode)
 * @property {(g1: number[], g2: number[]) => number} [testStat] - For randomization: compute observed stat
 * @property {boolean} [twoGroup] - Whether this is a two-group test
 * @property {boolean} [proportion] - Whether this is a proportion-based test (categorical outcome encoded as 0/1)
 * @property {boolean} [paired] - Whether this is a paired differences test (compute diffs first, then bootstrap)
 */

/**
 * Initialize a simulation page.
 * @param {SimConfig} config
 */
export function initSimPage(config) {
  initHelp();
  const urlParams = parseParams(window.location.search);

  // DOM elements
  const chartContainer = document.getElementById('chart-container');
  const resultDiv = document.getElementById('result-summary');
  const announceDiv = document.getElementById('sr-announce');
  const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
  const ciSelect = /** @type {HTMLSelectElement} */ (document.getElementById('ci-level'));
  const seedNotice = document.getElementById('seed-notice');
  const dataSummary = document.getElementById('data-summary');
  const dataPreview = document.getElementById('data-preview');
  const bootStatSelect = /** @type {HTMLSelectElement} */ (document.getElementById('boot-stat'));

  // Bootstrap stat functions keyed by select value
  /** @type {Record<string, {fn: (d: number[]) => number, label: string}>} */
  const BOOT_STATS = {
    mean:   { fn: (d) => mean(d),             label: 'Sample Mean',     longLabel: 'mean' },
    median: { fn: (d) => median(d),           label: 'Sample Median',   longLabel: 'median' },
    sd:     { fn: (d) => sd(d),               label: 'Sample Std Dev',  longLabel: 'standard deviation' },
    q1:     { fn: (d) => quantile(d, 0.25),   label: 'Q1 (25th %ile)', longLabel: 'first quartile' },
    q3:     { fn: (d) => quantile(d, 0.75),   label: 'Q3 (75th %ile)', longLabel: 'third quartile' },
  };

  /** Get the current bootstrap stat function and label. */
  function getBootstrapStat() {
    const key = bootStatSelect?.value ?? 'mean';
    return BOOT_STATS[key] ?? BOOT_STATS.mean;
  }

  // Generate bar buttons
  const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.gen-btn'));

  // Controls section (for sticky + expert toggle)
  const controlsSection = document.getElementById('controls');

  // Mark statistic/CI selectors as expert-only
  const controlRow = controlsSection?.querySelector('.control-row');
  if (controlRow) controlRow.classList.add('expert-only');

  // Add expert toggle link next to generate bar
  const generateBar = controlsSection?.querySelector('.generate-bar');
  if (generateBar) createExpertToggle(generateBar);

  // Mechanism strip elements
  const mechanismStrip = document.getElementById('mechanism-strip');
  const mechanismDescEl = document.getElementById('mechanism-description');

  // One-sample bootstrap mechanism (specific elements)
  const originalContentEl = document.getElementById('original-sample-content');
  const resampleContentEl = document.getElementById('resample-content');
  const bootstrapSampleEl = document.getElementById('bootstrap-sample');

  // Move mechanism description inside the resample panel so it appears under that half
  if (mechanismDescEl && bootstrapSampleEl) {
    bootstrapSampleEl.appendChild(mechanismDescEl);
  }
  const origNEl = document.getElementById('orig-n');
  const origMeanEl = document.getElementById('orig-mean');
  const resampleMeanEl = document.getElementById('resample-mean');
  const resampleToggle = document.getElementById('resample-view-toggle');

  // Two-group mechanism (bootstrap two-sample and randomization)
  const mechOriginalContent = document.getElementById('mech-original-content');
  const mechResampleContent = document.getElementById('mech-resample-content');

  /** Threshold: show individual chips below this, histogram above. */
  const CHIP_THRESHOLD = 30;
  /** @type {'summary'|'histogram'} */
  let resampleViewMode = 'summary';
  /** Whether the view mode was explicitly chosen by the user (overrides auto-default). */
  let resampleViewExplicit = false;
  /** @type {number[]} */
  let lastResample = [];
  /** Cached original-sample histogram result for morph animation (large-n). */
  /** @type {{ bins: ReturnType<typeof computeBins>['bins'], thresholds: number[], numBins: number } | null} */
  let origHistCache = null;
  /** Cached original proportion counts for proportion bar morph. */
  /** @type {{ successes: number, failures: number, pHat: number } | null} */
  let origPropCache = null;
  /** Duration (ms) of last two-group boxplot morph animation. */
  let twoGroupMorphMs = 0;
  /** Whether the last generate action was +1 (for persistent highlight). */
  let lastWasSingle = false;
  /** Whether the mechanism strip has been initialized (deferred to first generate). */
  let mechanismInitialized = false;

  /** Dataset context for natural-language interpretations. */
  /** @type {{population?:string, parameter?:string, unit?:string, nullClaim?:string, successLabel?:string}} */
  let datasetContext = {};
  /** Full dataset JSON for info panel. @type {object|undefined} */
  let currentDatasetJSON;

  /** Base page title (before dataset context is added). */
  const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

  /** Track current data source name for save filename. */
  let currentSourceName = 'data';

  /** Track selected variable name for interpretation text. */
  let selectedVarName = '';

  /** Decimal places in source data (for formatStat). */
  let dataPrecision = 0;

  // ── Variable selector (for multi-column CSV files) ──
  /** @type {HTMLDivElement|null} */
  let varSelectorDiv = null;
  /** @type {HTMLSelectElement|null} */
  let varSelectorSelect = null;
  /** Parsed CSV data cached for variable switching. @type {{headers:string[], types:string[], data:Array<Record<string,any>>}|null} */
  let parsedCSVCache = null;

  // Chart highlight state (declared early so renderChart can be called from showDataLoaded)
  /** Index of single newest dot for +1 highlight, or -1. */
  let lastStatIndex = -1;
  /** Indices of batch-added dots for +10 highlight, or null. */
  /** @type {Set<number>|null} */
  let batchHighlightIndices = null;
  /** Previous histogram bin counts for stacked delta highlight (batch only). */
  /** @type {number[]|null} */
  let prevBinCounts = null;
  /** New stat value for single-value histogram highlight (+1 case). */
  /** @type {number|null} */
  let lastHighlightValue = null;
  /** User's chart type preference: 'auto' (dotplot ≤200, histogram >200), 'dotplot', or 'histogram'. */
  /** @type {'auto'|'dotplot'|'histogram'} */
  let chartType = 'auto';
  /** Cached render params for chart type toggle re-render. */
  /** @type {[number,number]|null} */
  let lastCI = null;
  /** @type {number|undefined} */
  let lastObserved;
  /** @type {'left'|'right'|'both'|undefined} */
  let lastDirection;
  /** Pre-simulated domain for initial empty chart axis. */
  /** @type {[number,number]|null} */
  let preSimDomain = null;
  /** Locked dotplot bin grid — computed once from preSimDomain, reused for all renders. */
  /** @type {{ binWidth: number, binOrigin: number } | null} */
  let lockedDotGrid = null;
  /** Cached histogram result for theory overlay. */
  /** @type {{ xScale: any, yScale: any, bins: any[], domain: [number,number] } | null} */
  let lastHistResult = null;
  /** Cached dotplot result for theory overlay on dotplots. */
  /** @type {{ xScale: any, frame: any, domain: [number,number], maxStack: number, numBins: number } | null} */
  let lastDotResult = null;

  // Chart type toggle (Dotplot / Histogram) — radio-based segmented control
  /** @type {HTMLFieldSetElement|null} */
  let toggleFieldset = null;
  /** @type {((type: string) => void)|null} */
  let setToggleSelected = null;
  if (chartContainer) {
    const toggle = createChartToggle(chartContainer, {
      onChange: (type) => {
        chartType = type;
        if (binAdjuster) binAdjuster.setMode(/** @type {'dotplot'|'histogram'} */ (type));
        if (allStats.length > 0) {
          lastStatIndex = -1;
          batchHighlightIndices = null;
          prevBinCounts = null;
          lastHighlightValue = null;
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        }
      },
    });
    toggleFieldset = toggle.fieldset;
    setToggleSelected = toggle.setSelected;
    // Chart toggle, theory overlay, and bin adjuster are expert-only
    toggleFieldset.classList.add('expert-only');
  }

  // ─── Theory overlay toggle ───
  /** @type {HTMLInputElement|null} */
  let theoryCheckbox = null;
  let theoryOverlayOn = false;
  if (toggleFieldset && config.mode === 'bootstrap') {
    theoryCheckbox = createTheoryToggle(toggleFieldset, (checked) => {
      theoryOverlayOn = checked;
      if (allStats.length > 0) {
        if (checked) {
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        } else if (chartContainer) {
          removeTheoryOverlay(chartContainer);
        }
      }
    });
  }

  // ─── Bin adjuster (continuous data only — proportions have fixed k/n bins) ───
  const DEFAULT_BINS = 20;
  /** @type {number|undefined} */
  let userBinCount = config.proportion ? undefined : DEFAULT_BINS;
  /** @type {import('./chart-defaults.js').BinAdjusterControl|null} */
  let binAdjuster = null;
  if (toggleFieldset && !config.proportion) {
    binAdjuster = createBinAdjuster(toggleFieldset, {
      currentBins: 20,
      onChange: (bins) => {
        userBinCount = bins;
        // Recompute locked dot grid with new bin count
        if (preSimDomain) {
          const gridBinWidth = (preSimDomain[1] - preSimDomain[0]) / bins;
          lockedDotGrid = { binWidth: gridBinWidth, binOrigin: preSimDomain[0] };
        }
        if (allStats.length > 0) {
          lastStatIndex = -1;
          batchHighlightIndices = null;
          prevBinCounts = null;
          lastHighlightValue = null;
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        }
      },
    });
  }

  /** Get the currently active chart type (resolving 'auto'). */
  function getActiveChartType() {
    return resolveChartType(allStats.length, chartType);
  }

  /**
   * Overlay a normal theory curve on the current histogram.
   * Computes the appropriate normal approximation depending on the mode:
   *   - One mean: N(x̄, s/√n)
   *   - Paired: N(d̄, s_d/√n)
   *   - Two means: N(x̄₁ - x̄₂, SE) where SE = √(s₁²/n₁ + s₂²/n₂)
   *   - One proportion: N(p̂, √(p̂(1−p̂)/n))
   *   - Two proportions: N(p̂₁ - p̂₂, SE) where SE uses individual p̂'s
   * @param {number[]} stats
   */
  function applyTheoryOverlay(stats) {
    if (!chartContainer || data1.length === 0) return;

    let center = 0;
    let se = 0;
    let label = 'N(est, SE)';

    if (config.paired && data2.length > 0) {
      // Paired: bootstrap the mean difference
      const diffs = data2.map((v, i) => v - data1[i]);
      center = mean(diffs);
      se = sd(diffs) / Math.sqrt(diffs.length);
      label = 'N(d\u0304, SE)';
    } else if (config.proportion && config.twoGroup && data2.length > 0) {
      // Two proportions: bootstrap the difference p̂₁ − p̂₂
      const p1 = mean(data1);
      const p2 = mean(data2);
      center = p1 - p2;
      se = Math.sqrt(p1 * (1 - p1) / data1.length + p2 * (1 - p2) / data2.length);
      label = 'N(p\u0302₁−p\u0302₂, SE)';
    } else if (config.proportion) {
      // One proportion
      const pHat = mean(data1);
      center = pHat;
      se = Math.sqrt(pHat * (1 - pHat) / data1.length);
      label = `N(p\u0302, SE)`;
    } else if (config.twoGroup && data2.length > 0) {
      // Two means: bootstrap the difference x̄₁ − x̄₂
      center = mean(data1) - mean(data2);
      const s1 = sd(data1);
      const s2 = sd(data2);
      se = Math.sqrt(s1 * s1 / data1.length + s2 * s2 / data2.length);
      label = 'N(x\u0304₁−x\u0304₂, SE)';
    } else {
      // One mean (default)
      center = mean(data1);
      se = sd(data1) / Math.sqrt(data1.length);
      label = 'N(x\u0304, SE)';
    }

    if (!isFinite(se) || se <= 0) return;

    if (lastHistResult) {
      // Histogram mode: scale PDF to match histogram bar heights
      const { xScale: hxScale, yScale: hyScale, bins, domain: dom } = lastHistResult;
      if (!bins || bins.length === 0) return;
      const binWidth = /** @type {number} */ (bins[0].x1) - /** @type {number} */ (bins[0].x0);

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, center, se),
        xDomain: dom,
        totalN: stats.length,
        binWidth,
        xScale: hxScale,
        yScale: hyScale,
        label,
      });
    } else if (lastDotResult) {
      // Dotplot mode: scale PDF peak to match the tallest dot stack height
      const { xScale: dxScale, frame, domain: dom, maxStack, numBins } = lastDotResult;
      const peakPdf = normalPdf(center, center, se);
      if (peakPdf <= 0 || maxStack <= 0) return;

      // Compute dot radius to determine actual stack height in pixels
      const dotRadius = computeDotRadius(frame.width, frame.height, maxStack, numBins);
      const stackHeightPx = maxStack * dotRadius * 2;
      // Scale the curve so its peak matches the tallest stack height
      const scaleFactor = stackHeightPx / peakPdf;
      // y-scale: map from scaled PDF pixel height → SVG y coordinate (top-down)
      const yScale = (/** @type {number} */ freqY) => frame.height - freqY;

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, center, se),
        xDomain: dom,
        totalN: 1,
        binWidth: scaleFactor,
        xScale: dxScale,
        yScale,
        label,
      });
    }
  }

  /**
   * Rebuild the chart toggle options based on whether data is discrete.
   * @param {boolean} isDiscrete
   */
  function updateToggleButtons(isDiscrete) {
    if (!toggleFieldset) return;
    const currentType = chartType;
    if (!isDiscrete && currentType === 'spike') chartType = 'auto';
    const types = isDiscrete
      ? [['dotplot', 'Dotplot'], ['spike', 'Spike'], ['histogram', 'Histogram']]
      : [['dotplot', 'Dotplot'], ['histogram', 'Histogram']];
    const selected = (chartType === 'auto' ? 'dotplot' : chartType);
    // Remove existing chart type buttons but keep non-button children (theory toggle, bin adjuster)
    toggleFieldset.querySelectorAll('button[data-value]').forEach(b => b.remove());
    // Insert new segmented buttons at the start
    const refChild = toggleFieldset.firstChild;
    for (const [value, label] of types) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = label;
      btn.dataset.value = value;
      btn.setAttribute('aria-pressed', String(value === selected));
      btn.addEventListener('click', () => {
        chartType = value;
        if (setToggleSelected) setToggleSelected(value);
        if (binAdjuster) binAdjuster.setMode(/** @type {'dotplot'|'histogram'} */ (value));
        if (allStats.length > 0) {
          lastStatIndex = -1;
          batchHighlightIndices = null;
          prevBinCounts = null;
          lastHighlightValue = null;
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        }
      });
      toggleFieldset.insertBefore(btn, refChild);
    }
  }

  // Tab handling
  const tabs = document.querySelectorAll('[role="tab"]');
  const panels = document.querySelectorAll('[role="tabpanel"]');
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.setAttribute('aria-selected', 'false');
      for (const p of panels) p.hidden = true;
      tab.setAttribute('aria-selected', 'true');
      const panelId = tab.getAttribute('aria-controls');
      const panel = document.getElementById(panelId);
      if (panel) panel.hidden = false;
      updateTabHint(tab.id, resultDiv, 'run a simulation to see results');
    });
  }

  // Hypothesis display elements (randomization tests)
  const hypothesisDisplay = document.getElementById('hypothesis-display');
  const altDirectionBtn = /** @type {HTMLButtonElement} */ (document.getElementById('alt-direction'));
  const swapGroupsBtn = document.getElementById('swap-groups');
  const hGroup1 = document.getElementById('h-group1');
  const hGroup2 = document.getElementById('h-group2');
  const haGroup1 = document.getElementById('ha-group1');
  const haGroup2 = document.getElementById('ha-group2');

  // Editable null value (expert-only, for paired/two-group means randomization)
  const nullValueInput = /** @type {HTMLInputElement|null} */ (document.getElementById('null-value'));
  const nullDisplayMirror = document.getElementById('null-display');

  /** Get the null hypothesis value (δ₀). Returns 0 in standard mode or when input is absent. */
  function getNullValue() {
    if (!nullValueInput) return 0;
    const val = parseFloat(nullValueInput.value);
    return isFinite(val) ? val : 0;
  }

  // Sync null-display mirror and re-run when null value changes
  if (nullValueInput) {
    nullValueInput.addEventListener('input', () => {
      if (nullDisplayMirror) nullDisplayMirror.textContent = nullValueInput.value || '0';
      // Re-render chart + results if simulation has run
      if (allStats.length > 0) {
        const nullDiff = getNullValue();
        const rawObserved = config.paired
          ? mean(data2.map((v, i) => v - data1[i]))
          : config.testStat(data1, data2);
        const observedStat = rawObserved - nullDiff;
        const direction = getDirection();
        renderChart(allStats, null, observedStat, direction);
        const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
        displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);
      }
    });
  }

  // Success outcome selector (proportion tests)
  const successSelector = document.getElementById('success-selector');
  const successOutcomeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('success-outcome'));

  /** @type {number[]} */
  let data1 = [];
  /** @type {number[]} */
  let data2 = [];
  let group1Name = 'Group 1';
  let group2Name = 'Group 2';

  // Raw categorical data for proportion tests (needed for re-encoding on success change)
  /** @type {string[]} */
  let rawOutcomes1 = [];
  /** @type {string[]} */
  let rawOutcomes2 = [];
  let successOutcome = '';

  // Accumulated stats and RNG
  /** @type {number[]} */
  let allStats = [];
  /** @type {(() => number)|null} */
  let rng = null;

  // Seed: use URL seed for reproducibility (graded work), otherwise random each session
  const urlSeed = urlParams.seed;
  let seed = urlSeed ?? Math.random().toString(36).slice(2, 10);
  if (urlSeed && seedNotice) {
    seedNotice.hidden = false;
    seedNotice.textContent = `Seed: ${urlSeed}`;
  }

  // Apply URL params (data loading is now handled by initDataPanel)
  if (urlParams.ci && ciSelect) {
    ciSelect.value = String(urlParams.ci);
  }
  if (urlParams.stat && bootStatSelect) {
    bootStatSelect.value = urlParams.stat;
  }

  // ─── Variable selector helpers ───

  /**
   * Show a variable selector above the data-preview area.
   * @param {string[]} columns - Numeric column names to choose from
   * @param {(colName: string) => void} onChange - Called when selection changes
   */
  function showVarSelector(columns, onChange) {
    hideVarSelector();
    varSelectorDiv = document.createElement('div');
    varSelectorDiv.className = 'var-selector-row';
    varSelectorDiv.innerHTML = '<label for="sim-var-select">Variable: </label>';
    varSelectorSelect = document.createElement('select');
    varSelectorSelect.id = 'sim-var-select';
    for (const col of columns) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      varSelectorSelect.appendChild(opt);
    }
    varSelectorDiv.appendChild(varSelectorSelect);
    // Insert before data-preview
    const insertTarget = dataPreview?.parentElement;
    if (insertTarget && dataPreview) {
      insertTarget.insertBefore(varSelectorDiv, dataPreview);
    }
    varSelectorSelect.addEventListener('change', () => {
      onChange(varSelectorSelect.value);
    });
  }

  /** Remove the variable selector if present. */
  function hideVarSelector() {
    if (varSelectorDiv) {
      varSelectorDiv.remove();
      varSelectorDiv = null;
      varSelectorSelect = null;
    }
    parsedCSVCache = null;
  }

  // ─── Data loading ───

  /**
   * Parse text data (CSV or plain numbers) and load it into the simulation.
   * @param {string} text - Raw text content
   */
  function loadTextData(text) {
    if (!text.trim()) return;
    datasetContext = {};

      try {
        const parsed = parseCSV(text);
        if (parsed.headers.length > 0 && parsed.data.length > 0) {
          const numIdx = parsed.types.indexOf('numeric');
          const catIdx = parsed.types.indexOf('categorical');

          if (config.proportion && !config.twoGroup) {
            // One-sample bootstrap proportion: single categorical column
            const catIndices = parsed.types
              .map((t, i) => t === 'categorical' ? i : -1)
              .filter(i => i >= 0);
            if (catIndices.length >= 1) {
              const outcomeCol = parsed.headers[catIndices[0]];
              rawOutcomes1 = parsed.data.map(r => r[outcomeCol]);
              rawOutcomes2 = [];
              const outcomes = [...new Set(rawOutcomes1)];
              populateSuccessSelector(outcomes);
              encodeProportionData();
              showDataLoaded();
              return;
            }
          } else if (config.proportion) {
            // Two-group proportion test: two categorical columns
            const catIndices = parsed.types
              .map((t, i) => t === 'categorical' ? i : -1)
              .filter(i => i >= 0);
            if (catIndices.length >= 2) {
              const groupCol = parsed.headers[catIndices[0]];
              const outcomeCol = parsed.headers[catIndices[1]];
              const groups = [...new Set(parsed.data.map(r => r[groupCol]))];
              const outcomes = [...new Set(parsed.data.map(r => r[outcomeCol]))];
              if (groups.length >= 2) {
                group1Name = groups[0];
                group2Name = groups[1];
                rawOutcomes1 = parsed.data
                  .filter(r => r[groupCol] === groups[0])
                  .map(r => r[outcomeCol]);
                rawOutcomes2 = parsed.data
                  .filter(r => r[groupCol] === groups[1])
                  .map(r => r[outcomeCol]);
                populateSuccessSelector(outcomes);
                encodeProportionData();
                showDataLoaded();
                return;
              }
            }
          } else if (config.paired) {
            // Paired data: two numeric columns
            const numIndices = parsed.types
              .map((t, i) => t === 'numeric' ? i : -1)
              .filter(i => i >= 0);
            if (numIndices.length >= 2) {
              const col1 = parsed.headers[numIndices[0]];
              const col2 = parsed.headers[numIndices[1]];
              group1Name = col1;
              group2Name = col2;
              data1 = parsed.data.map(r => parseFloat(r[col1])).filter(v => isFinite(v));
              data2 = parsed.data.map(r => parseFloat(r[col2])).filter(v => isFinite(v));
              // Trim to equal length
              const minLen = Math.min(data1.length, data2.length);
              data1 = data1.slice(0, minLen);
              data2 = data2.slice(0, minLen);
              showDataLoaded();
              return;
            }
          } else if (config.twoGroup && catIdx >= 0 && numIdx >= 0) {
            const groupCol = parsed.headers[catIdx];
            const valCol = parsed.headers[numIdx];
            const groups = [...new Set(parsed.data.map(r => r[groupCol]))];
            if (groups.length >= 2) {
              group1Name = groups[0];
              group2Name = groups[1];
              data1 = parsed.data
                .filter(r => r[groupCol] === groups[0])
                .map(r => parseFloat(r[valCol]))
                .filter(v => isFinite(v));
              data2 = parsed.data
                .filter(r => r[groupCol] === groups[1])
                .map(r => parseFloat(r[valCol]))
                .filter(v => isFinite(v));
              showDataLoaded();
              return;
            }
          }

          if (numIdx >= 0) {
            const numericCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
            const colName = numericCols[0];
            selectedVarName = colName;
            datasetContext.parameter = colName;
            data1 = parsed.data
              .map(row => parseFloat(row[colName]))
              .filter(v => isFinite(v));

            // Show variable selector for multi-column CSV on single-variable pages
            if (numericCols.length > 1 && !config.twoGroup && !config.paired) {
              parsedCSVCache = parsed;
              showVarSelector(numericCols, (selected) => {
                selectedVarName = selected;
                datasetContext.parameter = selected;
                data1 = parsedCSVCache.data
                  .map(row => parseFloat(row[selected]))
                  .filter(v => isFinite(v));
                resetSimulation();
                showDataLoaded();
              });
            }

            showDataLoaded();
            return;
          }
        }
      } catch {
        // Fall through to simple parse
      }

      const values = text.split(/[\n,]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(Number)
        .filter(v => isFinite(v));

      if (values.length > 0) {
        data1 = values;
        showDataLoaded();
      } else {
        announce('No numeric data found. Check your data format.');
      }
  }

  // ── Summary input (proportion pages) ──
  const loadSummaryBtn = document.getElementById('load-summary');
  if (loadSummaryBtn && config.proportion) {
    loadSummaryBtn.addEventListener('click', () => {
      resetSimulation();

      if (config.twoGroup) {
        // Two-proportion summary: two groups with successes + n
        const x1El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-x1'));
        const n1El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-n1'));
        const x2El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-x2'));
        const n2El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-n2'));
        const lbl1El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-label1'));
        const lbl2El = /** @type {HTMLInputElement|null} */ (document.getElementById('input-label2'));

        const x1 = Math.round(Number(x1El?.value));
        const n1 = Math.round(Number(n1El?.value));
        const x2 = Math.round(Number(x2El?.value));
        const n2 = Math.round(Number(n2El?.value));

        if (!Number.isFinite(n1) || n1 < 1 || !Number.isFinite(n2) || n2 < 1) {
          announce('Enter valid sample sizes (at least 1).');
          return;
        }
        if (!Number.isFinite(x1) || x1 < 0 || x1 > n1) {
          announce('Group 1 successes must be between 0 and n\u2081.');
          return;
        }
        if (!Number.isFinite(x2) || x2 < 0 || x2 > n2) {
          announce('Group 2 successes must be between 0 and n\u2082.');
          return;
        }

        group1Name = lbl1El?.value?.trim() || 'Group 1';
        group2Name = lbl2El?.value?.trim() || 'Group 2';
        successOutcome = 'success';

        // Encode as 0/1 arrays
        data1 = Array(n1).fill(0);
        for (let i = 0; i < x1; i++) data1[i] = 1;
        data2 = Array(n2).fill(0);
        for (let i = 0; i < x2; i++) data2[i] = 1;

        rawOutcomes1 = data1.map(v => v === 1 ? 'success' : 'failure');
        rawOutcomes2 = data2.map(v => v === 1 ? 'success' : 'failure');

        if (successSelector) successSelector.hidden = true;
        showDataLoaded();
        dataApi.triggerPostLoad();
        announce(`Loaded: ${group1Name} ${x1}/${n1}, ${group2Name} ${x2}/${n2}.`);
      } else {
        // One-proportion summary: successes + n
        const nEl = /** @type {HTMLInputElement|null} */ (document.getElementById('input-n'));
        const kEl = /** @type {HTMLInputElement|null} */ (document.getElementById('input-successes'));

        const n = Math.round(Number(nEl?.value));
        const k = Math.round(Number(kEl?.value));

        if (!Number.isFinite(n) || n < 1) {
          announce('Sample size must be at least 1.');
          return;
        }
        if (!Number.isFinite(k) || k < 0 || k > n) {
          announce('Successes must be between 0 and n.');
          return;
        }

        successOutcome = 'success';
        data1 = Array(n).fill(0);
        for (let i = 0; i < k; i++) data1[i] = 1;
        data2 = [];

        rawOutcomes1 = data1.map(v => v === 1 ? 'success' : 'failure');
        rawOutcomes2 = [];

        if (successSelector) successSelector.hidden = true;
        showDataLoaded();
        dataApi.triggerPostLoad();
        announce(`Loaded: n = ${n}, successes = ${k}.`);
      }
    });
  }

  function showDataLoaded() {
    // Set dataPrecision based on source data type, capped at 2 so that
    // computed stats (d + 1 rule) never exceed 3 decimal places.
    if (config.proportion) {
      dataPrecision = 0; // proportion data is 0/1 integers
    } else if (config.paired || (config.twoGroup && data2.length > 0)) {
      dataPrecision = Math.min(2, Math.max(detectPrecision(data1), detectPrecision(data2)));
    } else {
      dataPrecision = Math.min(2, detectPrecision(data1));
    }

    if (dataPreview) dataPreview.hidden = false;
    if (dataSummary) {
      const namePrefix = currentSourceName && currentSourceName !== 'data' ? `${currentSourceName}: ` : '';
      if (config.paired) {
        const diffs = data2.map((v, i) => v - data1[i]);
        const m = mean(diffs);
        dataSummary.innerHTML =
          `${namePrefix}${data1.length} pairs | ${group1Name}: <span class="x-bar">x</span> = ${formatStat(mean(data1), dataPrecision)} | ` +
          `${group2Name}: <span class="x-bar">x</span> = ${formatStat(mean(data2), dataPrecision)} | Mean diff (${group2Name} \u2212 ${group1Name}) = ${formatStat(m, dataPrecision)}`;
      } else if (config.proportion && !config.twoGroup) {
        const p1 = mean(data1);
        const s1 = data1.filter(v => v === 1).length;
        dataSummary.textContent =
          `${namePrefix}n = ${data1.length}, successes = ${s1}, p̂ = ${formatStat(p1, dataPrecision, 'proportion')}`;
      } else if (config.proportion && data2.length > 0) {
        const p1 = mean(data1);
        const p2 = mean(data2);
        const s1 = data1.filter(v => v === 1).length;
        const s2 = data2.filter(v => v === 1).length;
        dataSummary.textContent =
          `${namePrefix}${group1Name}: ${s1}/${data1.length} (p̂ = ${formatStat(p1, dataPrecision, 'proportion')}) | ` +
          `${group2Name}: ${s2}/${data2.length} (p̂ = ${formatStat(p2, dataPrecision, 'proportion')})`;
      } else if (config.twoGroup && data2.length > 0) {
        dataSummary.innerHTML =
          `${namePrefix}${group1Name}: n = ${data1.length}, <span class="x-bar">x</span> = ${formatStat(mean(data1), dataPrecision)} | ` +
          `${group2Name}: n = ${data2.length}, <span class="x-bar">x</span> = ${formatStat(mean(data2), dataPrecision)}`;
      } else {
        const n = data1.length;
        const m = mean(data1);
        const s = sd(data1);
        const varPrefix = selectedVarName ? `${selectedVarName}: ` : '';
        dataSummary.textContent = `${namePrefix}${varPrefix}n = ${n}, mean = ${formatStat(m, dataPrecision)}, SD = ${formatStat(s, dataPrecision)}`;
      }
    }
    for (const btn of genBtns) btn.disabled = false;
    // Update chart toggle: discrete (proportion) data gets spike option
    updateToggleButtons(!!config.proportion);
    // Clear stale results
    resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';
    // Mechanism strip is deferred until first generate click (see generateSamples)

    // Note: data panel collapse and sticky controls are handled by initDataPanel's postLoadUI

    // Show hypothesis display (randomization tests)
    if (config.mode === 'randomization' && (config.twoGroup || config.paired) && hypothesisDisplay) {
      hypothesisDisplay.hidden = false;
      if (config.twoGroup) updateHypothesisDisplay();
    }
    // Show group order (two-sample bootstrap)
    const groupOrderEl = document.getElementById('group-order');
    const groupOrderLabel = document.getElementById('group-order-label');
    if (config.mode === 'bootstrap' && config.twoGroup && groupOrderEl && groupOrderLabel) {
      groupOrderEl.hidden = false;
      groupOrderLabel.textContent = `${group1Name} − ${group2Name}`;
    }
    // Update document.title with dataset context
    const totalN = config.twoGroup || config.paired ? data1.length + data2.length : data1.length;
    setPageTitle(baseTitle, currentSourceName, {
      variable: selectedVarName || undefined,
      n: totalN,
    });

    announce(`Data loaded: n = ${data1.length}`);

    // Render empty chart with sensible axis limits by running a silent pre-simulation
    renderEmptyChart();

    // Scroll chart into view after DOM settles
    setTimeout(() => {
      const target = document.getElementById('chart');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }, 150);
  }

  /**
   * Run a silent pre-simulation to establish sensible axis limits,
   * then render an empty chart (0 dots, just axes, no observed line).
   */
  function renderEmptyChart() {
    const PRE_SIM_N = 2000;
    const TRIM = 5; // 5/2000 = 0.25th percentile — captures extreme tails
    const preRng = createRng('presim-' + Date.now());
    const preStats = [];

    if (config.mode === 'bootstrap') {
      const statFn = getBootstrapStat().fn;
      if (config.paired && data2.length > 0) {
        const diffs = data2.map((v, i) => v - data1[i]);
        for (let i = 0; i < PRE_SIM_N; i++) preStats.push(statFn(resample(diffs, preRng)));
      } else if (config.twoGroup && data2.length > 0) {
        for (let i = 0; i < PRE_SIM_N; i++) preStats.push(statFn(resample(data1, preRng)) - statFn(resample(data2, preRng)));
      } else {
        for (let i = 0; i < PRE_SIM_N; i++) preStats.push(statFn(resample(data1, preRng)));
      }
    } else if (config.paired && data2.length > 0) {
      // Paired randomization: sign-flip pre-sim
      const diffs = data2.map((v, i) => v - data1[i]);
      for (let i = 0; i < PRE_SIM_N; i++) {
        const flipped = diffs.map(d => preRng() < 0.5 ? d : -d);
        preStats.push(mean(flipped));
      }
    } else if (config.testStat) {
      for (let i = 0; i < PRE_SIM_N; i++) {
        const [g1, g2] = permute(data1, data2, preRng);
        preStats.push(config.testStat(g1, g2));
      }
    }

    if (preStats.length === 0) return;

    // Sort and trim extremes for a stable domain
    preStats.sort((a, b) => a - b);
    const lo = preStats[TRIM];
    const hi = preStats[preStats.length - 1 - TRIM];
    const pad = (hi - lo) * 0.1 || 0.5;
    preSimDomain = [lo - pad, hi + pad];

    // Lock the dotplot bin grid so dots don't shift as domain grows
    // For two-group proportions, use same effective sample size as renderChart
    const gridNumBins = config.proportion
      ? (config.twoGroup && data2.length > 0
          ? Math.round(data1.length * data2.length / (data1.length + data2.length))
          : data1.length)
      : (userBinCount ?? 40);
    // For proportions, use natural 1/n step size (not domain_range/n) so dots
    // are sized correctly relative to the visible bins, not the full 0-1 range.
    const gridBinWidth = config.proportion
      ? 1 / gridNumBins
      : (preSimDomain[1] - preSimDomain[0]) / gridNumBins;
    lockedDotGrid = { binWidth: gridBinWidth, binOrigin: preSimDomain[0] };

    // Render empty chart (no observed stat line — just axes)
    renderChart([]);
  }

  function updateHypothesisDisplay() {
    if (hGroup1) hGroup1.textContent = group1Name;
    if (hGroup2) hGroup2.textContent = group2Name;
    if (haGroup1) haGroup1.textContent = group1Name;
    if (haGroup2) haGroup2.textContent = group2Name;
  }

  // ─── Proportion helpers ───

  /**
   * Populate the success-outcome dropdown with available outcomes.
   * @param {string[]} outcomes
   */
  function populateSuccessSelector(outcomes) {
    if (!successOutcomeSelect || !successSelector) return;
    successOutcomeSelect.innerHTML = '';
    for (const o of outcomes) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      successOutcomeSelect.appendChild(opt);
    }
    // Check URL param ?success= first, then dataset context successLabel
    const urlSuccess = new URLSearchParams(location.search).get('success');
    if (urlSuccess && outcomes.includes(urlSuccess)) {
      successOutcomeSelect.value = urlSuccess;
      successOutcome = urlSuccess;
    } else if (datasetContext.successLabel && outcomes.includes(datasetContext.successLabel)) {
      successOutcomeSelect.value = datasetContext.successLabel;
      successOutcome = datasetContext.successLabel;
    } else {
      successOutcome = outcomes[0];
    }
    successSelector.hidden = false;
  }

  /** Encode raw categorical outcomes as 1 (success) / 0 (not success). */
  function encodeProportionData() {
    data1 = rawOutcomes1.map(o => o === successOutcome ? 1 : 0);
    if (rawOutcomes2.length > 0) {
      data2 = rawOutcomes2.map(o => o === successOutcome ? 1 : 0);
    }
  }

  // Success outcome change → re-encode and reset
  if (successOutcomeSelect) {
    successOutcomeSelect.addEventListener('change', () => {
      successOutcome = successOutcomeSelect.value;
      encodeProportionData();
      if (allStats.length > 0) resetSimulation();
      showDataLoaded();
      announce(`Success outcome changed to "${successOutcome}".`);
    });
  }

  // ─── Data panel (shared initDataPanel) ───

  // Two-group difference-in-means tools (bootstrap-two-means, randomization-diff-means)
  // require a grouping variable with EXACTLY 2 levels and >=3 obs per group (REQ-024).
  // groupLevels/minGroupN are precomputed in data/datasets.json (see data/rebuild-index.js).
  /** @param {any} ds */
  const isTwoGroupMeans = ds => ds.type === 'randomization' && ds.groupLevels === 2 && ds.minGroupN >= 3;

  /** @param {any} ds */
  function simDatasetFilter(ds) {
    if (config.paired) return ds.type === 'paired';
    if (config.mode === 'bootstrap' && config.proportion && !config.twoGroup) return ds.type === 'bootstrap_prop';
    if (config.mode === 'bootstrap' && config.twoGroup && config.proportion) return ds.type === 'randomization_prop';
    if (config.mode === 'bootstrap' && config.twoGroup) return isTwoGroupMeans(ds);
    if (config.mode === 'bootstrap') return ds.hasNumeric === true && ds.hasCategorical !== true && ds.type !== 'regression' && ds.type !== 'paired';
    if (config.proportion) return ds.type === 'randomization_prop';
    if (config.twoGroup) return isTwoGroupMeans(ds);
    return ds.type === 'randomization' || ds.type === 'randomization_prop';
  }

  const dataApi = initDataPanel({
    autoCollapse: true,
    stickyControls: true,
    showPreview: true,
    datasetFilter: simDatasetFilter,
    onDataset: (/** @type {any} */ ds) => {
      resetSimulation();
      hideVarSelector();
      selectedVarName = '';
      datasetContext = ds.context || {};
      currentDatasetJSON = ds;
      currentSourceName = ds.name || ds.id;

      if (config.paired) {
        const numVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'numeric');
        if (numVars.length < 2) return;
        group1Name = numVars[0].name;
        group2Name = numVars[1].name;
        data1 = ds.rows.map(/** @param {any} r */ r => r[numVars[0].name]).filter(/** @param {any} v */ v => isFinite(v));
        data2 = ds.rows.map(/** @param {any} r */ r => r[numVars[1].name]).filter(/** @param {any} v */ v => isFinite(v));
        const minLen = Math.min(data1.length, data2.length);
        data1 = data1.slice(0, minLen);
        data2 = data2.slice(0, minLen);
      } else if (config.mode === 'bootstrap' && config.proportion && !config.twoGroup) {
        const catVar = ds.variables.find(/** @param {any} v */ v => v.type === 'categorical');
        if (!catVar) return;
        rawOutcomes1 = ds.rows.map(/** @param {any} r */ r => r[catVar.name]);
        rawOutcomes2 = [];
        populateSuccessSelector([...new Set(rawOutcomes1)]);
        encodeProportionData();
      } else if (config.mode === 'bootstrap' && !config.twoGroup) {
        const numVar = ds.variables.find(/** @param {any} v */ v => v.type === 'numeric');
        if (!numVar) return;
        data1 = ds.rows.map(/** @param {any} r */ r => r[numVar.name]).filter(/** @param {any} v */ v => isFinite(v));
        data2 = [];
      } else if (config.proportion) {
        const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
        if (catVars.length < 2) return;
        const groupVar = catVars[0];
        const outcomeVar = catVars[1];
        const groups = [...new Set(ds.rows.map(/** @param {any} r */ r => r[groupVar.name]))];
        if (groups.length < 2) return;
        const outcomes = [...new Set(ds.rows.map(/** @param {any} r */ r => r[outcomeVar.name]))];
        group1Name = groups[0];
        group2Name = groups[1];
        rawOutcomes1 = ds.rows
          .filter(/** @param {any} r */ r => r[groupVar.name] === groups[0])
          .map(/** @param {any} r */ r => r[outcomeVar.name]);
        rawOutcomes2 = ds.rows
          .filter(/** @param {any} r */ r => r[groupVar.name] === groups[1])
          .map(/** @param {any} r */ r => r[outcomeVar.name]);
        populateSuccessSelector(outcomes);
        encodeProportionData();
      } else {
        const catVar = ds.variables.find(/** @param {any} v */ v => v.type === 'categorical');
        const numVar = ds.variables.find(/** @param {any} v */ v => v.type === 'numeric');
        if (!catVar || !numVar) return;
        const groups = [...new Set(ds.rows.map(/** @param {any} r */ r => r[catVar.name]))];
        if (groups.length < 2) return;
        group1Name = groups[0];
        group2Name = groups[1];
        data1 = ds.rows
          .filter(/** @param {any} r */ r => r[catVar.name] === groups[0])
          .map(/** @param {any} r */ r => r[numVar.name])
          .filter(/** @param {any} v */ v => isFinite(v));
        data2 = ds.rows
          .filter(/** @param {any} r */ r => r[catVar.name] === groups[1])
          .map(/** @param {any} r */ r => r[numVar.name])
          .filter(/** @param {any} v */ v => isFinite(v));
      }

      showDataLoaded();
      announce(`${ds.name}.`);
    },
    onRawText: (/** @type {string} */ text, /** @type {string} */ sourceName) => {
      currentSourceName = sourceName || 'data';
      loadTextData(text);
    },
    onClear: () => {
      data1 = [];
      data2 = [];
      resampleViewExplicit = false;
      resetSimulation();
      hideVarSelector();
      if (dataPreview) dataPreview.hidden = true;
      if (dataSummary) dataSummary.textContent = '\u2014';
      for (const btn of genBtns) btn.disabled = true;
      if (mechanismStrip) mechanismStrip.hidden = true;
      if (successSelector) successSelector.hidden = true;
      if (hypothesisDisplay) hypothesisDisplay.hidden = true;
      const groupOrderEl = document.getElementById('group-order');
      if (groupOrderEl) groupOrderEl.hidden = true;
      announce('Data cleared.');
    },
  });

  /** Map alternative hypothesis selection to tail direction. */
  function getDirection() {
    const alt = altDirectionBtn?.dataset.value ?? 'greater';
    if (alt === 'greater') return /** @type {const} */ ('right');
    if (alt === 'less') return /** @type {const} */ ('left');
    return /** @type {const} */ ('both');
  }

  // Swap groups button
  if (swapGroupsBtn) {
    swapGroupsBtn.addEventListener('click', () => {
      [data1, data2] = [data2, data1];
      [group1Name, group2Name] = [group2Name, group1Name];
      [rawOutcomes1, rawOutcomes2] = [rawOutcomes2, rawOutcomes1];
      if (allStats.length > 0) resetSimulation();
      showDataLoaded();
      announce(`Swapped groups: ${group1Name} − ${group2Name}`);
    });
  }

  // Alt hypothesis change → cycle button and re-render
  if (altDirectionBtn) {
    const vals = (altDirectionBtn.dataset.values || '').split(',');
    const labels = (altDirectionBtn.dataset.labels || '').split(',');
    altDirectionBtn.addEventListener('click', () => {
      const cur = vals.indexOf(altDirectionBtn.dataset.value || 'greater');
      const next = (cur + 1) % vals.length;
      altDirectionBtn.dataset.value = vals[next];
      altDirectionBtn.textContent = labels[next];
      if (allStats.length > 0) {
        const nullDiff = getNullValue();
        const rawObserved = config.paired
          ? mean(data2.map((v, i) => v - data1[i]))
          : config.testStat(data1, data2);
        const observedStat = rawObserved - nullDiff;
        const direction = getDirection();
        renderChart(allStats, null, observedStat, direction);
        const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
        displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);
      }
    });
  }

  // Apply ?direction= from URL (from cross-links)
  if (urlParams.direction && altDirectionBtn) {
    const vals = (altDirectionBtn.dataset.values || '').split(',');
    const labels = (altDirectionBtn.dataset.labels || '').split(',');
    const dirMap = { 'less': 'less', 'greater': 'greater', 'two-sided': 'twosided', 'twosided': 'twosided' };
    const mapped = dirMap[urlParams.direction] || urlParams.direction;
    const idx = vals.indexOf(mapped);
    if (idx >= 0) {
      altDirectionBtn.dataset.value = vals[idx];
      altDirectionBtn.textContent = labels[idx];
    }
  }

  // ─── Generate bar ───

  for (const btn of genBtns) {
    btn.addEventListener('click', () => {
      const count = parseInt(btn.dataset.count, 10);
      if (data1.length === 0) {
        announce('Please load data first.');
        return;
      }
      generateSamples(count);
    });
  }

  /**
   * Generate N samples/permutations and add to the accumulation.
   * @param {number} count
   */
  /** @type {ReturnType<typeof setTimeout>|null} */
  let pendingChartTimer = null;
  function generateSamples(count) {
    // Detect auto-play: skip flying chip animation when play button is active
    const playBtn = document.querySelector('.play-btn');
    const isAutoPlay = playBtn?.getAttribute('aria-pressed') === 'true';
    if (pendingChartTimer !== null) {
      clearTimeout(pendingChartTimer);
      pendingChartTimer = null;
    }
    if (!rng) rng = createRng(seed);

    // Initialize mechanism strip on first generate (deferred from data load)
    if (!mechanismInitialized && mechanismStrip) {
      mechanismInitialized = true;
      if (config.paired && originalContentEl) {
        mechanismStrip.hidden = false;
        initMechanismCollapse(mechanismStrip);
        renderOriginalSample();
      } else if (config.mode === 'bootstrap' && !config.twoGroup && originalContentEl) {
        mechanismStrip.hidden = false;
        initMechanismCollapse(mechanismStrip);
        renderOriginalSample();
        // Auto-default to histogram view for large numeric samples (unless user explicitly chose)
        // Proportions use proportion bars in both views, so no need to switch
        if (!resampleViewExplicit && !config.proportion && data1.length > CHIP_THRESHOLD) {
          setResampleViewMode('histogram');
        }
      } else if (config.twoGroup) {
        mechanismStrip.hidden = false;
        initMechanismCollapse(mechanismStrip);
        renderTwoGroupOriginal();
      }
    }

    // Capture previous state for histogram delta highlight
    const prevLength = allStats.length;

    // Update resample panel title
    if (resampleTitleEl) {
      const verb = config.mode === 'randomization' ? 'Shuffle' : 'Resample';
      resampleTitleEl.textContent = count === 1 ? `This ${verb}` : `Last ${verb}`;
    }

    if (config.mode === 'bootstrap') {
      const statFn = getBootstrapStat().fn;
      /** @type {number[]} */
      let lastResampleValues = [];

      if (config.paired && data2.length > 0) {
        // Paired bootstrap: resample the differences
        const diffs = data2.map((v, i) => v - data1[i]);
        for (let i = 0; i < count; i++) {
          const rs = resample(diffs, rng);
          lastResampleValues = rs;
          allStats.push(statFn(rs));
        }
      } else if (config.twoGroup && data2.length > 0) {
        // Two-sample bootstrap: resample each group independently
        /** @type {number[]} */ let lastRs1 = [];
        /** @type {number[]} */ let lastRs2 = [];
        for (let i = 0; i < count; i++) {
          const rs1 = resample(data1, rng);
          const rs2 = resample(data2, rng);
          lastRs1 = rs1;
          lastRs2 = rs2;
          const stat = statFn(rs1) - statFn(rs2);
          allStats.push(stat);
        }
        twoGroupMorphMs = showTwoGroupMechanism(lastRs1, lastRs2, false, count === 1);
      } else {
        // One-sample bootstrap
        for (let i = 0; i < count; i++) {
          const rs = resample(data1, rng);
          lastResampleValues = rs;
          allStats.push(statFn(rs));
        }
      }

      const ciLevel = parseInt(ciSelect?.value ?? '95', 10);
      let ci = null;
      const CI_MIN = 20; // Don't show CI until this many resamples
      if (allStats.length >= CI_MIN) {
        const result = bootstrapCI([...allStats], ciLevel);
        ci = result.ci;
        displayBootstrapResults(allStats, result.ci, result.se, ciLevel);
      } else {
        resultDiv.innerHTML = `<p><strong>Bootstrap Distribution</strong> (${allStats.length} resamples)</p>
          <p>Need at least ${CI_MIN} resamples for CI estimate.</p>`;
      }
      // Track new data for highlight — always compute dot-level highlights
      if (count === 1) {
        lastStatIndex = allStats.length - 1;
        // For histogram +1: pass the new value directly (no bin alignment issues)
        lastHighlightValue = allStats[allStats.length - 1];
      } else {
        lastHighlightValue = null;
        batchHighlightIndices = new Set();
        for (let j = prevLength; j < allStats.length; j++) {
          batchHighlightIndices.add(j);
        }
      }
      // Batch histogram delta: compute previous bin counts for stacked overlay
      if (count > 1 && allStats.length > DOTPLOT_AUTO_THRESHOLD && prevLength > 0) {
        const domainVals = allStats;
        let lo = Math.min(...domainVals);
        let hi = Math.max(...domainVals);
        const dPad = (hi - lo) * 0.05 || 0.5;
        lo -= dPad; hi += dPad;
        if (preSimDomain) {
          lo = Math.min(lo, preSimDomain[0]);
          hi = Math.max(hi, preSimDomain[1]);
        }
        /** @type {[number,number]} */
        const fullDomain = [lo, hi];
        const histSampleSize = (config.twoGroup && config.proportion && data2.length > 0)
          ? Math.round(data1.length * data2.length / (data1.length + data2.length))
          : data1.length;
        const histThresholds = config.proportion
          ? snappedPropThresholds(histSampleSize, fullDomain, allStats.length)
          : undefined;
        const { bins: fullBins } = computeBins(allStats, {
          domain: fullDomain, thresholds: histThresholds,
          numBins: config.proportion ? undefined : userBinCount,
        });
        const lockedThresholds = fullBins.slice(1).map(b => b.x0);
        const prevStats = allStats.slice(0, prevLength);
        const { bins: prevBins } = computeBins(prevStats, {
          domain: fullDomain, thresholds: lockedThresholds,
        });
        prevBinCounts = prevBins.map(b => b.length);
      }
      // Only show CI lines once we have enough resamples for stability
      const ciForChart = allStats.length >= CI_MIN ? ci : null;

      // Determine if this page uses one-sample mechanism strip
      const showOneSampleMech = !config.twoGroup || config.paired;

      if (count === 1) {
        lastWasSingle = true;
        let mechAnimMs = 0;
        if (showOneSampleMech) {
          lastResample = lastResampleValues;
          mechAnimMs = showResample(lastResampleValues, false, true, !isAutoPlay);
        } else if (config.twoGroup && !config.paired) {
          // Two-group boxplot morph duration (returned from showTwoGroupMechanism above)
          mechAnimMs = twoGroupMorphMs;
        }
        // For two-group, get the diff value element for drop animation
        const bootDiffEl = !showOneSampleMech
          ? document.querySelector('#mech-resample-content .mech-diff')
          : null;
        const bootDiffValueEl = bootDiffEl?.querySelector('.mech-stat-value') ?? null;
        // Wait for mechanism animation to finish, then render chart + drop
        const chartDelay = Math.max(150, mechAnimMs);
        pendingChartTimer = setTimeout(() => {
          pendingChartTimer = null;
          renderChart(allStats, ciForChart);
          const dropSource = bootDiffValueEl || bootDiffEl || resampleMeanEl;
          if (dropSource && chartContainer) {
            animateDropToChart(/** @type {HTMLElement} */ (dropSource), chartContainer);
          }
        }, chartDelay);
      } else {
        lastWasSingle = false;
        renderChart(allStats, ciForChart);
        if (showOneSampleMech) {
          lastResample = lastResampleValues;
          showResample(lastResampleValues, false, false);
        }
      }

      announce(`Generated ${count} resample${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
    } else if (config.paired) {
      // ─── Paired randomization: sign-flip test ───
      const diffs = data2.map((v, i) => v - data1[i]);
      const nullDiff = getNullValue();
      // Center diffs around 0 under H₀: μ_d = δ₀
      const centeredDiffs = nullDiff === 0 ? diffs : diffs.map(d => d - nullDiff);
      const observedStat = mean(centeredDiffs);
      const direction = getDirection();

      /** @type {number[]} */ let lastFlipped = [];
      for (let i = 0; i < count; i++) {
        const flipped = centeredDiffs.map(d => rng() < 0.5 ? d : -d);
        lastFlipped = flipped;
        allStats.push(mean(flipped));
      }

      // Show paired sign-flip mechanism
      lastResample = lastFlipped;
      showPairedMechanism(centeredDiffs, lastFlipped, count === 1);

      // Highlights
      if (count === 1) {
        lastStatIndex = allStats.length - 1;
        lastHighlightValue = allStats[allStats.length - 1];
      } else {
        lastHighlightValue = null;
        batchHighlightIndices = new Set();
        for (let j = prevLength; j < allStats.length; j++) {
          batchHighlightIndices.add(j);
        }
      }
      // Histogram delta for batch
      if (count > 1 && allStats.length > DOTPLOT_AUTO_THRESHOLD && prevLength > 0) {
        const rVals = [...allStats, observedStat];
        let rLo = Math.min(...rVals);
        let rHi = Math.max(...rVals);
        const rPad = (rHi - rLo) * 0.05 || 0.5;
        rLo -= rPad; rHi += rPad;
        if (preSimDomain) {
          rLo = Math.min(rLo, preSimDomain[0]);
          rHi = Math.max(rHi, preSimDomain[1]);
        }
        /** @type {[number,number]} */
        const rDomain = [rLo, rHi];
        const { bins: fullBins } = computeBins(allStats, { domain: rDomain, numBins: userBinCount });
        const lockedThresholds = fullBins.slice(1).map(b => b.x0);
        const prevStats = allStats.slice(0, prevLength);
        const { bins: prevBins } = computeBins(prevStats, { domain: rDomain, thresholds: lockedThresholds });
        prevBinCounts = prevBins.map(b => b.length);
      }

      const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
      displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);

      if (count === 1) {
        lastWasSingle = true;
        pendingChartTimer = setTimeout(() => {
          pendingChartTimer = null;
          renderChart(allStats, null, observedStat, direction);
          if (resampleMeanEl && chartContainer) {
            animateDropToChart(resampleMeanEl, chartContainer);
          }
        }, 150);
      } else {
        lastWasSingle = false;
        renderChart(allStats, null, observedStat, direction);
      }
      announce(`Generated ${count} shuffle${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
    } else {
      const nullDiff = getNullValue();
      const observedStat = config.testStat(data1, data2) - nullDiff;
      const direction = getDirection();

      /** @type {number[]} */ let lastG1 = [];
      /** @type {number[]} */ let lastG2 = [];
      for (let i = 0; i < count; i++) {
        const [g1, g2] = permute(data1, data2, rng);
        lastG1 = g1;
        lastG2 = g2;
        const stat = config.testStat(g1, g2);
        allStats.push(stat);
      }

      twoGroupMorphMs = showTwoGroupMechanism(lastG1, lastG2, false, count === 1);
      // Always compute dot-level highlights
      if (count === 1) {
        lastStatIndex = allStats.length - 1;
        lastHighlightValue = allStats[allStats.length - 1];
      } else {
        lastHighlightValue = null;
        batchHighlightIndices = new Set();
        for (let j = prevLength; j < allStats.length; j++) {
          batchHighlightIndices.add(j);
        }
      }
      if (count > 1 && allStats.length > DOTPLOT_AUTO_THRESHOLD && prevLength > 0) {
        // Histogram mode: compute previous bin counts for stacked delta
        const rVals = observedStat != null ? [...allStats, observedStat] : allStats;
        let rLo = Math.min(...rVals);
        let rHi = Math.max(...rVals);
        const rPad = (rHi - rLo) * 0.05 || 0.5;
        rLo -= rPad; rHi += rPad;
        if (preSimDomain) {
          rLo = Math.min(rLo, preSimDomain[0]);
          rHi = Math.max(rHi, preSimDomain[1]);
        }
        /** @type {[number,number]} */
        const rDomain = [rLo, rHi];
        const rHistSampleSize = (config.twoGroup && config.proportion && data2.length > 0)
          ? Math.round(data1.length * data2.length / (data1.length + data2.length))
          : data1.length;
        const rThresholds = config.proportion
          ? snappedPropThresholds(rHistSampleSize, rDomain, allStats.length)
          : undefined;
        // Bin the FULL dataset first to lock in bin edges
        // Pass same numBins as renderChart to ensure identical bin edges
        const { bins: fullBins } = computeBins(allStats, {
          domain: rDomain, thresholds: rThresholds,
          numBins: config.proportion ? undefined : userBinCount,
        });
        const lockedThresholds = fullBins.slice(1).map(b => b.x0);
        const prevStats = allStats.slice(0, prevLength);
        const { bins: prevBins } = computeBins(prevStats, {
          domain: rDomain, thresholds: lockedThresholds,
        });
        prevBinCounts = prevBins.map(b => b.length);
      }
      const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
      displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);

      if (count === 1) {
        // The diff value gets highlight-last via showTwoGroupMechanism(…, highlight=true)
        const mechDiffEl = document.querySelector('#mech-resample-content .mech-diff');
        // Wait for boxplot morph to finish, then render chart + drop
        const randDelay = Math.max(150, twoGroupMorphMs);
        pendingChartTimer = setTimeout(() => {
          pendingChartTimer = null;
          renderChart(allStats, null, observedStat, direction);
          const dropSourceEl = mechDiffEl || resampleMeanEl;
          if (dropSourceEl && chartContainer) {
            animateDropToChart(/** @type {HTMLElement} */ (dropSourceEl), chartContainer);
          }
        }, randDelay);
      } else {
        renderChart(allStats, null, observedStat, direction);
      }
      announce(`Generated ${count} shuffle${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
    }

    if (resetBtn) resetBtn.hidden = false;
  }

  // ─── Resample visualization ───

  function renderOriginalSample() {
    if (!originalContentEl) return;
    originalContentEl.innerHTML = '';

    if (config.paired && data2.length > 0) {
      // Paired data: show the differences (sorted for easier visual tracking)
      const diffs = data2.map((v, i) => v - data1[i]);
      const sortedDiffs = [...diffs].sort((a, b) => a - b);
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', `Paired differences (${group2Name} − ${group1Name})`);

      if (diffs.length <= CHIP_THRESHOLD) {
        for (const d of sortedDiffs) {
          const dot = document.createElement('span');
          dot.className = 'sample-dot';
          dot.textContent = formatChipValue(d);
          dot.title = String(d);
          container.appendChild(dot);
        }
      } else {
        container.className = 'mini-chart';
        drawHistogram(container, diffs, {
          id: 'orig-hist',
          xLabel: '',
          titleText: `Differences (${group2Name} − ${group1Name})`,
          numBins: Math.min(Math.ceil(Math.sqrt(diffs.length)), 40),
          animate: false,
          margin: { top: 5, right: 10, bottom: 25, left: 35 },
          showExport: false,
        });
      }
      originalContentEl.appendChild(container);

      if (origNEl) origNEl.textContent = `${diffs.length} pairs`;
      if (origMeanEl) origMeanEl.textContent = formatStat(mean(diffs), dataPrecision);
      // Update title to show difference direction
      const diffTitleEl = document.getElementById('orig-diff-title');
      if (diffTitleEl) {
        diffTitleEl.textContent = `Differences (${group2Name} \u2212 ${group1Name})`;
      }
      return;
    }

    if (config.proportion && !config.twoGroup) {
      // One-sample proportion: visual proportion bar
      const successes = data1.filter(v => v === 1).length;
      const failures = data1.length - successes;
      const pHat = mean(data1);
      const pct = (pHat * 100).toFixed(1);
      origPropCache = { successes, failures, pHat };
      const container = document.createElement('div');
      container.className = 'prop-bar-wrap';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', `Original sample: ${successes} successes, ${failures} failures, p-hat = ${formatStat(pHat, dataPrecision, 'proportion')}`);
      container.innerHTML = `
        <div class="mech-prop-bar mech-prop-bar-lg">
          <div class="mech-prop-fill" style="width:${pct}%"></div>
          <span class="mech-prop-label-left">${successes} S</span>
          <span class="mech-prop-label-right">${failures} F</span>
        </div>
      `;
      originalContentEl.appendChild(container);
    } else if (data1.length <= CHIP_THRESHOLD) {
      // Small dataset: show individual value chips
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Original sample values');
      const sorted = [...data1].sort((a, b) => a - b);
      for (const v of sorted) {
        const dot = document.createElement('span');
        dot.className = 'sample-dot';
        dot.textContent = formatChipValue(v);
        dot.title = String(v);
        container.appendChild(dot);
      }
      originalContentEl.appendChild(container);
    } else {
      // Large dataset: show mini histogram + cache bins for morph animation
      const nBins = Math.min(Math.ceil(Math.sqrt(data1.length)), 40);
      const binResult = computeBins(data1, { numBins: nBins });
      // Extract explicit thresholds from computed bin edges
      const thresholds = binResult.bins.slice(1).map(b => b.x0);
      origHistCache = { bins: binResult.bins, thresholds, numBins: nBins };

      const container = document.createElement('div');
      container.className = 'mini-chart';
      drawHistogram(container, data1, {
        id: 'orig-hist',
        xLabel: '',
        titleText: 'Original sample distribution',
        numBins: nBins,
        animate: false,
        margin: { top: 5, right: 10, bottom: 25, left: 35 },
        showExport: false,
      });
      originalContentEl.appendChild(container);
    }

    if (origNEl) origNEl.textContent = String(data1.length);
    if (origMeanEl) {
      if (config.proportion) {
        origMeanEl.textContent = formatStat(mean(data1), dataPrecision, 'proportion');
      } else {
        origMeanEl.textContent = formatStat(mean(data1), dataPrecision);
      }
    }
  }

  // ─── Two-group mechanism strip ───

  /**
   * Build HTML for a two-group panel (shared by original and resample).
   * @param {number[]} g1 - Group 1 values
   * @param {number[]} g2 - Group 2 values
   * @param {boolean} [highlightDiff] - Highlight diff in orange
   * @returns {string} HTML string
   */
  /** Shared x-domain for two-group mini charts (set from original data). */
  let twoGroupChartDomain = /** @type {[number,number]|null} */ (null);
  /** Shared bin count for two-group mini histograms. */
  let twoGroupNumBins = 10;

  /**
   * Build HTML for a two-group panel (shared by original and resample).
   * For non-proportion data, includes mini boxplots. For proportions, shows prop bars.
   * @param {number[]} g1 - Group 1 values
   * @param {number[]} g2 - Group 2 values
   * @param {boolean} [highlightDiff] - Highlight diff value in orange
   * @param {boolean} [isOriginal] - True if rendering the original (left) panel
   * @returns {string} HTML string (boxplot containers are populated after innerHTML set)
   */
  function buildTwoGroupHTML(g1, g2, highlightDiff = false, isOriginal = false) {
    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;
    const statSymbol = config.proportion ? 'p̂' : '<span class="x-bar">x</span>';
    const s1 = statFn(g1);
    const s2 = statFn(g2);
    const fmtType = config.proportion ? 'proportion' : undefined;
    const diffVal = formatStat(s1 - s2, dataPrecision, fmtType);

    let html = '';

    if (config.proportion) {
      // Proportion groups: show S/F chip bars + stats
      const succ1 = g1.filter(v => v === 1).length;
      const fail1 = g1.length - succ1;
      const succ2 = g2.filter(v => v === 1).length;
      const fail2 = g2.length - succ2;
      const pct1 = g1.length > 0 ? (succ1 / g1.length * 100) : 0;
      const pct2 = g2.length > 0 ? (succ2 / g2.length * 100) : 0;

      html += `
        <div class="mech-group-row"><span class="mech-group-name">${group1Name}:</span>
          <span class="mech-group-stat">n = ${g1.length}, ${statSymbol} = ${formatStat(s1, dataPrecision, fmtType)}</span></div>
        <div class="mech-prop-bar" aria-label="${succ1} successes, ${fail1} failures">
          <div class="mech-prop-fill" style="width:${pct1}%"></div>
          <span class="mech-prop-label">${succ1} S / ${fail1} F</span>
        </div>
        <div class="mech-group-row"><span class="mech-group-name">${group2Name}:</span>
          <span class="mech-group-stat">n = ${g2.length}, ${statSymbol} = ${formatStat(s2, dataPrecision, fmtType)}</span></div>
        <div class="mech-prop-bar" aria-label="${succ2} successes, ${fail2} failures">
          <div class="mech-prop-fill" style="width:${pct2}%"></div>
          <span class="mech-prop-label">${succ2} S / ${fail2} F</span>
        </div>`;
    } else {
      // Means: side-by-side mini histograms
      const tag = isOriginal ? 'orig' : 'resamp';
      html += `
        <div class="mech-hist-pair">
          <div class="mech-hist-col">
            <div class="mech-group-label">${group1Name}</div>
            <div id="mech-hist-${tag}-1" class="mech-hist-cell"></div>
            <div class="mech-group-stat-sm">n=${g1.length}, ${statSymbol}=${formatStat(s1, dataPrecision, fmtType)}</div>
          </div>
          <div class="mech-hist-col">
            <div class="mech-group-label">${group2Name}</div>
            <div id="mech-hist-${tag}-2" class="mech-hist-cell"></div>
            <div class="mech-group-stat-sm">n=${g2.length}, ${statSymbol}=${formatStat(s2, dataPrecision, fmtType)}</div>
          </div>
        </div>`;
    }

    const hlClass = highlightDiff ? ' highlight-last' : '';
    html += `<div class="mech-diff">diff = <span class="mech-stat-value${hlClass}">${diffVal}</span></div>`;
    return html;
  }

  /**
   * Render mini histograms into the two-group mechanism containers.
   * Must be called AFTER innerHTML is set (so the containers exist in DOM).
   * @param {number[]} g1 - Group 1 values
   * @param {number[]} g2 - Group 2 values
   * @param {string} tag - 'orig' or 'resamp'
   * @param {boolean} [highlightMean=false] - Highlight mean markers in orange
   */
  function renderTwoGroupCharts(g1, g2, tag, highlightMean = false) {
    if (config.proportion) return;
    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;

    // Set domain and bins from original data (stable across resamples)
    if (tag === 'orig') {
      const allVals = [...g1, ...g2];
      const lo = Math.min(...allVals);
      const hi = Math.max(...allVals);
      const pad = (hi - lo) * 0.08 || 0.5;
      twoGroupChartDomain = [lo - pad, hi + pad];
      twoGroupNumBins = Math.min(Math.max(Math.ceil(Math.sqrt(Math.max(g1.length, g2.length))), 6), 15);
    }

    const cell1 = document.getElementById(`mech-hist-${tag}-1`);
    const cell2 = document.getElementById(`mech-hist-${tag}-2`);
    const prefix = tag === 'orig' ? 'Original' : 'Resampled';
    const opts = {
      width: 180,
      height: 70,
      domain: twoGroupChartDomain ?? undefined,
      numBins: twoGroupNumBins,
      highlightMean,
    };
    if (cell1 && g1.length >= 1) {
      drawMiniChart(cell1, g1, { ...opts, meanValue: statFn(g1), label: `${prefix} ${group1Name}` });
    }
    if (cell2 && g2.length >= 1) {
      drawMiniChart(cell2, g2, { ...opts, meanValue: statFn(g2), label: `${prefix} ${group2Name}` });
    }
  }

  /** Render original group summaries in the mechanism strip. */
  function renderTwoGroupOriginal() {
    if (!mechOriginalContent) return;
    mechOriginalContent.innerHTML = buildTwoGroupHTML(data1, data2, false, true);
    renderTwoGroupCharts(data1, data2, 'orig');
  }

  /**
   * Show the two-group mechanism after a simulation step.
   * @param {number[]} g1 - Group 1 values (resample or shuffled)
   * @param {number[]} g2 - Group 2 values (resample or shuffled)
   * @param {boolean} [_flash] - Unused (kept for call-site compat)
   * @param {boolean} [highlight] - Highlight diff value (+1 animation, auto-fades via CSS)
   */
  function showTwoGroupMechanism(g1, g2, _flash = false, highlight = false) {
    if (!mechResampleContent || !mechanismDescEl) return 0;

    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;
    const fmtType = config.proportion ? 'proportion' : undefined;

    // Can we morph existing histograms? (non-proportion, single-step, charts exist)
    const canMorphCharts = !config.proportion && highlight
      && document.getElementById('mech-hist-resamp-1')?.querySelector('svg.mech-minichart')
      && document.getElementById('mech-hist-resamp-2')?.querySelector('svg.mech-minichart');

    // Can we animate proportion bars? (proportion, single-step, bars already rendered)
    const canAnimateProps = config.proportion && highlight
      && mechResampleContent.querySelector('.mech-prop-bar');

    let morphMs = 0;

    if (canAnimateProps && mechOriginalContent) {
      // Ghost: fade resample panel to low opacity
      const propBars = mechResampleContent.querySelectorAll('.mech-prop-fill');
      const statSpans = mechResampleContent.querySelectorAll('.mech-group-stat');
      const propLabels = mechResampleContent.querySelectorAll('.mech-prop-label');
      const diffSpan = mechResampleContent.querySelector('.mech-stat-value');

      propBars.forEach(b => { /** @type {HTMLElement} */ (b).style.opacity = '0.25'; });
      propLabels.forEach(l => { /** @type {HTMLElement} */ (l).style.opacity = '0.2'; });
      statSpans.forEach(s => { /** @type {HTMLElement} */ (s).style.opacity = '0.2'; });
      if (diffSpan) /** @type {HTMLElement} */ (diffSpan).style.opacity = '0.2';

      // Fire flying dots from original → resample
      flyDataStream(mechOriginalContent, mechResampleContent);

      // After dots are mid-flight, update prop bars to new values
      setTimeout(() => {
        const statSymbol = 'p\u0302';
        const succ1 = g1.filter(v => v === 1).length;
        const fail1 = g1.length - succ1;
        const succ2 = g2.filter(v => v === 1).length;
        const fail2 = g2.length - succ2;
        const pct1 = g1.length > 0 ? (succ1 / g1.length * 100) : 0;
        const pct2 = g2.length > 0 ? (succ2 / g2.length * 100) : 0;
        const s1 = statFn(g1);
        const s2 = statFn(g2);

        // Animate prop bar widths
        const fills = mechResampleContent.querySelectorAll('.mech-prop-fill');
        const labels = mechResampleContent.querySelectorAll('.mech-prop-label');
        if (fills[0]) {
          /** @type {HTMLElement} */ (fills[0]).style.transition = 'width 400ms ease, opacity 300ms ease';
          /** @type {HTMLElement} */ (fills[0]).style.width = `${pct1}%`;
          /** @type {HTMLElement} */ (fills[0]).style.opacity = '1';
        }
        if (fills[1]) {
          /** @type {HTMLElement} */ (fills[1]).style.transition = 'width 400ms ease, opacity 300ms ease';
          /** @type {HTMLElement} */ (fills[1]).style.width = `${pct2}%`;
          /** @type {HTMLElement} */ (fills[1]).style.opacity = '1';
        }

        // Update labels
        if (labels[0]) { labels[0].textContent = `${succ1} S / ${fail1} F`; /** @type {HTMLElement} */ (labels[0]).style.transition = 'opacity 250ms ease'; /** @type {HTMLElement} */ (labels[0]).style.opacity = '1'; }
        if (labels[1]) { labels[1].textContent = `${succ2} S / ${fail2} F`; /** @type {HTMLElement} */ (labels[1]).style.transition = 'opacity 250ms ease'; /** @type {HTMLElement} */ (labels[1]).style.opacity = '1'; }

        // Update stat text
        if (statSpans[0]) { statSpans[0].innerHTML = `n = ${g1.length}, ${statSymbol} = ${formatStat(s1, dataPrecision, fmtType)}`; }
        if (statSpans[1]) { statSpans[1].innerHTML = `n = ${g2.length}, ${statSymbol} = ${formatStat(s2, dataPrecision, fmtType)}`; }
        statSpans.forEach(s => {
          /** @type {HTMLElement} */ (s).style.transition = 'opacity 250ms ease';
          /** @type {HTMLElement} */ (s).style.opacity = '1';
        });

        // Update diff
        const diffVal = formatStat(s1 - s2, dataPrecision, fmtType);
        if (diffSpan) {
          diffSpan.textContent = diffVal;
          diffSpan.classList.add('highlight-last');
          /** @type {HTMLElement} */ (diffSpan).style.transition = 'opacity 250ms ease';
          /** @type {HTMLElement} */ (diffSpan).style.opacity = '1';
        }
      }, 200);

      morphMs = 200 + 400;

    } else if (canMorphCharts && mechOriginalContent) {
      // Ghost: fade resample histograms to low opacity
      const cell1 = /** @type {HTMLElement} */ (document.getElementById('mech-hist-resamp-1'));
      const cell2 = /** @type {HTMLElement} */ (document.getElementById('mech-hist-resamp-2'));
      const svg1 = cell1?.querySelector('svg');
      const svg2 = cell2?.querySelector('svg');
      if (svg1) svg1.style.opacity = '0.25';
      if (svg2) svg2.style.opacity = '0.25';

      // Fade stat text too
      const statSpans = mechResampleContent.querySelectorAll('.mech-group-stat-sm');
      const diffSpan = mechResampleContent.querySelector('.mech-stat-value');
      statSpans.forEach(s => { /** @type {HTMLElement} */ (s).style.opacity = '0.2'; });
      if (diffSpan) /** @type {HTMLElement} */ (diffSpan).style.opacity = '0.2';

      // Fire flying dots from original → resample
      flyDataStream(mechOriginalContent, mechResampleContent);

      // After dots are mid-flight, morph histograms to new data
      setTimeout(() => {
        if (svg1) { svg1.style.transition = 'opacity 400ms ease'; svg1.style.opacity = '1'; }
        if (svg2) { svg2.style.transition = 'opacity 400ms ease'; svg2.style.opacity = '1'; }

        const domainOpt = twoGroupChartDomain ?? undefined;
        const chartOpts = { width: 180, height: 70, domain: domainOpt, numBins: twoGroupNumBins, highlightMean: true };
        if (cell1) morphMiniChart(cell1, g1, { ...chartOpts, meanValue: statFn(g1), label: `Resampled ${group1Name}` });
        if (cell2) morphMiniChart(cell2, g2, { ...chartOpts, meanValue: statFn(g2), label: `Resampled ${group2Name}` });

        // Update stat text
        const statSymbol = config.proportion ? 'p\u0302' : '<span class="x-bar">x</span>';
        statSpans.forEach((s, i) => {
          const gData = i === 0 ? g1 : g2;
          s.innerHTML = `n=${gData.length}, ${statSymbol}=${formatStat(statFn(gData), dataPrecision, fmtType)}`;
          /** @type {HTMLElement} */ (s).style.transition = 'opacity 250ms ease';
          /** @type {HTMLElement} */ (s).style.opacity = '1';
        });

        // Update diff
        const diffVal = formatStat(statFn(g1) - statFn(g2), dataPrecision, fmtType);
        if (diffSpan) {
          diffSpan.textContent = diffVal;
          diffSpan.classList.add('highlight-last');
          /** @type {HTMLElement} */ (diffSpan).style.transition = 'opacity 250ms ease';
          /** @type {HTMLElement} */ (diffSpan).style.opacity = '1';
        }
      }, 200);

      morphMs = 200 + 400;
    } else {
      // Full rebuild (first time or batch)
      mechResampleContent.innerHTML = buildTwoGroupHTML(g1, g2, highlight);
      renderTwoGroupCharts(g1, g2, 'resamp', highlight);
    }

    if (config.mode === 'bootstrap') {
      mechanismDescEl.textContent = 'Resample each group independently with replacement';
    } else {
      mechanismDescEl.textContent = 'Shuffle group labels · same values, new grouping';
    }
    mechanismDescEl.hidden = false;
    return morphMs;
  }

  /**
   * Show the bootstrap resample using the current view mode.
   * @param {number[]} resampleValues
   * @param {boolean} [flash] - Whether to flash the statistic (for +1)
   */
  /**
   * @param {number[]} resampleValues
   * @param {boolean} [flash] - Trigger mechanism flash animation
   * @param {boolean} [highlightStat] - Highlight resample stat orange (+1 only)
   * @returns {number} Animation duration in ms (0 if no animation)
   */
  function showResample(resampleValues, _flash = false, highlightStat = false, flyingAnim = true) {
    if (!resampleContentEl || !bootstrapSampleEl) return 0;
    bootstrapSampleEl.hidden = false;

    // Fire flying dots from original → resample on +1
    if (highlightStat && flyingAnim && originalContentEl && resampleContentEl) {
      flyDataStream(originalContentEl, resampleContentEl);
    }

    let animMs = 0;
    if (resampleViewMode === 'histogram') {
      animMs = showResampleHistogram(resampleValues, highlightStat && flyingAnim);
    } else {
      animMs = showResampleSummary(resampleValues, highlightStat && flyingAnim);
    }

    if (resampleMeanEl) {
      const stat = getBootstrapStat();
      const resampleVal = stat.fn(resampleValues);
      const statKey = bootStatSelect?.value ?? 'mean';

      // Build symbol HTML with proper overline for x-bar
      let symHTML;
      if (config.proportion) {
        symHTML = 'p\u0302';
      } else if (statKey === 'mean') {
        symHTML = '<span class="x-bar">x</span>';
      } else if (statKey === 'median') {
        symHTML = 'median';
      } else if (statKey === 'sd') {
        symHTML = 's';
      } else {
        symHTML = stat.label.replace('Sample ', '').toLowerCase();
      }

      const valText = config.proportion
        ? formatStat(resampleVal, dataPrecision, 'proportion')
        : formatStat(resampleVal, dataPrecision);

      // Update the value span with symbol + value, styled orange
      resampleMeanEl.innerHTML = `${symHTML} = ${valText}`;
      resampleMeanEl.style.color = '#D35400';
      resampleMeanEl.style.fontWeight = '700';

      // Orange highlight class for +1 (used by dot-drop animation source)
      resampleMeanEl.classList.remove('highlight-last');
      if (highlightStat) {
        void resampleMeanEl.offsetWidth;
        resampleMeanEl.classList.add('highlight-last');
      }

      // Update the label span: just "Resample" in the default color
      const statLabelEl = document.getElementById('resample-stat-label');
      if (statLabelEl) {
        statLabelEl.textContent = config.mode === 'randomization' ? 'Shuffled' : 'Resample';
      }
    }
    // Mechanism description: summarize what "with replacement" did
    if (mechanismDescEl) {
      if (config.proportion && !config.twoGroup) {
        const origS = data1.filter(v => v === 1).length;
        const resampS = resampleValues.filter(v => v === 1).length;
        const diff = resampS - origS;
        const sign = diff > 0 ? '+' : '';
        mechanismDescEl.textContent =
          `Resample with replacement · successes changed by ${sign}${diff}`;
      } else {
        /** @type {Map<number, number>} */
        const counts = new Map();
        for (const v of resampleValues) {
          counts.set(v, (counts.get(v) ?? 0) + 1);
        }
        const uniqueOriginal = new Set(data1);
        let notSelected = 0;
        let repeated = 0;
        for (const v of uniqueOriginal) {
          const c = counts.get(v) ?? 0;
          if (c === 0) notSelected++;
          if (c > 1) repeated++;
        }
        mechanismDescEl.textContent =
          `Resample with replacement · ${repeated} value${repeated !== 1 ? 's' : ''} repeated · ${notSelected} not selected`;
      }
      mechanismDescEl.hidden = false;
    }

    return animMs;
  }

  /**
   * Summary view: chips (small n) or text counts (large n).
   * @param {number[]} resampleValues
   * @param {boolean} [stagger=false] - Animate chips appearing sequentially (+1 only)
   * @returns {number} Total animation duration in ms (0 if no animation)
   */
  function showResampleSummary(resampleValues, stagger = false) {
    resampleContentEl.innerHTML = '';

    // Proportion mode: use proportion bar (same as histogram view)
    if (config.proportion && !config.twoGroup) {
      return showResamplePropBar(resampleValues, stagger);
    }

    /** @type {Map<number, number>} */
    const counts = new Map();
    for (const v of resampleValues) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }

    // For paired data, the "original" values are the differences, not data1
    const origValues = (config.paired && data2.length > 0)
      ? data2.map((v, i) => v - data1[i])
      : data1;

    // Should we animate the stagger? Only for small n on +1, with motion allowed
    const shouldStagger = stagger && origValues.length <= CHIP_THRESHOLD && !prefersReducedMotion();

    // Get original chips for draw-link flash animation
    const origChips = shouldStagger && originalContentEl
      ? /** @type {HTMLElement[]} */ ([...originalContentEl.querySelectorAll('.sample-dot')])
      : [];

    if (origValues.length <= CHIP_THRESHOLD) {
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Bootstrap resample values');
      const sorted = [...origValues].sort((a, b) => a - b);
      const remaining = new Map(counts);
      // Pre-count how many positions remain for each value (for fair allocation)
      /** @type {Map<number, number>} */
      const positionsLeft = new Map();
      for (const v of sorted) positionsLeft.set(v, (positionsLeft.get(v) ?? 0) + 1);

      /** @type {{dot: HTMLElement, chipIdx: number}[]} */
      const drawnChips = [];
      /** @type {HTMLElement[]} */
      const notDrawnChips = [];
      for (let chipIdx = 0; chipIdx < sorted.length; chipIdx++) {
        const v = sorted[chipIdx];
        const rem = remaining.get(v) ?? 0;
        const pLeft = positionsLeft.get(v) ?? 1;
        // Allocate draws fairly across chip positions for this value
        const allocated = Math.ceil(rem / pLeft);
        const dot = document.createElement('span');
        dot.className = 'sample-dot';
        if (config.proportion) {
          dot.classList.add(v === 1 ? 'sample-dot--success' : 'sample-dot--failure');
        }
        if (allocated === 0) {
          dot.classList.add('not-drawn');
        } else if (allocated > 1) {
          dot.classList.add('multi-drawn');
        }
        dot.textContent = config.proportion ? (v === 1 ? 'S' : 'F') : formatChipValue(v);
        dot.title = allocated === 0 ? 'Not selected'
          : allocated === 1 ? 'Selected once'
          : `Selected ${allocated} times`;
        if (allocated > 1) {
          const badge = document.createElement('sup');
          badge.className = 'draw-count';
          badge.textContent = `\u00d7${allocated}`;
          dot.appendChild(badge);
        }
        // Stagger: hide chip initially, animate a flying dot from original → resample
        if (shouldStagger && allocated > 0) {
          dot.classList.add('chip-hidden');
          drawnChips.push({ dot, chipIdx });
        } else if (shouldStagger && allocated === 0) {
          dot.classList.add('chip-hidden');
          notDrawnChips.push(dot);
        }
        container.appendChild(dot);
        remaining.set(v, rem - allocated);
        positionsLeft.set(v, pLeft - 1);
      }
      resampleContentEl.appendChild(container);

      // Animate flying dots from original → resample chips
      if (shouldStagger && drawnChips.length > 0) {
        const STAGGER_MS = 60;  // time between each draw
        const FLIGHT_MS = 250;  // flight duration
        for (let i = 0; i < drawnChips.length; i++) {
          const { dot, chipIdx } = drawnChips[i];
          const origChip = origChips[chipIdx];
          const delay = i * STAGGER_MS;

          setTimeout(() => {
            // Flash the source chip
            if (origChip) {
              origChip.classList.add('chip-source-flash');
              setTimeout(() => origChip.classList.remove('chip-source-flash'), 400);

              // Create flying dot
              const origRect = origChip.getBoundingClientRect();
              const destRect = dot.getBoundingClientRect();
              const flyer = document.createElement('span');
              flyer.className = 'chip-flyer';
              flyer.textContent = dot.textContent.replace(/×\d+$/, ''); // strip badge text
              flyer.style.left = origRect.left + 'px';
              flyer.style.top = origRect.top + 'px';
              flyer.style.width = origRect.width + 'px';
              flyer.style.height = origRect.height + 'px';
              document.body.appendChild(flyer);

              // Force reflow then animate to destination
              void flyer.offsetHeight;
              flyer.style.transition = `left ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), top ${FLIGHT_MS}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${FLIGHT_MS * 0.3}ms ease ${FLIGHT_MS * 0.7}ms`;
              flyer.style.left = destRect.left + 'px';
              flyer.style.top = destRect.top + 'px';
              flyer.style.opacity = '0';

              // On arrival: reveal the actual chip, remove the flyer
              setTimeout(() => {
                dot.classList.remove('chip-hidden');
                dot.classList.add('chip-appear');
                flyer.remove();
              }, FLIGHT_MS);
            } else {
              // No original chip (shouldn't happen) — just reveal
              dot.classList.remove('chip-hidden');
              dot.classList.add('chip-appear');
            }
          }, delay);
        }

        // Not-drawn chips fade in after all flights complete
        const notDrawnDelay = drawnChips.length * STAGGER_MS + FLIGHT_MS + 50;
        for (const ndot of notDrawnChips) {
          setTimeout(() => ndot.classList.remove('chip-hidden'), notDrawnDelay);
        }
        return notDrawnDelay + 150; // total animation duration
      }
      return 0;
    } else {
      let notSelected = 0, once = 0, twice = 0, threeOrMore = 0;
      const uniqueOriginal = new Set(data1);
      for (const v of uniqueOriginal) {
        const c = counts.get(v) ?? 0;
        if (c === 0) notSelected++;
        else if (c === 1) once++;
        else if (c === 2) twice++;
        else threeOrMore++;
      }
      const summary = document.createElement('div');
      summary.className = 'resample-summary';
      summary.innerHTML = `
        <div class="resample-bar">
          <span class="rs-chip not-drawn">${notSelected} not selected</span>
          <span class="rs-chip">${once} selected once</span>
          <span class="rs-chip multi-drawn">${twice} selected twice</span>
          ${threeOrMore > 0 ? `<span class="rs-chip multi-drawn">${threeOrMore} selected 3+ times</span>` : ''}
        </div>
      `;
      resampleContentEl.appendChild(summary);
    }
    return 0;
  }

  /**
   * Histogram view: mini histogram of the resample values.
   * When origHistCache is available and morph=true, uses shared bin edges
   * and transitions bars from original heights to resample heights, with
   * brief color highlights on bars that grew or shrank.
   * Also draws a dashed mean line on the resample histogram.
   * @param {number[]} resampleValues
   * @param {boolean} [morph=false] - Animate bar morph from original heights (+1 only)
   * @returns {number} Animation duration in ms (0 if no morph)
   */
  /**
   * Show resample as a proportion bar with morph animation from original proportions.
   * @param {number[]} resampleValues
   * @param {boolean} [animate=false] - Animate bar width transition (+1 only)
   * @returns {number} Animation duration in ms
   */
  function showResamplePropBar(resampleValues, animate = false) {
    const successes = resampleValues.filter(v => v === 1).length;
    const failures = resampleValues.length - successes;
    const pHat = mean(resampleValues);
    const pct = (pHat * 100).toFixed(1);

    const shouldAnimate = animate && origPropCache && !prefersReducedMotion();
    const origPct = origPropCache ? (origPropCache.pHat * 100).toFixed(1) : pct;

    const container = document.createElement('div');
    container.className = 'prop-bar-wrap';
    container.setAttribute('role', 'img');
    container.setAttribute('aria-label', `Resample: ${successes} successes, ${failures} failures`);

    const fill = document.createElement('div');
    fill.className = 'mech-prop-fill';
    // Start at original width if animating, else jump to final
    fill.style.width = shouldAnimate ? `${origPct}%` : `${pct}%`;

    const bar = document.createElement('div');
    bar.className = 'mech-prop-bar mech-prop-bar-lg';
    bar.appendChild(fill);

    const labelL = document.createElement('span');
    labelL.className = 'mech-prop-label-left';
    labelL.textContent = `${successes} S`;
    bar.appendChild(labelL);

    const labelR = document.createElement('span');
    labelR.className = 'mech-prop-label-right';
    labelR.textContent = `${failures} F`;
    bar.appendChild(labelR);

    container.appendChild(bar);
    resampleContentEl.appendChild(container);

    const MORPH_MS = 400;
    const GHOST_PAUSE = 200;
    if (shouldAnimate) {
      // Ghost: show original proportion at low opacity
      bar.style.opacity = '0.25';

      // Hide stat text and labels during ghost phase
      const mechStatEl = resampleMeanEl?.closest('.mechanism-stat');
      if (mechStatEl) {
        /** @type {HTMLElement} */ (mechStatEl).style.opacity = '0';
        /** @type {HTMLElement} */ (mechStatEl).style.transition = 'opacity 250ms ease';
      }
      labelL.style.opacity = '0';
      labelR.style.opacity = '0';

      // After ghost pause, solidify and morph
      setTimeout(() => {
        bar.style.transition = `opacity ${MORPH_MS}ms ease`;
        bar.style.opacity = '1';
        fill.style.transition = `width ${MORPH_MS}ms ease-out`;
        fill.style.width = `${pct}%`;

        // Update and reveal labels + stat text after morph
        labelL.textContent = `${successes} S`;
        labelR.textContent = `${failures} F`;
        labelL.style.transition = 'opacity 200ms ease';
        labelR.style.transition = 'opacity 200ms ease';
        labelL.style.opacity = '1';
        labelR.style.opacity = '1';

        if (mechStatEl) {
          setTimeout(() => {
            /** @type {HTMLElement} */ (mechStatEl).style.opacity = '1';
          }, MORPH_MS);
        }
      }, GHOST_PAUSE);

      return GHOST_PAUSE + MORPH_MS + 250;
    }
    return 0;
  }

  function showResampleHistogram(resampleValues, morph = false) {
    resampleContentEl.innerHTML = '';

    // Proportion mode: use proportion bar instead of histogram
    if (config.proportion && !config.twoGroup) {
      return showResamplePropBar(resampleValues, morph);
    }

    const container = document.createElement('div');
    container.className = 'mini-chart';

    const shouldMorph = morph && origHistCache && !prefersReducedMotion();
    const nBins = origHistCache ? origHistCache.numBins : Math.min(Math.ceil(Math.sqrt(resampleValues.length)), 40);
    // Use same thresholds as original so bars align for visual comparison
    const thresholds = origHistCache ? origHistCache.thresholds : undefined;

    const result = drawHistogram(container, resampleValues, {
      id: 'resample-hist',
      xLabel: '',
      titleText: 'Bootstrap resample distribution',
      numBins: nBins,
      thresholds,
      animate: false,
      margin: { top: 5, right: 10, bottom: 38, left: 35 },
      showExport: false,
    });
    resampleContentEl.appendChild(container);

    // Draw resample statistic line on the histogram (dashed orange)
    // When morphing, start hidden and reveal after bars finish transitioning
    /** @type {SVGElement|null} */
    let meanLineGroup = null;
    if (result && result.xScale && result.frame) {
      const stat = getBootstrapStat();
      const resampleVal = stat.fn(resampleValues);
      const xPos = result.xScale(resampleVal);
      const fh = result.frame.height;
      const overlays = d3Selection.select(result.frame.inner).select('.overlays');
      const g = overlays.append('g')
        .attr('class', 'resample-mean-group')
        .style('opacity', shouldMorph ? '0' : '1');
      meanLineGroup = /** @type {SVGElement} */ (g.node());
      g.append('line')
        .attr('x1', xPos).attr('x2', xPos)
        .attr('y1', 0).attr('y2', fh)
        .attr('stroke', '#D35400')
        .attr('stroke-width', 3)
        .attr('stroke-dasharray', '6,3');
      // Symbol label below x-axis, centered on the dashed line
      const statKey = bootStatSelect?.value ?? 'mean';
      const labelY = fh + 22;
      const fontSize = 1.15; // em
      if (statKey === 'mean' && !config.proportion) {
        // Draw x with a manually positioned overline (combining char is unreliable in SVG)
        const xText = g.append('text')
          .attr('x', xPos).attr('y', labelY)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', '#D35400')
          .attr('stroke', 'white')
          .attr('stroke-width', 3)
          .attr('paint-order', 'stroke')
          .attr('font-size', `${fontSize}em`)
          .attr('font-weight', '700')
          .text('x');
        // Overline: white shadow for contrast, then colored bar
        const barY = labelY - 9;
        g.append('line')
          .attr('x1', xPos - 7).attr('x2', xPos + 7)
          .attr('y1', barY).attr('y2', barY)
          .attr('stroke', 'white')
          .attr('stroke-width', 5)
          .attr('stroke-linecap', 'round');
        g.append('line')
          .attr('x1', xPos - 6).attr('x2', xPos + 6)
          .attr('y1', barY).attr('y2', barY)
          .attr('stroke', '#D35400')
          .attr('stroke-width', 2)
          .attr('stroke-linecap', 'round');
      } else {
        const sym = config.proportion ? 'p\u0302'
          : statKey === 'median' ? 'M\u0303'
          : statKey === 'sd' ? 's' : stat.label.split(' ').pop() || '';
        g.append('text')
          .attr('x', xPos).attr('y', labelY)
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'central')
          .attr('fill', '#D35400')
          .attr('stroke', 'white')
          .attr('stroke-width', 3)
          .attr('paint-order', 'stroke')
          .attr('font-size', `${fontSize}em`)
          .attr('font-weight', '700')
          .text(sym);
      }
    }

    if (!shouldMorph || !result || !origHistCache) return 0;

    // Hide the resample stat text during morph — it will be revealed after bars finish
    const mechStatEl = resampleMeanEl?.closest('.mechanism-stat');
    if (mechStatEl) {
      /** @type {HTMLElement} */ (mechStatEl).style.opacity = '0';
      /** @type {HTMLElement} */ (mechStatEl).style.transition = 'opacity 250ms ease';
    }

    // Build a map of original bin counts keyed by bin x0
    /** @type {Map<number, number>} */
    const origCounts = new Map();
    for (const b of origHistCache.bins) {
      origCounts.set(b.x0, b.length);
    }

    // Morph animation using CSS transitions on SVG rect attributes
    const svg = container.querySelector('svg');
    if (!svg) return 0;
    const rects = /** @type {SVGRectElement[]} */ ([...svg.querySelectorAll('.data rect')]);
    const { yScale, frame } = result;
    if (!yScale || !frame) return 0;
    const innerHeight = frame.height;

    const MORPH_MS = 450;
    const FADE_MS = 600;
    const GROW_FILL = '#2A6496'; // dark blue — bar grew (more values landed here)
    const SHRINK_FILL = '#B8D4E8'; // light blue — bar shrank (fewer values here)
    const DEFAULT_FILL = '#569BBD80';

    // Record final (resample) positions, then snap to original positions as ghost
    /** @type {Array<{rect: SVGRectElement, finalY: string, finalH: string, grew: boolean, shrank: boolean}>} */
    const morphData = [];

    for (const rect of rects) {
      const finalY = rect.getAttribute('y') || '0';
      const finalH = rect.getAttribute('height') || '0';

      // Parse bin x0 from the aria-label ("x0 to x1: count")
      const label = rect.getAttribute('aria-label') || '';
      const x0Match = label.match(/^([\d.e+-]+)\s+to/);
      const x0 = x0Match ? parseFloat(x0Match[1]) : NaN;

      const origCount = isNaN(x0) ? 0 : (origCounts.get(x0) ?? 0);
      const resampleBin = result.bins.find(b => Math.abs(b.x0 - x0) < 1e-10);
      const newCount = resampleBin ? resampleBin.length : 0;
      const grew = newCount > origCount;
      const shrank = newCount < origCount;

      // Snap bar to original height
      const origY = origCount > 0 ? yScale(origCount) : innerHeight;
      const origH = innerHeight - origY;
      rect.setAttribute('y', String(origY));
      rect.setAttribute('height', String(Math.max(0, origH)));

      morphData.push({ rect, finalY, finalH, grew, shrank });
    }

    // Ghost: show bars at low opacity (faded copy of original)
    const GHOST_OPACITY = 0.25;
    const svgNode = /** @type {SVGSVGElement} */ (svg);
    svgNode.style.opacity = String(GHOST_OPACITY);

    /** @type {Array<{rect: SVGRectElement, startY: number, startH: number, endY: number, endH: number, grew: boolean, shrank: boolean}>} */
    const animItems = morphData.map(({ rect, finalY, finalH, grew, shrank }) => ({
      rect,
      startY: parseFloat(rect.getAttribute('y') || '0'),
      startH: parseFloat(rect.getAttribute('height') || '0'),
      endY: parseFloat(finalY),
      endH: parseFloat(finalH),
      grew, shrank,
    }));

    // Delay morph start so ghost is visible briefly while dots fly
    const GHOST_PAUSE = 200;
    setTimeout(() => {
      // Apply highlight colors at morph start
      for (const { rect, grew, shrank } of animItems) {
        if (grew) rect.setAttribute('fill', GROW_FILL);
        else if (shrank) rect.setAttribute('fill', SHRINK_FILL);
      }

      const startTime = performance.now();
      /** Ease-out cubic */
      function easeOut(/** @type {number} */ t) { return 1 - Math.pow(1 - t, 3); }

      function morphFrame(/** @type {number} */ now) {
        const elapsed = now - startTime;
        const t = Math.min(1, elapsed / MORPH_MS);
        const e = easeOut(t);

        // Morph bar geometry
        for (const { rect, startY, startH, endY, endH } of animItems) {
          const y = startY + (endY - startY) * e;
          const h = startH + (endH - startH) * e;
          rect.setAttribute('y', String(y));
          rect.setAttribute('height', String(Math.max(0, h)));
        }

        // Solidify: ghost opacity → full opacity during morph
        const opacity = GHOST_OPACITY + (1 - GHOST_OPACITY) * e;
        svgNode.style.opacity = String(opacity);

        if (t < 1) {
          requestAnimationFrame(morphFrame);
        } else {
          svgNode.style.opacity = '1';
          // Morph complete — reveal the mean line and stat text, then fade bar colors
          if (meanLineGroup) {
            meanLineGroup.style.transition = 'opacity 250ms ease';
            meanLineGroup.style.opacity = '1';
          }
          if (mechStatEl) {
            /** @type {HTMLElement} */ (mechStatEl).style.opacity = '1';
          }
          fadeColors();
        }
      }
      requestAnimationFrame(morphFrame);
    }, GHOST_PAUSE);

    function fadeColors() {
      // SVG fill IS a CSS presentation property, so CSS transition works here
      for (const { rect, grew, shrank } of animItems) {
        if (!grew && !shrank) continue;
        rect.style.transition = `fill ${FADE_MS}ms ease`;
        rect.setAttribute('fill', DEFAULT_FILL);
      }
      setTimeout(() => {
        for (const { rect } of animItems) {
          rect.style.transition = '';
        }
      }, FADE_MS);
    }

    // Return time until dot should drop: ghost pause + morph + brief pause after mean line
    // (color fade continues in background but shouldn't delay the dot drop)
    return GHOST_PAUSE + MORPH_MS + 300;
  }

  /**
   * Display paired randomization mechanism: original diffs → sign-flipped diffs.
   * Shows which differences had their sign flipped, with a clear visual indicator.
   * @param {number[]} originalDiffs - The original paired differences
   * @param {number[]} flippedDiffs - The sign-flipped differences
   * @param {boolean} highlightStat - Whether to highlight the resulting statistic
   */
  function showPairedMechanism(originalDiffs, flippedDiffs, highlightStat) {
    if (!resampleContentEl || !bootstrapSampleEl) return;
    bootstrapSampleEl.hidden = false;

    resampleContentEl.innerHTML = '';

    if (originalDiffs.length <= CHIP_THRESHOLD) {
      // Small n: show aligned chips with flip indicators
      const container = document.createElement('div');
      container.className = 'sample-dots paired-flip-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Sign-flipped differences');

      const shouldAnimate = highlightStat && !prefersReducedMotion();
      for (let i = 0; i < flippedDiffs.length; i++) {
        const orig = originalDiffs[i];
        const flipped = flippedDiffs[i];
        const wasFlipped = Math.sign(orig) !== 0 && Math.sign(orig) !== Math.sign(flipped);

        const dot = document.createElement('span');
        dot.className = 'sample-dot' + (wasFlipped ? ' sign-flipped' : '');
        dot.textContent = formatChipValue(flipped);
        dot.title = wasFlipped
          ? `${formatChipValue(orig)} → ${formatChipValue(flipped)} (flipped)`
          : `${formatChipValue(orig)} (kept)`;
        if (wasFlipped) {
          const badge = document.createElement('sup');
          badge.className = 'flip-badge';
          badge.textContent = '\u00b1';
          dot.appendChild(badge);
          // Animate: scaleX flip with stagger
          if (shouldAnimate) {
            dot.style.animationDelay = `${i * 20}ms`;
            dot.classList.add('chip-flip');
          }
        }
        container.appendChild(dot);
      }
      resampleContentEl.appendChild(container);
    } else {
      // Large n: summary counts
      let flippedCount = 0;
      let keptCount = 0;
      for (let i = 0; i < originalDiffs.length; i++) {
        const wasFlipped = Math.sign(originalDiffs[i]) !== 0
          && Math.sign(originalDiffs[i]) !== Math.sign(flippedDiffs[i]);
        if (wasFlipped) flippedCount++;
        else keptCount++;
      }
      const summary = document.createElement('div');
      summary.className = 'resample-summary';
      summary.innerHTML = `
        <div class="resample-bar">
          <span class="rs-chip">${keptCount} kept original sign</span>
          <span class="rs-chip sign-flipped">${flippedCount} sign flipped</span>
        </div>
      `;
      resampleContentEl.appendChild(summary);
    }

    // Update stat value: "Shuffled" (dark) + "x̄ = value" (orange)
    if (resampleMeanEl) {
      const resampleVal = mean(flippedDiffs);
      const valText = formatStat(resampleVal, dataPrecision);
      resampleMeanEl.innerHTML = `<span class="x-bar">x</span> = ${valText}`;
      resampleMeanEl.style.color = '#D35400';
      resampleMeanEl.style.fontWeight = '700';
      resampleMeanEl.classList.remove('highlight-last');
      if (highlightStat) {
        void resampleMeanEl.offsetWidth;
        resampleMeanEl.classList.add('highlight-last');
      }
      const statLabelEl = document.getElementById('resample-stat-label');
      if (statLabelEl) statLabelEl.textContent = 'Shuffled';
    }

    // Mechanism description
    if (mechanismDescEl) {
      let flippedCount = 0;
      for (let i = 0; i < originalDiffs.length; i++) {
        if (Math.sign(originalDiffs[i]) !== 0
            && Math.sign(originalDiffs[i]) !== Math.sign(flippedDiffs[i])) {
          flippedCount++;
        }
      }
      mechanismDescEl.textContent =
        `Randomly flip signs · ${flippedCount} of ${originalDiffs.length} differences flipped`;
      mechanismDescEl.hidden = false;
    }
  }

  // Replace single toggle button with segmented control
  /** @type {HTMLButtonElement|null} */
  let btnSummary = null;
  /** @type {HTMLButtonElement|null} */
  let btnHistogram = null;

  /**
   * Switch resample view mode and update toggle UI.
   * @param {'summary'|'histogram'} mode
   */
  function setResampleViewMode(mode) {
    resampleViewMode = mode;
    if (btnSummary) btnSummary.setAttribute('aria-pressed', String(mode === 'summary'));
    if (btnHistogram) btnHistogram.setAttribute('aria-pressed', String(mode === 'histogram'));
    if (lastResample.length > 0) showResample(lastResample, false, lastWasSingle);
  }

  if (resampleToggle) {
    const seg = document.createElement('div');
    seg.className = 'seg-control';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Resample view');

    btnSummary = /** @type {HTMLButtonElement} */ (document.createElement('button'));
    btnSummary.type = 'button';
    btnSummary.textContent = 'Summary';
    btnSummary.setAttribute('aria-pressed', 'true');

    btnHistogram = /** @type {HTMLButtonElement} */ (document.createElement('button'));
    btnHistogram.type = 'button';
    btnHistogram.textContent = 'Histogram';
    btnHistogram.setAttribute('aria-pressed', 'false');

    seg.appendChild(btnSummary);
    seg.appendChild(btnHistogram);
    resampleToggle.replaceWith(seg);

    btnSummary.addEventListener('click', () => { resampleViewExplicit = true; setResampleViewMode('summary'); });
    btnHistogram.addEventListener('click', () => { resampleViewExplicit = true; setResampleViewMode('histogram'); });
  }

  // Re-render when CI level changes
  if (ciSelect) {
    ciSelect.addEventListener('change', () => {
      if (allStats.length >= 10) {
        const ciLevel = parseInt(ciSelect.value, 10);
        const result = bootstrapCI([...allStats], ciLevel);
        displayBootstrapResults(allStats, result.ci, result.se, ciLevel);
        const CI_MIN = 20;
        renderChart(allStats, allStats.length >= CI_MIN ? result.ci : null);
      }
    });
  }

  // Reset when bootstrap stat changes (mixing stats would be meaningless)
  if (bootStatSelect) {
    bootStatSelect.addEventListener('change', () => {
      if (allStats.length > 0) {
        resetSimulation();
        // Re-show original sample since data is still loaded
        if (data1.length > 0) {
          showDataLoaded();
        }
        announce(`Statistic changed to ${getBootstrapStat().label}. Simulation reset.`);
      }
    });
  }

  /**
   * Format a value for display in a chip.
   * Uses fewer decimals for integers, more for precise values.
   * @param {number} v
   * @returns {string}
   */
  function formatChipValue(v) {
    if (Number.isInteger(v)) return String(v);
    return formatStat(v, dataPrecision);
  }

  // ─── Reset ───

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetSimulation();
      announce('Simulation reset.');
    });
  }

  function resetSimulation() {
    allStats = [];
    rng = null;
    lockedDotGrid = null;
    mechanismInitialized = false;
    origHistCache = null;
    origPropCache = null;
    // New random seed each reset (unless URL-locked for graded work)
    if (!urlSeed) {
      seed = Math.random().toString(36).slice(2, 10);
    }
    chartContainer.innerHTML = '';
    resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'run a simulation to see results')}</p>`;
    if (resetBtn) resetBtn.hidden = true;
    if (bootstrapSampleEl) bootstrapSampleEl.hidden = true;
    if (mechResampleContent) mechResampleContent.innerHTML = '';
    if (mechanismDescEl) mechanismDescEl.hidden = true;
    // Hide mechanism strip (will re-show on next first generate)
    if (mechanismStrip) mechanismStrip.hidden = true;
  }

  // ─── Chart rendering ───

  // Resample panel title element (dynamic: "This Resample" vs "Last Resample")
  const resampleTitleEl = document.getElementById('resample-title');

  /**
   * @param {number[]} stats
   * @param {[number,number]} [ci]
   * @param {number} [observedStat]
   * @param {'left'|'right'|'both'} [direction]
   */
  function renderChart(stats, ci, observedStat, direction) {
    chartContainer.innerHTML = '';
    const n = stats.length;
    // Cache params for chart type toggle re-render
    lastCI = ci;
    lastObserved = observedStat;
    lastDirection = direction;
    const titleText = `${config.mode === 'bootstrap' ? 'Bootstrap' : 'Randomization'} Distribution`;
    let xLabel;
    if (config.mode === 'bootstrap') {
      if (config.proportion) {
        xLabel = config.twoGroup ? 'Diff in Proportions' : 'Sample Proportion (p̂)';
      } else if (config.paired) {
        xLabel = 'Mean Difference';
      } else {
        const sl = getBootstrapStat().label;
        xLabel = config.twoGroup ? `Diff in ${sl}s` : sl;
      }
    } else {
      xLabel = config.statLabel ?? '';
    }

    // Compute domain
    /** @type {[number,number]|undefined} */
    let domain;
    if (stats.length > 0) {
      const vals = observedStat != null ? [...stats, observedStat] : stats;
      let lo = Math.min(...vals);
      let hi = Math.max(...vals);
      const pad = (hi - lo) * 0.05 || 0.5;
      lo -= pad;
      hi += pad;
      // Never shrink below the pre-simulated domain
      if (preSimDomain) {
        lo = Math.min(lo, preSimDomain[0]);
        hi = Math.max(hi, preSimDomain[1]);
      }
      domain = [lo, hi];
    } else if (preSimDomain) {
      domain = preSimDomain;
    }

    // Highlight new dots in dotplot mode
    const highlightIndex = lastStatIndex >= 0 ? lastStatIndex : -1;
    const highlightIndices = batchHighlightIndices ?? undefined;
    // For two-group proportions, the step between possible difference values
    // is 1/n₁ + 1/n₂ (not 1/n). Use harmonic mean so snappedPropThresholds
    // produces bins aligned to the actual discrete grid.
    const sampleSize = (config.twoGroup && config.proportion && data2.length > 0)
      ? Math.round(data1.length * data2.length / (data1.length + data2.length))
      : data1.length;

    // For proportion histogram: snap bin edges to k/n grid so bars touch
    /** @type {number[]|undefined} */
    let propThresholds;
    if (config.proportion && domain) {
      propThresholds = snappedPropThresholds(sampleSize, domain, n);
    }

    // Determine which chart type to render
    const activeChart = resolveChartType(n, chartType);

    // Sync toggle radios and bin adjuster label to reflect actual chart type
    if (setToggleSelected) setToggleSelected(activeChart);
    if (binAdjuster) binAdjuster.setMode(/** @type {'dotplot'|'histogram'} */ (activeChart));
    // Build region-of-interest predicate
    // Randomization: extreme values (tail) are the region of interest
    // Bootstrap CI: values inside the CI are the region of interest
    /** @type {((v: number) => boolean)|undefined} */
    let regionPredicate;
    if (config.mode === 'randomization' && observedStat != null && direction) {
      regionPredicate = (v) => isExtreme(v, observedStat, direction);
    } else if (config.mode === 'bootstrap' && ci) {
      regionPredicate = (v) => v >= ci[0] && v <= ci[1];
    }

    /** @type {import('./chart-utils.js').ChartFrame|undefined} */
    let chartResult;
    /** @type {any} */
    let chartXScale;
    // Bootstrap: inside CI = blue (region), outside = gray (de-emphasized)
    // Randomization: tail = darker blue (extreme), body = blue (normal)
    const isBootstrap = config.mode === 'bootstrap';
    const dotBaseFill = isBootstrap && ci ? '#a0a0a0' : undefined;   // gray for outside-CI
    const dotExtremeFill = isBootstrap && ci ? '#569BBD' : undefined; // blue for inside-CI

    if (activeChart === 'dotplot') {
      const r = drawDotplot(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText,
        isExtreme: regionPredicate,
        observedStat,
        ciLines: ci ?? undefined,
        animate: false,
        domain,
        numBins: config.proportion ? sampleSize : userBinCount,
        binWidth: lockedDotGrid?.binWidth ?? (config.proportion ? 1 / sampleSize : undefined),
        binOrigin: lockedDotGrid?.binOrigin,
        highlightIndex,
        highlightIndices,
        precision: config.proportion ? Math.max(dataPrecision + 1, 3) : dataPrecision + 1,
        baseFill: dotBaseFill,
        extremeFill: dotExtremeFill,
      });
      chartResult = r.frame;
      chartXScale = r.xScale;
      const maxStack = r.dots.reduce((m, d) => Math.max(m, d.stackIndex + 1), 0);
      const effectiveBins = (config.proportion ? sampleSize : userBinCount)
        ?? (lockedDotGrid && domain ? Math.ceil((domain[1] - domain[0]) / lockedDotGrid.binWidth) : null)
        ?? DEFAULT_BINS;
      lastDotResult = { xScale: r.xScale, frame: r.frame, domain: domain || [0, 1], maxStack, numBins: effectiveBins };
      lastHistResult = null;
    } else if (activeChart === 'spike') {
      const r = drawSpike(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText,
        isTail: regionPredicate,
        observedStat: observedStat ?? undefined,
        ciLines: ci ?? undefined,
        animate: false,
        domain,
      });
      chartResult = r.frame;
      chartXScale = r.xScale;
    } else {
      const r = drawHistogram(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText,
        isTail: regionPredicate,
        observedStat: observedStat ?? undefined,
        ciLines: ci ?? undefined,
        animate: false,
        domain,
        thresholds: propThresholds,
        numBins: userBinCount,
        prevBinCounts: prevBinCounts ?? undefined,
        highlightValue: lastHighlightValue ?? undefined,
        precision: config.proportion ? Math.max(dataPrecision + 1, 3) : dataPrecision + 1,
      });
      chartResult = r.frame;
      chartXScale = r.xScale;
      lastHistResult = { xScale: r.xScale, yScale: r.yScale, bins: r.bins, domain: domain || [0, 1] };
      lastDotResult = null;
    }

    // Add probability pills
    if (chartResult && chartXScale && stats.length > 0) {
      if (config.mode === 'randomization' && observedStat != null && direction) {
        const { pValue } = permutationPValue(stats, observedStat, direction);
        renderSimPills(chartResult, chartXScale, {
          mode: 'randomization', pValue, observedStat, direction,
        });
      } else if (config.mode === 'bootstrap' && ci) {
        const inside = stats.filter(v => v >= ci[0] && v <= ci[1]).length;
        const proportion = inside / stats.length;
        renderSimPills(chartResult, chartXScale, {
          mode: 'bootstrap',
          proportionLabel: formatStat(proportion, dataPrecision, 'proportion'),
          ci,
        });
      }
    }

    // Theory overlay (histogram or dotplot, bootstrap mode only)
    if (theoryOverlayOn && (activeChart === 'histogram' || activeChart === 'dotplot') && config.mode === 'bootstrap') {
      applyTheoryOverlay(stats);
    }

    lastStatIndex = -1; // Reset after rendering
    batchHighlightIndices = null;
    prevBinCounts = null;
    lastHighlightValue = null;
  }

  /** @type {(v: number, obs: number, dir?: 'left'|'right'|'both') => boolean} */
  const isExtreme = isExtremeShared;

  // renderSimPills and _addSimPill are now in chart-utils.js

  function displayBootstrapResults(stats, ci, se, ciLevel) {
    const m = mean(stats);
    let statLabel, paramLabel, paramName;
    if (config.paired) {
      statLabel = 'Mean Difference';
      paramLabel = `Mean Difference (${group2Name} − ${group1Name})`;
      paramName = `true mean difference (${group2Name} − ${group1Name})`;
    } else if (config.proportion) {
      statLabel = 'Sample Proportion';
      paramLabel = config.twoGroup
        ? `Difference in ${statLabel}s (${group1Name} − ${group2Name})`
        : statLabel;
      paramName = config.twoGroup
        ? 'difference in population proportions'
        : 'true population proportion';
    } else {
      statLabel = getBootstrapStat().label;
      paramLabel = config.twoGroup
        ? `Difference in ${statLabel}s (${group1Name} − ${group2Name})`
        : statLabel;
      const longLabel = getBootstrapStat().longLabel;
      paramName = config.twoGroup
        ? `difference in population ${longLabel}s`
        : `true population ${longLabel}`;
    }
    // Contextual interpretation using dataset metadata
    const ctx = datasetContext;
    const bootLong = getBootstrapStat().longLabel;
    // Adapt context parameter to current stat (e.g. "mean mercury level" → "standard deviation of mercury level")
    let ctxParam;
    if (ctx.parameter) {
      // Replace leading "mean"/"median"/etc with current stat's long label
      const adapted = ctx.parameter.replace(/^(mean|median|standard deviation|first quartile|third quartile)\b/i, bootLong);
      // If no replacement happened (e.g. "difference in ..."), prepend the stat
      ctxParam = adapted === ctx.parameter && !ctx.parameter.toLowerCase().startsWith(bootLong)
        ? `population ${bootLong} of ${ctx.parameter}`
        : `population ${adapted}`;
    } else {
      ctxParam = paramName;
    }
    const unitSuffix = ctx.unit ? ` ${ctx.unit}` : '';
    const popPhrase = ctx.population ? ` for ${ctx.population}` : '';
    /** @param {number} v */
    const fmt = (v) => config.proportion ? formatStat(v, dataPrecision, 'proportion') : formatStat(v, dataPrecision);
    const ciLo = `<span class="ci-value">${fmt(ci[0])}</span>`;
    const ciHi = `<span class="ci-value">${fmt(ci[1])}</span>`;
    resultDiv.innerHTML = `
      <p><strong>Bootstrap Distribution</strong> (${stats.length} resamples)</p>
      <p>${paramLabel}: ${fmt(m)}</p>
      <p>SE: ${fmt(se)}</p>
      <p><strong>${ciLevel}% Confidence Interval:</strong> (${ciLo}, ${ciHi})</p>
      <p class="interpretation">The middle ${ciLevel}% of bootstrap ${bootLong}s fall between ${ciLo}${unitSuffix} and ${ciHi}${unitSuffix}.</p>
      <p class="interpretation">We are ${ciLevel}% confident that the ${ctxParam}${popPhrase} is between ${ciLo}${unitSuffix} and ${ciHi}${unitSuffix}.</p>
      ${stats.length < 50 ? '<p class="hint">CI is approximate with few resamples. Generate more for stability.</p>' : ''}
    `;
  }

  /**
   * @param {number[]} stats
   * @param {number} observedStat
   * @param {number} pValue
   * @param {number} extremeCount
   * @param {'left'|'right'|'both'} direction
   */
  function displayRandomizationResults(stats, observedStat, pValue, extremeCount, direction) {
    const dirLabel = direction === 'both' ? 'two-sided'
      : direction === 'right' ? 'right-tail' : 'left-tail';
    const nullDiff = getNullValue();
    // Show the raw (unshifted) observed difference for display
    const rawObserved = observedStat + nullDiff;
    let obsLabel;
    if (config.proportion) {
      obsLabel = `p̂<sub>${group1Name}</sub> − p̂<sub>${group2Name}</sub> = <span class="observed-value">${formatStat(rawObserved, dataPrecision, 'proportion')}</span>`;
    } else if (config.twoGroup) {
      obsLabel = `<span class="x-bar">x</span><sub>${group1Name}</sub> − <span class="x-bar">x</span><sub>${group2Name}</sub> = <span class="observed-value">${formatStat(rawObserved, dataPrecision)}</span>`;
    } else {
      obsLabel = `<span class="observed-value">${formatStat(rawObserved, dataPrecision)}</span>`;
    }
    // Plain-language interpretation
    let strength;
    if (pValue < 0.01) strength = 'very strong';
    else if (pValue < 0.05) strength = 'strong';
    else if (pValue < 0.10) strength = 'moderate';
    else strength = 'little';
    const defaultNull = config.proportion
      ? 'no difference in population proportions'
      : nullDiff === 0
        ? 'no difference in population means'
        : `a difference of ${formatStat(nullDiff, dataPrecision)} in population means`;
    const nullDesc = datasetContext.nullClaim || defaultNull;
    const pFmt = formatStat(pValue, 0, 'pvalue');
    const pDisplay = pFmt.startsWith('p') ? pFmt : `p-value: ${pFmt}`;
    resultDiv.innerHTML = `
      <p><strong>Randomization Distribution</strong> (${stats.length} shuffles)</p>
      <p>Observed statistic: ${obsLabel}</p>
      <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
      <p><strong>${pDisplay}</strong></p>
      <p class="interpretation">${extremeCount} of ${stats.length} shuffled statistics were at least as extreme as the observed value. This provides ${strength} evidence against H₀: ${nullDesc}.</p>
    `;
  }

  function announce(msg) {
    if (announceDiv) announceDiv.textContent = msg;
  }

  // ─── Keyboard shortcuts ───

  const helpDialog = /** @type {HTMLDialogElement} */ (document.getElementById('keyboard-help'));
  if (helpDialog) {
    document.addEventListener('keydown', (e) => {
      if (e.target !== document.body) return;
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === '?') helpDialog.showModal();
      if (e.key === '1') genBtns[0]?.click();
      if (e.key === '2') genBtns[1]?.click();
      if (e.key === '3') genBtns[2]?.click();
      if (e.key === '4') genBtns[3]?.click();
      if (e.key === '0' && resetBtn && !resetBtn.hidden) resetBtn.click();
    });
    const closeBtn = helpDialog.querySelector('button');
    if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
  }

  initPlayPause(genBtns, resetBtn);
}
