// @ts-check
/**
 * Shared simulation page logic for StatBench.
 * Handles data input (URL params, paste), simulation controls, chart rendering, and results.
 */

import { parseParams } from './url-params.js';
import { parseCSV } from './csv-parser.js';
import { createRng } from './prng.js';
import { mean, median, sd, quantile, resample, permute, detectPrecision, formatStat } from './stats.js';
import { bootstrapCI, permutationPValue } from './sim-engine.js';
import * as d3Selection from 'd3-selection';
import { drawHistogram, computeBins, snappedPropThresholds } from './histogram.js';
import { drawDotplot } from './dotplot.js';
import { drawSpike } from './spike.js';
import { renderSimPills } from './chart-utils.js';
import { initPlayPause, setupFileInput, initHelp, initMechanismCollapse, animateDropToChart } from './page-utils.js';
import { normalPdf, overlayTheoryCurve, removeTheoryOverlay, createTheoryToggle } from './theory-overlay.js';
import { rowsToCSV, downloadCSV } from './csv-parser.js';
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
  const pasteArea = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-area'));
  const loadPastedBtn = document.getElementById('load-pasted');
  const clearBtn = document.getElementById('clear-btn');
  const saveBtn = document.getElementById('save-btn');
  const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
  const datasetDesc = document.getElementById('dataset-desc');
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

  // Mechanism strip elements
  const mechanismStrip = document.getElementById('mechanism-strip');
  const mechanismDescEl = document.getElementById('mechanism-description');

  // One-sample bootstrap mechanism (specific elements)
  const originalContentEl = document.getElementById('original-sample-content');
  const resampleContentEl = document.getElementById('resample-content');
  const bootstrapSampleEl = document.getElementById('bootstrap-sample');
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
  /** @type {number[]} */
  let lastResample = [];
  /** Whether the last generate action was +1 (for persistent highlight). */
  let lastWasSingle = false;

  /** Dataset context for natural-language interpretations. */
  /** @type {{population?:string, parameter?:string, unit?:string, nullClaim?:string, successLabel?:string}} */
  let datasetContext = {};

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
  /** Previous histogram bin counts for stacked delta highlight. */
  /** @type {number[]|null} */
  let prevBinCounts = null;
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
  /** Cached histogram result for theory overlay. */
  /** @type {{ xScale: any, yScale: any, bins: any[], domain: [number,number] } | null} */
  let lastHistResult = null;
  /** Cached dotplot result for theory overlay on dotplots. */
  /** @type {{ xScale: any, frame: any, domain: [number,number] } | null} */
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
          renderChart(allStats, lastCI, lastObserved, lastDirection);
        }
      },
    });
    toggleFieldset = toggle.fieldset;
    setToggleSelected = toggle.setSelected;
  }

  // ─── Theory overlay toggle ───
  /** @type {HTMLInputElement|null} */
  let theoryCheckbox = null;
  let theoryOverlayOn = false;
  if (toggleFieldset && config.mode === 'bootstrap') {
    theoryCheckbox = createTheoryToggle(toggleFieldset, (checked) => {
      theoryOverlayOn = checked;
      if (allStats.length > 0) {
        const activeType = getActiveChartType();
        if (checked && (activeType === 'histogram' || activeType === 'dotplot')) {
          applyTheoryOverlay(allStats);
        } else if (chartContainer) {
          removeTheoryOverlay(chartContainer);
        }
      }
    });
  }

  // ─── Bin adjuster (continuous data only — proportions have fixed k/n bins) ───
  /** @type {number|undefined} */
  let userBinCount;
  /** @type {import('./chart-defaults.js').BinAdjusterControl|null} */
  let binAdjuster = null;
  if (toggleFieldset && !config.proportion) {
    binAdjuster = createBinAdjuster(toggleFieldset, {
      currentBins: 20,
      onChange: (bins) => {
        userBinCount = bins;
        if (allStats.length > 0) {
          lastStatIndex = -1;
          batchHighlightIndices = null;
          prevBinCounts = null;
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
      // Dotplot mode: scale PDF so the curve peak fits the chart height
      const { xScale: dxScale, frame, domain: dom } = lastDotResult;
      const peakPdf = normalPdf(center, center, se);
      if (peakPdf <= 0) return;
      // Scale curve peak to ~85% of chart inner height
      const targetPeakY = frame.height * 0.85;
      const scaleFactor = targetPeakY / peakPdf;
      // Create a y-scale that maps from scaled PDF value → SVG y coordinate
      const yScale = (/** @type {number} */ freqY) => frame.height - freqY;

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, center, se),
        xDomain: dom,
        // For dotplot: pass totalN=1 and binWidth=scaleFactor so that
        // totalN * binWidth * pdf(x) = scaleFactor * pdf(x) = scaled pixel height
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

  // Apply URL params
  if (urlParams.data) {
    data1 = urlParams.data;
    showDataLoaded();
  }
  if (urlParams.ci && ciSelect) {
    ciSelect.value = String(urlParams.ci);
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

  if (loadPastedBtn && pasteArea) {
    loadPastedBtn.addEventListener('click', () => {
      loadTextData(pasteArea.value);
    });
  }

  const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
  if (fileInput) {
    setupFileInput(fileInput, (text, filename) => {
      if (pasteArea) pasteArea.value = text;
      currentSourceName = (filename || 'data').replace(/\.\w+$/, '');
      loadTextData(text);
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      data1 = [];
      data2 = [];
      resetSimulation();
      hideVarSelector();
      if (pasteArea) pasteArea.value = '';
      if (dataPreview) dataPreview.hidden = true;
      if (dataSummary) dataSummary.textContent = '\u2014';
      for (const btn of genBtns) btn.disabled = true;
      if (mechanismStrip) mechanismStrip.hidden = true;
      if (successSelector) successSelector.hidden = true;
      if (hypothesisDisplay) hypothesisDisplay.hidden = true;
      const groupOrderEl = document.getElementById('group-order');
      if (groupOrderEl) groupOrderEl.hidden = true;
      announce('Data cleared.');
    });
  }

  // ── Save ──
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const text = pasteArea?.value?.trim();
      if (!text) {
        announce('No data to save.');
        return;
      }
      const safeName = currentSourceName.replace(/[^a-zA-Z0-9_-]/g, '_');
      downloadCSV(text, `${safeName}.csv`);
      announce('Data saved.');
    });
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
        announce(`Loaded: n = ${n}, successes = ${k}.`);
      }
    });
  }

  function showDataLoaded() {
    // Set dataPrecision based on source data type
    if (config.proportion) {
      dataPrecision = 0; // proportion data is 0/1 integers
    } else if (config.paired || (config.twoGroup && data2.length > 0)) {
      dataPrecision = Math.max(detectPrecision(data1), detectPrecision(data2));
    } else {
      dataPrecision = detectPrecision(data1);
    }

    if (dataPreview) dataPreview.hidden = false;
    if (dataSummary) {
      if (config.paired) {
        const diffs = data2.map((v, i) => v - data1[i]);
        const m = mean(diffs);
        dataSummary.textContent =
          `${data1.length} pairs | ${group1Name}: x̄ = ${formatStat(mean(data1), dataPrecision)} | ` +
          `${group2Name}: x̄ = ${formatStat(mean(data2), dataPrecision)} | Mean diff = ${formatStat(m, dataPrecision)}`;
      } else if (config.proportion && !config.twoGroup) {
        const p1 = mean(data1);
        const s1 = data1.filter(v => v === 1).length;
        dataSummary.textContent =
          `n = ${data1.length}, successes = ${s1}, p̂ = ${formatStat(p1, dataPrecision, 'proportion')}`;
      } else if (config.proportion && data2.length > 0) {
        const p1 = mean(data1);
        const p2 = mean(data2);
        const s1 = data1.filter(v => v === 1).length;
        const s2 = data2.filter(v => v === 1).length;
        dataSummary.textContent =
          `${group1Name}: ${s1}/${data1.length} (p̂ = ${formatStat(p1, dataPrecision, 'proportion')}) | ` +
          `${group2Name}: ${s2}/${data2.length} (p̂ = ${formatStat(p2, dataPrecision, 'proportion')})`;
      } else if (config.twoGroup && data2.length > 0) {
        dataSummary.textContent =
          `${group1Name}: n = ${data1.length}, x̄ = ${formatStat(mean(data1), dataPrecision)} | ` +
          `${group2Name}: n = ${data2.length}, x̄ = ${formatStat(mean(data2), dataPrecision)}`;
      } else {
        const n = data1.length;
        const m = mean(data1);
        const s = sd(data1);
        const varPrefix = selectedVarName ? `${selectedVarName}: ` : '';
        dataSummary.textContent = `${varPrefix}n = ${n}, mean = ${formatStat(m, dataPrecision)}, SD = ${formatStat(s, dataPrecision)}`;
      }
    }
    for (const btn of genBtns) btn.disabled = false;
    // Update chart toggle: discrete (proportion) data gets spike option
    updateToggleButtons(!!config.proportion);
    // Clear stale results
    resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';
    // Show mechanism strip
    if (mechanismStrip) {
      if (config.paired && originalContentEl) {
        // Paired bootstrap: show differences in one-sample mechanism strip
        mechanismStrip.hidden = false;
        initMechanismCollapse(mechanismStrip);
        renderOriginalSample();
      } else if (config.mode === 'bootstrap' && !config.twoGroup && originalContentEl) {
        // One-sample bootstrap: original sample chips/histogram
        mechanismStrip.hidden = false;
        initMechanismCollapse(mechanismStrip);
        renderOriginalSample();
      } else if (config.twoGroup) {
        // Two-group: show original group summaries
        mechanismStrip.hidden = false;
        initMechanismCollapse(mechanismStrip);
        renderTwoGroupOriginal();
      }
    }
    // Show hypothesis display (randomization tests)
    if (config.mode === 'randomization' && config.twoGroup && hypothesisDisplay) {
      hypothesisDisplay.hidden = false;
      updateHypothesisDisplay();
    }
    // Show group order (two-sample bootstrap)
    const groupOrderEl = document.getElementById('group-order');
    const groupOrderLabel = document.getElementById('group-order-label');
    if (config.mode === 'bootstrap' && config.twoGroup && groupOrderEl && groupOrderLabel) {
      groupOrderEl.hidden = false;
      groupOrderLabel.textContent = `${group1Name} − ${group2Name}`;
    }
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
    const PRE_SIM_N = 100;
    const TRIM = 5;
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
    successOutcome = outcomes[0];
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

  // ─── Dataset selector ───

  /**
   * Resolve the path to the data/ directory from the current page.
   * Uses the <base> href or infers from the CSS stylesheet link.
   */
  function dataPath(file) {
    // Try to compute from the known CSS path (../../../css/style.css → ../../../data/)
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    if (link) {
      const href = link.getAttribute('href');
      const prefix = href.replace(/css\/style\.css$/, '');
      return `${prefix}data/${file}`;
    }
    // Fallback: assume root-relative
    return `/data/${file}`;
  }

  /** @type {Array<{id:string,name:string,description:string,type:string,chapter:string,n:number}>} */
  let datasetIndex = [];

  if (datasetSelect) {
    fetch(dataPath('datasets.json'))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((index) => {
        const relevant = index.filter(ds => {
          if (config.paired) return ds.type === 'paired';
          if (config.mode === 'bootstrap' && config.proportion && !config.twoGroup) return ds.type === 'bootstrap_prop';
          if (config.mode === 'bootstrap' && config.twoGroup) return ds.type === 'randomization';
          if (config.mode === 'bootstrap') return ds.type === 'bootstrap';
          if (config.proportion) return ds.type === 'randomization_prop';
          if (config.twoGroup) return ds.type === 'randomization';
          return ds.type === 'randomization' || ds.type === 'randomization_prop';
        });
        datasetIndex = relevant;

        for (const ds of relevant) {
          const opt = document.createElement('option');
          opt.value = ds.id;
          opt.textContent = `${ds.name} (n = ${ds.n})`;
          datasetSelect.appendChild(opt);
        }
      })
      .catch(() => {
        if (datasetDesc) datasetDesc.textContent = 'Could not load datasets.';
      });

    datasetSelect.addEventListener('change', () => {
      const id = datasetSelect.value;
      if (!id) {
        if (datasetDesc) datasetDesc.textContent = '';
        return;
      }
      const meta = datasetIndex.find(d => d.id === id);
      if (meta && datasetDesc) {
        datasetDesc.textContent = meta.description;
      }
      loadDataset(id);
    });
  }

  /**
   * Fetch and load a bundled dataset by ID.
   * @param {string} id
   */
  function loadDataset(id) {
    fetch(dataPath(`${id}.json`))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((ds) => {
        resetSimulation();
        hideVarSelector();
        selectedVarName = '';
        datasetContext = ds.context || {};

        if (config.paired) {
          // Paired data: two numeric columns
          const numVars = ds.variables.filter(v => v.type === 'numeric');
          if (numVars.length < 2) return;
          group1Name = numVars[0].name;
          group2Name = numVars[1].name;
          data1 = ds.rows.map(r => r[numVars[0].name]).filter(v => isFinite(v));
          data2 = ds.rows.map(r => r[numVars[1].name]).filter(v => isFinite(v));
          const minLen = Math.min(data1.length, data2.length);
          data1 = data1.slice(0, minLen);
          data2 = data2.slice(0, minLen);
        } else if (config.mode === 'bootstrap' && config.proportion && !config.twoGroup) {
          // One-sample bootstrap proportion: single categorical column → 0/1
          const catVar = ds.variables.find(v => v.type === 'categorical');
          if (!catVar) return;
          rawOutcomes1 = ds.rows.map(r => r[catVar.name]);
          rawOutcomes2 = [];
          const outcomes = [...new Set(rawOutcomes1)];
          populateSuccessSelector(outcomes);
          encodeProportionData();
        } else if (config.mode === 'bootstrap' && !config.twoGroup) {
          // Single numeric variable — extract first numeric column
          const numVar = ds.variables.find(v => v.type === 'numeric');
          if (!numVar) return;
          data1 = ds.rows.map(r => r[numVar.name]).filter(v => isFinite(v));
          data2 = [];
        } else if (config.proportion) {
          // Two categorical variables: group + outcome → encode as 0/1
          const catVars = ds.variables.filter(v => v.type === 'categorical');
          if (catVars.length < 2) return;
          const groupVar = catVars[0];
          const outcomeVar = catVars[1];
          const groups = [...new Set(ds.rows.map(r => r[groupVar.name]))];
          const outcomes = [...new Set(ds.rows.map(r => r[outcomeVar.name]))];
          group1Name = groups[0];
          group2Name = groups[1];
          rawOutcomes1 = ds.rows
            .filter(r => r[groupVar.name] === groups[0])
            .map(r => r[outcomeVar.name]);
          rawOutcomes2 = ds.rows
            .filter(r => r[groupVar.name] === groups[1])
            .map(r => r[outcomeVar.name]);
          populateSuccessSelector(outcomes);
          encodeProportionData();
        } else {
          // Two-group: categorical grouping + numeric outcome
          const catVar = ds.variables.find(v => v.type === 'categorical');
          const numVar = ds.variables.find(v => v.type === 'numeric');
          if (!catVar || !numVar) return;
          const groups = [...new Set(ds.rows.map(r => r[catVar.name]))];
          group1Name = groups[0];
          group2Name = groups[1];
          data1 = ds.rows
            .filter(r => r[catVar.name] === groups[0])
            .map(r => r[numVar.name])
            .filter(v => isFinite(v));
          data2 = ds.rows
            .filter(r => r[catVar.name] === groups[1])
            .map(r => r[numVar.name])
            .filter(v => isFinite(v));
        }

        showDataLoaded();

        // Populate editor with dataset as CSV
        if (pasteArea && ds.rows && ds.variables) {
          const cols = ds.variables.map(/** @param {any} v */ v => v.name);
          pasteArea.value = rowsToCSV(ds.rows, cols);
          currentSourceName = ds.name || id;
        }

        announce(`${ds.name}.`);
      })
      .catch(() => {
        announce('Failed to load dataset.');
      });
  }

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
        const observedStat = config.testStat(data1, data2);
        const direction = getDirection();
        renderChart(allStats, null, observedStat, direction);
        const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
        displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);
      }
    });
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
  function generateSamples(count) {
    if (!rng) rng = createRng(seed);

    // Capture previous state for histogram delta highlight
    const prevLength = allStats.length;

    // Update resample panel title
    if (resampleTitleEl) {
      resampleTitleEl.textContent = count === 1 ? 'This Resample' : 'Last Resample';
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
        showTwoGroupMechanism(lastRs1, lastRs2, false);
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
      const CI_MIN = 20; // Don't show CI lines until this many resamples
      if (allStats.length >= 10) {
        const result = bootstrapCI([...allStats], ciLevel);
        ci = result.ci;
        displayBootstrapResults(allStats, result.ci, result.se, ciLevel);
      } else {
        resultDiv.innerHTML = `<p><strong>Bootstrap Distribution</strong> (${allStats.length} resamples)</p>
          <p>Need at least 10 resamples for CI estimate.</p>`;
      }
      // Track new data for highlight — always compute dot-level highlights
      if (count === 1) {
        lastStatIndex = allStats.length - 1;
      } else {
        batchHighlightIndices = new Set();
        for (let j = prevLength; j < allStats.length; j++) {
          batchHighlightIndices.add(j);
        }
      }
      if (allStats.length > DOTPLOT_AUTO_THRESHOLD && prevLength > 0) {
        // Histogram mode: compute previous bin counts for stacked delta
        // Must use EXACT same domain + thresholds as renderChart to align bins
        let lo = Math.min(...allStats);
        let hi = Math.max(...allStats);
        const dPad = (hi - lo) * 0.05 || 0.5;
        lo -= dPad; hi += dPad;
        if (preSimDomain) {
          lo = Math.min(lo, preSimDomain[0]);
          hi = Math.max(hi, preSimDomain[1]);
        }
        /** @type {[number,number]} */
        const fullDomain = [lo, hi];
        const histThresholds = config.proportion
          ? snappedPropThresholds(data1.length, fullDomain, allStats.length)
          : undefined;
        // Bin the FULL dataset first to lock in bin edges
        const { bins: fullBins } = computeBins(allStats, {
          domain: fullDomain, thresholds: histThresholds,
        });
        // Extract interior edges so prev data bins with identical edges
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
        // Staggered animation: mechanism update → 120ms → flash → 120ms → dot appears → drop animation
        if (showOneSampleMech) {
          lastResample = lastResampleValues;
          showResample(lastResampleValues, false, true);
        }
        setTimeout(() => {
          flashMechanism();
          setTimeout(() => {
            renderChart(allStats, ciForChart);
            // Drop animation: flying dot from resample mean to chart
            if (resampleMeanEl && chartContainer) {
              animateDropToChart(resampleMeanEl, chartContainer);
            }
          }, 120);
        }, 120);
      } else {
        lastWasSingle = false;
        renderChart(allStats, ciForChart);
        if (showOneSampleMech) {
          lastResample = lastResampleValues;
          showResample(lastResampleValues, false, false);
        }
      }

      announce(`Generated ${count} resample${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
    } else {
      const observedStat = config.testStat(data1, data2);
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

      showTwoGroupMechanism(lastG1, lastG2, false);
      // Always compute dot-level highlights
      if (count === 1) {
        lastStatIndex = allStats.length - 1;
      } else {
        batchHighlightIndices = new Set();
        for (let j = prevLength; j < allStats.length; j++) {
          batchHighlightIndices.add(j);
        }
      }
      if (allStats.length > DOTPLOT_AUTO_THRESHOLD && prevLength > 0) {
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
        const rThresholds = config.proportion
          ? snappedPropThresholds(data1.length, rDomain, allStats.length)
          : undefined;
        // Bin the FULL dataset first to lock in bin edges
        const { bins: fullBins } = computeBins(allStats, {
          domain: rDomain, thresholds: rThresholds,
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
        // Staggered: mechanism update → 120ms → flash → 120ms → dot appears → drop animation
        setTimeout(() => {
          flashMechanism();
          setTimeout(() => {
            renderChart(allStats, null, observedStat, direction);
            // Drop animation: flying dot from mechanism strip to chart
            // Two-group pages show diff in .mech-diff; one-sample uses #resample-mean
            const dropSourceEl = document.querySelector('.mech-diff') || resampleMeanEl;
            if (dropSourceEl && chartContainer) {
              animateDropToChart(/** @type {HTMLElement} */ (dropSourceEl), chartContainer);
            }
          }, 120);
        }, 120);
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
      // Paired data: show the differences
      const diffs = data2.map((v, i) => v - data1[i]);
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', `Paired differences (${group2Name} − ${group1Name})`);

      if (diffs.length <= CHIP_THRESHOLD) {
        for (const d of diffs) {
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
        });
      }
      originalContentEl.appendChild(container);

      if (origNEl) origNEl.textContent = `${diffs.length} pairs`;
      if (origMeanEl) origMeanEl.textContent = formatStat(mean(diffs), dataPrecision);
      return;
    }

    if (config.proportion && !config.twoGroup) {
      // One-sample proportion: text counts
      const successes = data1.filter(v => v === 1).length;
      const failures = data1.length - successes;
      const pHat = mean(data1);
      const container = document.createElement('div');
      container.className = 'prop-summary';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', `Original sample: ${successes} successes, ${failures} failures, p-hat = ${formatStat(pHat, dataPrecision, 'proportion')}`);
      container.innerHTML = `
        <span class="prop-count"><strong>${successes}</strong> S</span>
        <span class="prop-count"><strong>${failures}</strong> F</span>
        <span class="prop-count">p̂ = ${formatStat(pHat, dataPrecision, 'proportion')}</span>
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
      // Large dataset: show mini histogram
      const container = document.createElement('div');
      container.className = 'mini-chart';
      drawHistogram(container, data1, {
        id: 'orig-hist',
        xLabel: '',
        titleText: 'Original sample distribution',
        numBins: Math.min(Math.ceil(Math.sqrt(data1.length)), 40),
        animate: false,
        margin: { top: 5, right: 10, bottom: 25, left: 35 },
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

  /** Render original group summaries in the mechanism strip. */
  function renderTwoGroupOriginal() {
    if (!mechOriginalContent) return;
    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;
    const statSymbol = config.proportion ? 'p̂' : 'x̄';
    const s1 = statFn(data1);
    const s2 = statFn(data2);
    const fmtType = config.proportion ? 'proportion' : undefined;
    mechOriginalContent.innerHTML = `
      <div class="mech-group-row"><span class="mech-group-name">${group1Name}:</span>
        <span class="mech-group-stat">n = ${data1.length}, ${statSymbol} = ${formatStat(s1, dataPrecision, fmtType)}</span></div>
      <div class="mech-group-row"><span class="mech-group-name">${group2Name}:</span>
        <span class="mech-group-stat">n = ${data2.length}, ${statSymbol} = ${formatStat(s2, dataPrecision, fmtType)}</span></div>
      <div class="mech-diff">diff = ${formatStat(s1 - s2, dataPrecision, fmtType)}</div>
    `;
  }

  /**
   * Show the two-group mechanism after a simulation step.
   * @param {number[]} g1 - Group 1 values (resample or shuffled)
   * @param {number[]} g2 - Group 2 values (resample or shuffled)
   * @param {boolean} [flash]
   */
  function showTwoGroupMechanism(g1, g2, flash = false) {
    if (!mechResampleContent || !mechanismDescEl) return;
    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;
    const statSymbol = config.proportion ? 'p̂' : 'x̄';
    const s1 = statFn(g1);
    const s2 = statFn(g2);
    const fmtType = config.proportion ? 'proportion' : undefined;
    mechResampleContent.innerHTML = `
      <div class="mech-group-row"><span class="mech-group-name">${group1Name}:</span>
        <span class="mech-group-stat">n = ${g1.length}, ${statSymbol} = ${formatStat(s1, dataPrecision, fmtType)}</span></div>
      <div class="mech-group-row"><span class="mech-group-name">${group2Name}:</span>
        <span class="mech-group-stat">n = ${g2.length}, ${statSymbol} = ${formatStat(s2, dataPrecision, fmtType)}</span></div>
      <div class="mech-diff">diff = ${formatStat(s1 - s2, dataPrecision, fmtType)}</div>
    `;

    if (config.mode === 'bootstrap') {
      mechanismDescEl.textContent = 'Resample each group independently with replacement';
    } else {
      mechanismDescEl.textContent = 'Shuffle group labels · same values, new grouping';
    }
    mechanismDescEl.hidden = false;

    if (flash && mechanismStrip) {
      mechanismStrip.classList.remove('mechanism-flash');
      void mechanismStrip.offsetWidth;
      mechanismStrip.classList.add('mechanism-flash');
    }
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
   */
  function showResample(resampleValues, flash = false, highlightStat = false) {
    if (!resampleContentEl || !bootstrapSampleEl) return;
    bootstrapSampleEl.hidden = false;

    if (resampleViewMode === 'histogram') {
      showResampleHistogram(resampleValues);
    } else {
      showResampleSummary(resampleValues);
    }

    if (resampleMeanEl) {
      const stat = getBootstrapStat();
      const resampleVal = stat.fn(resampleValues);
      resampleMeanEl.textContent = config.proportion
        ? formatStat(resampleVal, dataPrecision, 'proportion')
        : formatStat(resampleVal, dataPrecision);
      // Orange highlight only on +1 to visually link to persistent dot
      resampleMeanEl.classList.toggle('highlight-last', highlightStat);
      const statLabelEl = document.getElementById('resample-stat-label');
      if (statLabelEl) {
        if (config.proportion) {
          statLabelEl.textContent = 'Resample proportion';
        } else {
          const shortName = stat.label.replace('Sample ', '').toLowerCase();
          statLabelEl.textContent = `Resample ${shortName}`;
        }
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

    // Flash animation for +1 to emphasize statistic → dot connection
    if (flash && mechanismStrip) {
      flashMechanism();
    }
  }

  /** Trigger the CSS flash animation on the mechanism strip. */
  function flashMechanism() {
    if (!mechanismStrip) return;
    mechanismStrip.classList.remove('mechanism-flash');
    void mechanismStrip.offsetWidth; // force reflow to restart animation
    mechanismStrip.classList.add('mechanism-flash');
  }

  /**
   * Summary view: chips (small n) or text counts (large n).
   * @param {number[]} resampleValues
   */
  function showResampleSummary(resampleValues) {
    resampleContentEl.innerHTML = '';

    // Proportion mode: just show counts and p̂
    if (config.proportion && !config.twoGroup) {
      const successes = resampleValues.filter(v => v === 1).length;
      const failures = resampleValues.length - successes;
      const pHat = mean(resampleValues);
      const container = document.createElement('div');
      container.className = 'prop-summary';
      container.innerHTML = `
        <span class="prop-count"><strong>${successes}</strong> S</span>
        <span class="prop-count"><strong>${failures}</strong> F</span>
        <span class="prop-count">p̂ = ${formatStat(pHat, dataPrecision, 'proportion')}</span>
      `;
      resampleContentEl.appendChild(container);
      return;
    }

    /** @type {Map<number, number>} */
    const counts = new Map();
    for (const v of resampleValues) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }

    if (data1.length <= CHIP_THRESHOLD) {
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Bootstrap resample values');
      const sorted = [...data1].sort((a, b) => a - b);
      const remaining = new Map(counts);
      for (const v of sorted) {
        const timesDrawn = remaining.get(v) ?? 0;
        const dot = document.createElement('span');
        dot.className = 'sample-dot';
        if (config.proportion) {
          dot.classList.add(v === 1 ? 'sample-dot--success' : 'sample-dot--failure');
        }
        if (timesDrawn === 0) {
          dot.classList.add('not-drawn');
        } else if (timesDrawn > 1) {
          dot.classList.add('multi-drawn');
        }
        dot.textContent = config.proportion ? (v === 1 ? 'S' : 'F') : formatChipValue(v);
        dot.title = timesDrawn === 0 ? 'Not selected'
          : timesDrawn === 1 ? 'Selected once'
          : `Selected ${timesDrawn} times`;
        if (timesDrawn > 1) {
          const badge = document.createElement('sup');
          badge.className = 'draw-count';
          badge.textContent = `\u00d7${timesDrawn}`;
          dot.appendChild(badge);
        }
        container.appendChild(dot);
        if (timesDrawn > 0) {
          remaining.set(v, timesDrawn - 1);
        }
      }
      resampleContentEl.appendChild(container);
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
  }

  /**
   * Histogram view: mini histogram of the resample values.
   * @param {number[]} resampleValues
   */
  function showResampleHistogram(resampleValues) {
    resampleContentEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'mini-chart';
    drawHistogram(container, resampleValues, {
      id: 'resample-hist',
      xLabel: '',
      titleText: 'Bootstrap resample distribution',
      numBins: Math.min(Math.ceil(Math.sqrt(resampleValues.length)), 40),
      animate: false,
      margin: { top: 5, right: 10, bottom: 25, left: 35 },
    });
    resampleContentEl.appendChild(container);
  }

  // Replace single toggle button with segmented control
  if (resampleToggle) {
    const seg = document.createElement('div');
    seg.className = 'seg-control';
    seg.setAttribute('role', 'group');
    seg.setAttribute('aria-label', 'Resample view');

    const btnSummary = document.createElement('button');
    btnSummary.type = 'button';
    btnSummary.textContent = 'Summary';
    btnSummary.setAttribute('aria-pressed', 'true');

    const btnHistogram = document.createElement('button');
    btnHistogram.type = 'button';
    btnHistogram.textContent = 'Histogram';
    btnHistogram.setAttribute('aria-pressed', 'false');

    seg.appendChild(btnSummary);
    seg.appendChild(btnHistogram);
    resampleToggle.replaceWith(seg);

    /** @param {'summary'|'histogram'} mode */
    function setResampleView(mode) {
      resampleViewMode = mode;
      btnSummary.setAttribute('aria-pressed', String(mode === 'summary'));
      btnHistogram.setAttribute('aria-pressed', String(mode === 'histogram'));
      if (lastResample.length > 0) showResample(lastResample, false, lastWasSingle);
    }

    btnSummary.addEventListener('click', () => setResampleView('summary'));
    btnHistogram.addEventListener('click', () => setResampleView('histogram'));
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
    // New random seed each reset (unless URL-locked for graded work)
    if (!urlSeed) {
      seed = Math.random().toString(36).slice(2, 10);
    }
    chartContainer.innerHTML = '';
    resultDiv.innerHTML = '<p class="placeholder">Load data and run a simulation to see results.</p>';
    if (resetBtn) resetBtn.hidden = true;
    if (bootstrapSampleEl) bootstrapSampleEl.hidden = true;
    if (mechResampleContent) mechResampleContent.innerHTML = '';
    if (mechanismDescEl) mechanismDescEl.hidden = true;
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
    const sampleSize = data1.length;

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
        highlightIndex,
        highlightIndices,
        precision: dataPrecision + 1,
      });
      chartResult = r.frame;
      chartXScale = r.xScale;
      lastDotResult = { xScale: r.xScale, frame: r.frame, domain: domain || [0, 1] };
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
        precision: dataPrecision + 1,
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
      <p>SE: ${formatStat(se, dataPrecision)}</p>
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
    let obsLabel;
    if (config.proportion) {
      obsLabel = `p̂<sub>${group1Name}</sub> − p̂<sub>${group2Name}</sub> = <span class="observed-value">${formatStat(observedStat, dataPrecision, 'proportion')}</span>`;
    } else if (config.twoGroup) {
      obsLabel = `x̄<sub>${group1Name}</sub> − x̄<sub>${group2Name}</sub> = <span class="observed-value">${formatStat(observedStat, dataPrecision)}</span>`;
    } else {
      obsLabel = `<span class="observed-value">${formatStat(observedStat, dataPrecision)}</span>`;
    }
    // Plain-language interpretation
    let strength;
    if (pValue < 0.01) strength = 'very strong';
    else if (pValue < 0.05) strength = 'strong';
    else if (pValue < 0.10) strength = 'moderate';
    else strength = 'little';
    const defaultNull = config.proportion
      ? 'no difference in population proportions'
      : 'no difference in population means';
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
