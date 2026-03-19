// @ts-check
/**
 * Shared one-sample randomization test page logic for StatBench.
 * Handles both one-proportion (Bernoulli) and one-mean (shifted bootstrap) tests.
 *
 * Each page's app.js calls:
 *   initOneSamplePage({ mode: 'one-prop' })   // or
 *   initOneSamplePage({ mode: 'one-mean' })
 */

import { createRng, sampleWithReplacement } from './prng.js';
import { mean, sd, detectPrecision, formatStat } from './stats.js';
import { drawHistogram, computeBins, snappedPropThresholds } from './histogram.js';
import { drawDotplot, computeDotRadius } from './dotplot.js';
import { renderSimPills, formatMechStat, drawMiniBoxplot } from './chart-utils.js';
import { announce, initKeyboardShortcuts, initPlayPause, initTabs, animateDropToChart, initDataPanel, computeHighlights, initHelp, initSettings, initMechanismCollapse, createExpertToggle, updateTabHint, getActiveTabId, getTabHintText, setPageTitle } from './page-utils.js';
import { parseParams } from './url-params.js';
import { normalPdf, overlayTheoryCurve, removeTheoryOverlay, createTheoryToggle } from './theory-overlay.js';
import { resolveChartType, createChartToggle, displayPrecision, isExtreme as isExtremeShared, dotplotBins, histogramThresholds, renderSimChart, createBinAdjuster } from './chart-defaults.js';

/**
 * @typedef {object} OneSampleSimConfig
 * @property {'one-prop'|'one-mean'} mode
 */

/**
 * Initialize a one-sample randomization test page.
 * @param {OneSampleSimConfig} config
 */
export function initOneSamplePage(config) {
  const isProp = config.mode === 'one-prop';

  // ─── DOM elements ───

  const chartContainer = document.getElementById('chart-container');
  const resultDiv = document.getElementById('result-summary');
  const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
  const dataSummary = document.getElementById('data-summary');
  const dataPreview = document.getElementById('data-preview');
  const hypothesisDisplay = document.getElementById('hypothesis-display');

  const nullInput = /** @type {HTMLInputElement} */ (
    document.getElementById(isProp ? 'null-prop' : 'null-mean'));
  const altDirectionBtn = /** @type {HTMLButtonElement} */ (document.getElementById('alt-direction'));
  const altNullValue = document.getElementById('alt-null-value');

  const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.gen-btn'));

  // Controls section (for expert toggle)
  const controlsSection = document.getElementById('controls');

  // Note: hypothesis controls (null value, direction) are essential for students — NOT expert-only

  // Add expert toggle link next to generate bar
  const generateBar = /** @type {HTMLElement|null} */ (controlsSection?.querySelector('.generate-bar'));
  if (generateBar) createExpertToggle(generateBar);

  // Mechanism strip
  const mechanismStrip = document.getElementById('mechanism-strip');
  const mechObservedStat = document.getElementById('mech-observed-stat');
  const mechSimStat = document.getElementById('mech-sim-stat');
  const mechanismDescEl = document.getElementById('mechanism-description');
  const simTitleEl = document.getElementById('sim-title');

  // One-prop only
  const successSelector = document.getElementById('success-selector');
  const successOutcome = /** @type {HTMLSelectElement} */ (document.getElementById('success-outcome'));
  const inputN = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));
  const inputSuccesses = /** @type {HTMLInputElement} */ (document.getElementById('input-successes'));
  const loadSummaryBtn = document.getElementById('load-summary');

  initTabs({ hintTarget: resultDiv, hintAction: 'run a simulation to see results' });
  initKeyboardShortcuts(genBtns, resetBtn);
  initPlayPause(genBtns, resetBtn);
  initHelp();
  initSettings();

  // ─── Mode-dependent constants ───

  const xLabel = isProp ? 'Sample Proportion (p\u0302)' : 'Simulated Mean (x\u0304*)';

  // ─── Chart type toggle ───

  let chartType = 'auto';
  /** @type {HTMLFieldSetElement|null} */
  let toggleFieldset = null;
  /** @type {((type: string) => void)|null} */
  let setToggleSelected = null;
  // ─── Bin adjuster (continuous data only — proportions have fixed k/n bins) ───
  const DEFAULT_BINS = 20;
  /** @type {number|undefined} */
  let userBinCount = isProp ? undefined : DEFAULT_BINS;
  /** @type {import('./chart-defaults.js').BinAdjusterControl|null} */
  let binAdjuster = null;

  if (chartContainer) {
    const toggle = createChartToggle(chartContainer, {
      onChange: (type) => {
        chartType = type;
        if (binAdjuster) binAdjuster.setMode(/** @type {'dotplot'|'histogram'} */ (type));
        if (allStats.length > 0) {
          renderChart(allStats, observedStat, getDirection());
        }
      },
    });
    toggleFieldset = toggle.fieldset;
    setToggleSelected = toggle.setSelected;
    // Chart toggle, theory overlay, and bin adjuster are expert-only
    toggle.fieldset.classList.add('expert-only');

    createTheoryToggle(toggleFieldset, (checked) => {
      theoryOverlayOn = checked;
      if (allStats.length > 0 && chartContainer) {
        if (checked) {
          renderChart(allStats, observedStat, getDirection());
        } else {
          removeTheoryOverlay(chartContainer);
        }
      }
    });

    if (!isProp) {
      binAdjuster = createBinAdjuster(toggleFieldset, {
        currentBins: 20,
        onChange: (bins) => {
          userBinCount = bins;
          if (allStats.length > 0) {
            renderChart(allStats, observedStat, getDirection());
          }
        },
      });
    }
  }

  // ─── State ───

  /** @type {number[]} */
  let allStats = [];
  /** @type {(() => number)|null} */
  let rng = null;
  let seed = Math.random().toString(36).slice(2, 10);

  let sampleN = 0;
  let observedStat = 0;
  let dataPrecision = 0;
  let theoryOverlayOn = false;
  /** Whether the mechanism strip has been initialized (deferred to first generate). */
  let mechanismInitialized = false;
  /** @type {{ population?: string, parameter?: string, nullClaim?: string, successLabel?: string }} */
  let datasetContext = {};
  /** Base page title (before dataset context). */
  const baseTitle = document.title.replace(/\s*\|\s*StatBench$/, '');
  /** Track current data source name for display. */
  let currentSourceName = '';

  /** @type {{ xScale: any, yScale: any, bins: any[], domain: [number,number] } | null} */
  let lastHistResult = null;
  /** @type {{ xScale: any, frame: any, domain: [number,number], maxStack: number, numBins: number } | null} */
  let lastDotResult = null;
  /** Pre-simulated domain for stable axis limits. */
  /** @type {[number,number]|null} */
  let preSimDomain = null;

  // One-prop state
  let sampleSuccesses = 0;
  /** @type {string[]} */
  let rawOutcomes = [];

  // One-mean state
  /** @type {number[]} */
  let sampleData = [];
  /** @type {number[]} */
  let shiftedData = [];

  // ─── Shared helpers ───

  function getNullValue() {
    const val = parseFloat(nullInput?.value);
    if (!isFinite(val)) return isProp ? 0.5 : 0;
    if (isProp && (val < 0 || val > 1)) return 0.5;
    return val;
  }

  function getDirection() {
    const alt = altDirectionBtn?.dataset.value ?? 'greater';
    if (alt === 'greater') return /** @type {const} */ ('right');
    if (alt === 'less') return /** @type {const} */ ('left');
    return /** @type {const} */ ('both');
  }

  function getActiveChartType() {
    return resolveChartType(allStats.length, chartType);
  }

  function syncAltNullValue() {
    if (altNullValue) altNullValue.textContent = nullInput?.value ?? (isProp ? '0.5' : '0');
  }

  /** Format observed stat for display. */
  function fmtObs(v) {
    return isProp ? formatStat(v, 0, 'proportion') : formatStat(v, dataPrecision);
  }

  /** HTML for the stat symbol. */
  const statSymbolHTML = isProp ? 'p\u0302' : '<span class="x-bar">x</span>';

  /** Scroll to controls after data loads. */
  function scrollToControls() {
    setTimeout(() => {
      const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
      if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  /** Enable generate buttons and show hypothesis. */
  function enableControls() {
    if (hypothesisDisplay) hypothesisDisplay.hidden = false;
    for (const btn of genBtns) btn.disabled = false;
    resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';
  }

  /**
   * Run a silent pre-simulation to establish stable axis limits.
   * Called after data loads so the chart domain doesn't jump as resamples accumulate.
   */
  function computePreSimDomain() {
    const PRE_N = 2000;
    const TRIM = 5;
    const preRng = createRng('presim-' + Date.now());
    const preStats = [];
    const p0 = getNullValue();

    if (isProp) {
      for (let i = 0; i < PRE_N; i++) {
        let k = 0;
        for (let j = 0; j < sampleN; j++) {
          if (preRng() < p0) k++;
        }
        preStats.push(k / sampleN);
      }
    } else {
      // One-mean: shifted bootstrap
      const shift = p0 - observedStat;
      const shifted = sampleData.map(v => v + shift);
      for (let i = 0; i < PRE_N; i++) {
        const rs = sampleWithReplacement(shifted, sampleN, preRng);
        preStats.push(mean(rs));
      }
    }

    if (preStats.length === 0) { preSimDomain = null; return; }

    preStats.sort((a, b) => a - b);
    const lo = preStats[TRIM];
    const hi = preStats[preStats.length - 1 - TRIM];
    const pad = (hi - lo) * 0.1 || 0.05;
    preSimDomain = [lo - pad, hi + pad];

    // Render empty chart with pre-sim axes
    renderChart([], observedStat, getDirection());
  }

  // ─── Data loading ───

  if (isProp) {
    // One-prop: categorical data input

    /**
     * Populate success outcome selector.
     * @param {string[]} levels
     * @param {string} [autoSelect]
     */
    function populateSuccessSelector(levels, autoSelect) {
      if (!successSelector || !successOutcome) return;
      successOutcome.innerHTML = '';
      for (const lev of levels) {
        const opt = document.createElement('option');
        opt.value = lev;
        opt.textContent = lev;
        successOutcome.appendChild(opt);
      }
      if (autoSelect && levels.includes(autoSelect)) {
        successOutcome.value = autoSelect;
      }
      successSelector.hidden = false;
      applyDatasetOutcome();
    }

    function applyDatasetOutcome() {
      const successVal = successOutcome?.value;
      if (!successVal || rawOutcomes.length === 0) return;

      sampleN = rawOutcomes.length;
      sampleSuccesses = rawOutcomes.filter(v => v === successVal).length;
      observedStat = sampleSuccesses / sampleN;

      resetSimulation();
      enableControls();
      if (dataSummary) {
        const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
        dataSummary.innerHTML = `${namePrefix}n = ${sampleN}, successes = ${sampleSuccesses} ("${successVal}"), <span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>`;
      }

      // Populate mechanism strip content (stays hidden until first generate)
      if (mechObservedStat) {
        const obsPct = sampleN > 0 ? (sampleSuccesses / sampleN * 100) : 0;
        const obsFailures = sampleN - sampleSuccesses;
        mechObservedStat.innerHTML = `${sampleSuccesses} of ${sampleN} (<span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>)
          <div class="mech-prop-bar" aria-label="${sampleSuccesses} successes, ${obsFailures} failures" style="margin-top:4px">
            <div class="mech-prop-fill" style="width:${obsPct}%"></div>
            <span class="mech-prop-label">${sampleSuccesses} S / ${obsFailures} F</span>
          </div>`;
      }
      computePreSimDomain();
      scrollToControls();
    }

    const propDataApi = initDataPanel({
      autoCollapse: true,
      stickyControls: true,
      showPreview: true,
      datasetFilter: (/** @type {any} */ ds) => ds.type === 'bootstrap_prop',
      onDataset: (/** @type {any} */ ds) => {
        const catVar = ds.variables.find(/** @param {any} v */ v => v.type === 'categorical') || ds.variables[0];
        if (!catVar) { announce('No categorical variable found.'); return; }
        rawOutcomes = ds.rows.map(/** @param {any} r */ r => String(r[catVar.name]));
        const levels = [...new Set(rawOutcomes)];
        datasetContext = ds.context || {};
        currentSourceName = ds.name || '';
        populateSuccessSelector(levels, datasetContext.successLabel);
        announce(`${ds.name}.`);
      },
      onText: (/** @type {any} */ parsed) => {
        const catIdx = parsed.types.indexOf('categorical');
        if (catIdx < 0) {
          announce('Need at least one categorical column.');
          return;
        }
        const colName = parsed.headers[catIdx];
        rawOutcomes = parsed.data.map(/** @param {any} r */ r => String(r[colName]));
        currentSourceName = '';
        populateSuccessSelector([...new Set(rawOutcomes)]);
      },
      onClear: () => {
        rawOutcomes = [];
        datasetContext = {};
        currentSourceName = '';
        resetSimulation();
        if (dataPreview) dataPreview.hidden = true;
        if (dataSummary) dataSummary.textContent = '\u2014';
        for (const btn of genBtns) btn.disabled = true;
        announce('Data cleared.');
      },
    });

    if (successOutcome) {
      successOutcome.addEventListener('change', applyDatasetOutcome);
    }

    // Summary input tab
    if (loadSummaryBtn) {
      loadSummaryBtn.addEventListener('click', () => {
        const n = parseInt(inputN?.value, 10);
        const k = parseInt(inputSuccesses?.value, 10);
        if (!n || n < 1 || !isFinite(k) || k < 0 || k > n) {
          announce('Enter a valid sample size and number of successes.');
          return;
        }
        sampleN = n;
        sampleSuccesses = k;
        observedStat = k / n;

        resetSimulation();
        enableControls();
        if (dataSummary) {
          dataSummary.innerHTML = `n = ${n}, successes = ${k}, <span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>`;  // No dataset name for manual summary input
        }
        // Populate mechanism strip content (stays hidden until first generate)
        if (mechObservedStat) {
          const obsPct = n > 0 ? (k / n * 100) : 0;
          const obsFail = n - k;
          mechObservedStat.innerHTML = `${k} of ${n} (<span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>)
            <div class="mech-prop-bar" aria-label="${k} successes, ${obsFail} failures" style="margin-top:4px">
              <div class="mech-prop-fill" style="width:${obsPct}%"></div>
              <span class="mech-prop-label">${k} S / ${obsFail} F</span>
            </div>`;
        }
        propDataApi.triggerPostLoad();
        setPageTitle(baseTitle, currentSourceName, { n });
        announce(`Data loaded: n = ${n}, successes = ${k}`);
        scrollToControls();
      });
    }
  } else {
    // One-mean: numeric data input

    /** @param {number[]} values */
    function loadNumericData(values) {
      sampleData = values;
      sampleN = values.length;
      observedStat = mean(sampleData);
      dataPrecision = detectPrecision(sampleData);

      resetSimulation();
      enableControls();

      if (dataSummary) {
        const sampleSD = sd(sampleData);
        const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
        dataSummary.innerHTML = `${namePrefix}n = ${sampleN}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedStat, dataPrecision)}</span>, s = ${formatStat(sampleSD, dataPrecision)}`;
      }

      computeShiftedData();

      // Populate mechanism strip content (stays hidden until first generate)
      if (mechObservedStat) {
        mechObservedStat.innerHTML = `n = ${sampleN}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedStat, dataPrecision)}</span>
          <div id="mech-obs-box" class="mech-box-container"></div>`;
        const obsBoxEl = document.getElementById('mech-obs-box');
        if (obsBoxEl && sampleData.length >= 2) {
          drawMiniBoxplot(obsBoxEl, sampleData, {
            meanValue: observedStat,
            label: 'Observed data distribution',
          });
        }
      }
      computePreSimDomain();
      setPageTitle(baseTitle, currentSourceName, { n: sampleN });
      scrollToControls();
    }

    function computeShiftedData() {
      const mu0 = getNullValue();
      const shift = mu0 - observedStat;
      shiftedData = sampleData.map(v => v + shift);
    }

    initDataPanel({
      autoCollapse: true,
      stickyControls: true,
      showPreview: true,
      datasetFilter: (/** @type {any} */ ds) => ds.hasNumeric !== false,
      onDataset: (/** @type {any} */ ds) => {
        const numVar = ds.variables.find(/** @param {any} v */ v => v.type === 'numeric') || ds.variables[0];
        if (!numVar) { announce('No numeric variable found.'); return; }
        const values = ds.rows
          .map(/** @param {any} r */ r => Number(r[numVar.name]))
          .filter(/** @param {number} v */ v => isFinite(v));
        if (values.length === 0) { announce('No valid numeric values found.'); return; }
        datasetContext = ds.context || {};
        currentSourceName = ds.name || '';
        loadNumericData(values);
        announce(`${ds.name}.`);
      },
      onText: (/** @type {any} */ parsed) => {
        const numIdx = parsed.types.indexOf('numeric');
        if (numIdx < 0) {
          announce('Need at least one numeric column.');
          return;
        }
        const colName = parsed.headers[numIdx];
        const values = parsed.data
          .map(/** @param {any} r */ r => Number(r[colName]))
          .filter(/** @param {number} v */ v => isFinite(v));
        if (values.length === 0) { announce('No valid numeric values found.'); return; }
        currentSourceName = '';
        loadNumericData(values);
      },
      onClear: () => {
        sampleData = [];
        shiftedData = [];
        datasetContext = {};
        currentSourceName = '';
        resetSimulation();
        if (dataPreview) dataPreview.hidden = true;
        if (dataSummary) dataSummary.textContent = '\u2014';
        if (hypothesisDisplay) hypothesisDisplay.hidden = true;
        for (const btn of genBtns) btn.disabled = true;
        announce('Data cleared.');
      },
    });
  }

  // ─── Null value & direction ───

  if (nullInput) {
    nullInput.addEventListener('change', () => {
      syncAltNullValue();
      if (!isProp && sampleData.length > 0) {
        // Recompute shifted data for one-mean
        const mu0 = getNullValue();
        const shift = mu0 - observedStat;
        shiftedData = sampleData.map(v => v + shift);
      }
      if (allStats.length > 0) {
        resetSimulation();
        const paramLabel = isProp ? 'Null proportion' : 'Null mean';
        resultDiv.innerHTML = `<p class="hint">${paramLabel} changed. Run simulation again.</p>`;
        announce(`${paramLabel} changed. Simulation reset.`);
      }
    });
    nullInput.addEventListener('input', syncAltNullValue);
  }

  if (altDirectionBtn) {
    const vals = (altDirectionBtn.dataset.values || '').split(',');
    const labels = (altDirectionBtn.dataset.labels || '').split(',');
    altDirectionBtn.addEventListener('click', () => {
      const cur = vals.indexOf(altDirectionBtn.dataset.value || 'greater');
      const next = (cur + 1) % vals.length;
      altDirectionBtn.dataset.value = vals[next];
      altDirectionBtn.textContent = labels[next];
      if (allStats.length > 0) {
        const direction = getDirection();
        renderChart(allStats, observedStat, direction);
        const { pValue, extremeCount } = computePValue(allStats, observedStat, direction);
        displayResults(allStats, observedStat, pValue, extremeCount, direction);
      }
    });
  }

  // ─── Apply URL params for hypothesis (from cross-links) ───
  {
    const urlP = parseParams();
    // Set null value from ?p= (proportion) or ?null_value= (mean)
    const nullVal = isProp ? urlP.p : urlP.null_value;
    if (nullVal != null && nullInput) {
      nullInput.value = String(nullVal);
      syncAltNullValue();
    }
    // Set direction from ?direction=
    if (urlP.direction && altDirectionBtn) {
      const vals = (altDirectionBtn.dataset.values || '').split(',');
      const labels = (altDirectionBtn.dataset.labels || '').split(',');
      // Map inference page values to sim page values
      const dirMap = { 'less': 'less', 'greater': 'greater', 'two-sided': 'twosided', 'twosided': 'twosided' };
      const mapped = dirMap[urlP.direction] || urlP.direction;
      const idx = vals.indexOf(mapped);
      if (idx >= 0) {
        altDirectionBtn.dataset.value = vals[idx];
        altDirectionBtn.textContent = labels[idx];
      }
    }
  }

  // ─── Generate ───

  for (const btn of genBtns) {
    btn.addEventListener('click', () => {
      const count = parseInt(btn.dataset.count, 10);
      if (sampleN === 0) {
        announce('Please load data first.');
        return;
      }
      generateSimulations(count);
    });
  }

  /** @param {number} count */
  function generateSimulations(count) {
    if (!rng) rng = createRng(seed);

    // Show mechanism strip on first generate (deferred from data load)
    if (!mechanismInitialized && mechanismStrip) {
      mechanismInitialized = true;
      mechanismStrip.hidden = false;
      initMechanismCollapse(mechanismStrip);
    }

    const prevLength = allStats.length;

    if (simTitleEl) {
      simTitleEl.textContent = count === 1 ? 'This Simulation' : 'Last Simulation';
    }

    let lastSimStat = 0;
    let lastSimDetail = '';

    const isSingle = count === 1;
    /** @type {number[]|null} */
    let lastResampleArr = null;

    if (isProp) {
      // Bernoulli(p₀) simulation
      const p0 = getNullValue();
      const n = sampleN;
      let lastSuccesses = 0;
      for (let i = 0; i < count; i++) {
        let successes = 0;
        for (let j = 0; j < n; j++) {
          if (rng() < p0) successes++;
        }
        lastSuccesses = successes;
        allStats.push(successes / n);
      }
      lastSimStat = lastSuccesses / n;
      const hlClass = isSingle ? ' highlight-last' : '';
      const lastFailures = n - lastSuccesses;
      const pct = n > 0 ? (lastSuccesses / n * 100) : 0;
      lastSimDetail = `${lastSuccesses} of ${n} (p\u0302 = <span class="mech-stat-value${hlClass}">${fmtObs(lastSimStat)}</span>)`;

      // Proportion bar for visual
      lastSimDetail += `
        <div class="mech-prop-bar" aria-label="${lastSuccesses} successes, ${lastFailures} failures" style="margin-top:4px">
          <div class="mech-prop-fill" style="width:${pct}%"></div>
          <span class="mech-prop-label">${lastSuccesses} S / ${lastFailures} F</span>
        </div>`;

      if (mechanismDescEl) {
        mechanismDescEl.textContent = `Simulate ${n} trials, each with P(success) = ${p0}`;
        mechanismDescEl.hidden = false;
      }
    } else {
      // Shifted bootstrap
      const n = shiftedData.length;
      for (let i = 0; i < count; i++) {
        const resampleArr = sampleWithReplacement(shiftedData, n, rng);
        const simMean = mean(/** @type {number[]} */ (resampleArr));
        lastSimStat = simMean;
        lastResampleArr = /** @type {number[]} */ (resampleArr);
        allStats.push(simMean);
      }
      const hlClass = isSingle ? ' highlight-last' : '';
      lastSimDetail = `<span class="x-bar">x</span>* = <span class="mech-stat-value${hlClass}">${formatStat(lastSimStat, dataPrecision)}</span>`;
      lastSimDetail += '<div id="mech-sim-box" class="mech-box-container"></div>';

      if (mechanismDescEl) {
        mechanismDescEl.textContent = `Resample ${n} values (with replacement) from data shifted to \u03BC\u2080 = ${getNullValue()}, compute mean`;
        mechanismDescEl.hidden = false;
      }
    }

    if (mechSimStat) {
      mechSimStat.innerHTML = lastSimDetail;

      // Render mini boxplot for one-mean after DOM update
      if (!isProp && lastResampleArr && lastResampleArr.length >= 2) {
        const boxEl = document.getElementById('mech-sim-box');
        if (boxEl) {
          // Use original data domain for stable comparison
          const origVals = sampleData;
          const lo = Math.min(...origVals);
          const hi = Math.max(...origVals);
          const pad = (hi - lo) * 0.08 || 0.5;
          drawMiniBoxplot(boxEl, lastResampleArr, {
            domain: [lo - pad, hi + pad],
            meanValue: lastSimStat,
            highlightMean: isSingle,
            label: 'Shifted bootstrap resample distribution',
          });
        }
      }

      // Remove highlight after delay
      if (isSingle) {
        const hlEl = mechSimStat.querySelector('.mech-stat-value.highlight-last');
        if (hlEl) {
          setTimeout(() => hlEl.classList.remove('highlight-last'), 1500);
        }
      }
    }

    const direction = getDirection();

    // Compute domain for consistent bin alignment
    // Never shrink below the pre-simulated domain
    let lo = Math.min(...allStats, observedStat);
    let hi = Math.max(...allStats, observedStat);
    const pad = (hi - lo) * 0.05 || 0.05;
    lo -= pad; hi += pad;
    if (preSimDomain) {
      lo = Math.min(lo, preSimDomain[0]);
      hi = Math.max(hi, preSimDomain[1]);
    }
    const hlDomain = /** @type {[number,number]} */ ([lo, hi]);

    // Thresholds: snapped for proportions, default for means
    // Pass numBins to match renderChart so delta bars align correctly
    const thresholdOpts = isProp
      ? { domain: hlDomain, thresholds: snappedPropThresholds(sampleN, hlDomain, allStats.length) }
      : { domain: hlDomain, numBins: userBinCount };
    const { bins: fullBins } = computeBins(allStats, thresholdOpts);
    const lockedThresholds = fullBins.slice(1).map(b => b.x0);

    const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
      allStats, prevLength, count, computeBins,
      { domain: hlDomain, thresholds: lockedThresholds, numBins: isProp ? undefined : userBinCount });

    const { pValue, extremeCount } = computePValue(allStats, observedStat, direction);
    displayResults(allStats, observedStat, pValue, extremeCount, direction);
    if (resetBtn) resetBtn.hidden = false;

    if (count === 1) {
      setTimeout(() => {
        renderChart(allStats, observedStat, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
        if (mechSimStat && chartContainer) {
          animateDropToChart(mechSimStat, chartContainer);
        }
      }, 150);
    } else {
      renderChart(allStats, observedStat, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
    }
    announce(`Generated ${count} simulation${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
  }

  // ─── Chart rendering ───

  /**
   * @param {number[]} stats
   * @param {number} observed
   * @param {'left'|'right'|'both'} direction
   * @param {number} [highlightIndex]
   * @param {Set<number>} [highlightIndices]
   * @param {number[]} [prevBinCounts]
   * @param {[number,number]} [hlDomain]
   * @param {number[]} [hlThresholds]
   */
  function renderChart(stats, observed, direction, highlightIndex = -1, highlightIndices, prevBinCounts, hlDomain, hlThresholds) {
    chartContainer.innerHTML = '';
    const n = stats.length;

    let cLo = n > 0 ? Math.min(...stats, observed) : observed;
    let cHi = n > 0 ? Math.max(...stats, observed) : observed;
    const cPad = (cHi - cLo) * 0.05 || 0.05;
    cLo -= cPad; cHi += cPad;
    if (preSimDomain) {
      cLo = Math.min(cLo, preSimDomain[0]);
      cHi = Math.max(cHi, preSimDomain[1]);
    }
    /** @type {[number, number]} */
    const domain = hlDomain || [cLo, cHi];

    const activeChart = getActiveChartType();
    if (setToggleSelected) setToggleSelected(activeChart);
    if (binAdjuster) binAdjuster.setMode(/** @type {'dotplot'|'histogram'} */ (activeChart));

    lastHistResult = null;
    lastDotResult = null;
    const precision = displayPrecision(dataPrecision, { proportion: isProp, sampleN });
    const nullVal = getNullValue();

    const { pValue } = n > 0 ? computePValue(stats, observed, direction) : { pValue: 0 };

    const result = renderSimChart(chartContainer, stats, {
      chartType: activeChart,
      id: 'sim-chart',
      xLabel,
      titleText: 'Null Distribution',
      domain,
      observedStat: observed,
      direction,
      nullCenter: nullVal,
      highlightIndex,
      highlightIndices,
      prevBinCounts,
      thresholds: hlThresholds || histogramThresholds({ proportion: isProp, sampleN, domain, dataLength: n }),
      numBins: isProp ? dotplotBins(n, { proportion: true, sampleN }) : userBinCount,
      precision,
      pillMode: n > 0 ? 'randomization' : undefined,
      pValue,
    });

    if (result.bins && result.bins.length > 0) {
      lastHistResult = { xScale: result.xScale, yScale: result.yScale, bins: result.bins, domain };
    } else if (activeChart === 'dotplot' && result.maxStack > 0) {
      const effectiveBins = isProp ? sampleN : (userBinCount ?? DEFAULT_BINS);
      lastDotResult = { xScale: result.xScale, frame: result.frame, domain, maxStack: result.maxStack, numBins: effectiveBins };
    }

    // Theory overlay (histogram or dotplot)
    if (theoryOverlayOn && (activeChart === 'histogram' || activeChart === 'dotplot')) {
      applyTheoryOverlay();
    }
  }

  // ─── P-value & extremes ───

  /** @type {(v: number, obs: number, dir: 'left'|'right'|'both') => boolean} */
  function isExtreme(v, obs, dir) {
    return isExtremeShared(v, obs, dir, getNullValue());
  }

  /**
   * @param {number[]} stats
   * @param {number} observed
   * @param {'left'|'right'|'both'} direction
   */
  function computePValue(stats, observed, direction) {
    let extremeCount = 0;
    const nullVal = getNullValue();
    for (const s of stats) {
      if (direction === 'right' && s >= observed) extremeCount++;
      else if (direction === 'left' && s <= observed) extremeCount++;
      else if (direction === 'both' && Math.abs(s - nullVal) >= Math.abs(observed - nullVal)) extremeCount++;
    }
    return { pValue: extremeCount / stats.length, extremeCount };
  }

  // ─── Results display ───

  /**
   * @param {number[]} stats
   * @param {number} observed
   * @param {number} pValue
   * @param {number} extremeCount
   * @param {'left'|'right'|'both'} direction
   */
  function displayResults(stats, observed, pValue, extremeCount, direction) {
    const dirLabel = direction === 'both' ? 'two-sided'
      : direction === 'right' ? 'right-tail' : 'left-tail';
    let strength;
    if (pValue < 0.01) strength = 'very strong';
    else if (pValue < 0.05) strength = 'strong';
    else if (pValue < 0.10) strength = 'moderate';
    else strength = 'little';

    const nullVal = getNullValue();
    const nullParam = isProp ? 'p\u2080' : '\u03BC\u2080';
    const nullSymbol = isProp ? 'p' : '\u03BC';
    const statName = isProp ? 'proportions' : 'means';

    const defaultNull = isProp
      ? `${nullSymbol} = ${nullVal}`
      : `${nullSymbol} = ${nullVal}`;
    const nullDesc = datasetContext.nullClaim || defaultNull;
    const pFmt = formatStat(pValue, 0, 'pvalue');
    const pDisplay = pFmt.startsWith('p') ? pFmt : `p-value: ${pFmt}`;

    resultDiv.innerHTML = `
      <p><strong>Null Distribution</strong> (${stats.length} simulations, ${nullParam} = ${nullVal})</p>
      <p>Observed <span class="observed-highlight">${statSymbolHTML} = ${fmtObs(observed)}</span></p>
      <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
      <p><strong>${pDisplay}</strong></p>
      <p class="interpretation">${extremeCount} of ${stats.length} simulated ${statName} were at least as extreme as the observed <span class="observed-highlight">${statSymbolHTML} = ${fmtObs(observed)}</span>. This provides ${strength} evidence against H\u2080: ${nullDesc}.</p>
    `;
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
    mechanismInitialized = false;
    seed = Math.random().toString(36).slice(2, 10);
    chartContainer.innerHTML = '';
    resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'run a simulation to see results')}</p>`;
    if (resetBtn) resetBtn.hidden = true;
    // Hide mechanism strip (will re-show on next first generate)
    if (mechanismStrip) mechanismStrip.hidden = true;
  }

  // ─── Theory overlay ───

  function applyTheoryOverlay() {
    if (!chartContainer || sampleN === 0) return;
    if (!lastHistResult && !lastDotResult) return;
    const nullVal = getNullValue();
    let se;

    if (isProp) {
      se = Math.sqrt(nullVal * (1 - nullVal) / sampleN);
    } else {
      const sampleSD = sd(sampleData);
      se = sampleSD / Math.sqrt(sampleN);
    }
    if (!isFinite(se) || se <= 0) return;

    const label = isProp ? `N(${nullVal}, ${se.toFixed(3)})` : 'N(\u03BC\u2080, SE)';

    if (lastHistResult) {
      const { xScale: hxScale, yScale: hyScale, bins, domain: dom } = lastHistResult;
      if (bins.length === 0) return;
      const binWidth = /** @type {number} */ (bins[0].x1) - /** @type {number} */ (bins[0].x0);

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, nullVal, se),
        xDomain: dom,
        totalN: allStats.length,
        binWidth,
        xScale: hxScale,
        yScale: hyScale,
        label,
      });
    } else if (lastDotResult) {
      const { xScale: dxScale, frame, domain: dom, maxStack, numBins } = lastDotResult;
      const peakPdf = normalPdf(nullVal, nullVal, se);
      if (peakPdf <= 0 || maxStack <= 0) return;

      const dotRadius = computeDotRadius(frame.width, frame.height, maxStack, numBins);
      const stackHeightPx = maxStack * dotRadius * 2;
      const scaleFactor = stackHeightPx / peakPdf;
      const yScale = (/** @type {number} */ freqY) => frame.height - freqY;

      overlayTheoryCurve({
        container: chartContainer,
        pdf: (x) => normalPdf(x, nullVal, se),
        xDomain: dom,
        totalN: 1,
        binWidth: scaleFactor,
        xScale: dxScale,
        yScale,
        label,
      });
    }
  }
}
