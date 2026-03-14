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
import { drawDotplot } from './dotplot.js';
import { renderSimPills } from './chart-utils.js';
import { announce, initKeyboardShortcuts, initPlayPause, initTabs, flashMechanism, initDataPanel, computeHighlights, initHelp, initSettings } from './page-utils.js';
import { normalPdf, overlayTheoryCurve, removeTheoryOverlay, createTheoryToggle } from './theory-overlay.js';

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

  initTabs();
  initKeyboardShortcuts(genBtns, resetBtn);
  initPlayPause(genBtns, resetBtn);
  initHelp();
  initSettings();

  // ─── Mode-dependent constants ───

  const xLabel = isProp ? 'Sample Proportion (p\u0302)' : 'Simulated Mean (x\u0304*)';
  const chartTypes = /** @type {[string, string][]} */ (
    [['dotplot', 'Dotplot'], ['histogram', 'Histogram']]);

  // ─── Chart type toggle ───

  let chartType = 'auto';
  const chartParent = chartContainer?.parentElement;
  /** @type {HTMLFieldSetElement|null} */
  let toggleFieldset = null;
  if (chartParent) {
    toggleFieldset = document.createElement('fieldset');
    toggleFieldset.className = 'chart-type-toggle';
    toggleFieldset.insertAdjacentHTML('beforeend', chartTypes.map(([v, l]) =>
      `<label class="chart-toggle-option"><input type="radio" name="chart-type" value="${v}"${v === 'dotplot' ? ' checked' : ''}> ${l}</label>`
    ).join(''));
    chartParent.insertBefore(toggleFieldset, chartContainer);
    toggleFieldset.addEventListener('change', (e) => {
      const radio = /** @type {HTMLInputElement} */ (e.target);
      if (!radio.value) return;
      chartType = radio.value;
      if (allStats.length > 0) {
        renderChart(allStats, observedStat, getDirection());
      }
    });

    createTheoryToggle(toggleFieldset, (checked) => {
      theoryOverlayOn = checked;
      if (allStats.length > 0 && chartContainer) {
        if (checked && getActiveChartType() === 'histogram') {
          applyTheoryOverlay();
        } else {
          removeTheoryOverlay(chartContainer);
        }
      }
    });
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

  /** @type {{ xScale: any, yScale: any, bins: any[], domain: [number,number] } | null} */
  let lastHistResult = null;

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
    if (chartType === 'auto') {
      return allStats.length <= 200 ? 'dotplot' : 'histogram';
    }
    return chartType;
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
    if (dataPreview) dataPreview.hidden = false;
    if (hypothesisDisplay) hypothesisDisplay.hidden = false;
    for (const btn of genBtns) btn.disabled = false;
    resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';
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
        dataSummary.innerHTML = `n = ${sampleN}, successes = ${sampleSuccesses} ("${successVal}"), <span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>`;
      }

      if (mechanismStrip && mechObservedStat) {
        mechanismStrip.hidden = false;
        mechObservedStat.innerHTML = `${sampleSuccesses} of ${sampleN} (<span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>)`;
      }
      scrollToControls();
    }

    initDataPanel({
      datasetFilter: (/** @type {any} */ ds) => ds.type === 'bootstrap_prop',
      onDataset: (/** @type {any} */ ds) => {
        const catVar = ds.variables.find(/** @param {any} v */ v => v.type === 'categorical') || ds.variables[0];
        if (!catVar) { announce('No categorical variable found.'); return; }
        rawOutcomes = ds.rows.map(/** @param {any} r */ r => String(r[catVar.name]));
        const levels = [...new Set(rawOutcomes)];
        const ctx = ds.context || {};
        populateSuccessSelector(levels, ctx.successLabel);
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
        populateSuccessSelector([...new Set(rawOutcomes)]);
      },
      onClear: () => {
        rawOutcomes = [];
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
          dataSummary.innerHTML = `n = ${n}, successes = ${k}, <span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>`;
        }
        if (mechanismStrip && mechObservedStat) {
          mechanismStrip.hidden = false;
          mechObservedStat.innerHTML = `${k} of ${n} (<span class="observed-highlight">p\u0302 = ${fmtObs(observedStat)}</span>)`;
        }
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
        dataSummary.innerHTML = `n = ${sampleN}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedStat, dataPrecision)}</span>, s = ${formatStat(sampleSD, dataPrecision)}`;
      }

      computeShiftedData();

      if (mechanismStrip && mechObservedStat) {
        mechanismStrip.hidden = false;
        mechObservedStat.innerHTML = `n = ${sampleN}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedStat, dataPrecision)}</span>`;
      }
      scrollToControls();
    }

    function computeShiftedData() {
      const mu0 = getNullValue();
      const shift = mu0 - observedStat;
      shiftedData = sampleData.map(v => v + shift);
    }

    initDataPanel({
      datasetFilter: (/** @type {any} */ ds) => ds.hasNumeric !== false,
      onDataset: (/** @type {any} */ ds) => {
        const numVar = ds.variables.find(/** @param {any} v */ v => v.type === 'numeric') || ds.variables[0];
        if (!numVar) { announce('No numeric variable found.'); return; }
        const values = ds.rows
          .map(/** @param {any} r */ r => Number(r[numVar.name]))
          .filter(/** @param {number} v */ v => isFinite(v));
        if (values.length === 0) { announce('No valid numeric values found.'); return; }
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
        loadNumericData(values);
      },
      onClear: () => {
        sampleData = [];
        shiftedData = [];
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
    const prevLength = allStats.length;

    if (simTitleEl) {
      simTitleEl.textContent = count === 1 ? 'This Simulation' : 'Last Simulation';
    }

    let lastSimStat = 0;
    let lastSimDetail = '';

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
      lastSimDetail = `${lastSuccesses} of ${n} (p\u0302 = ${fmtObs(lastSimStat)})`;

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
        allStats.push(simMean);
      }
      lastSimDetail = `<span class="x-bar">x</span>* = ${formatStat(lastSimStat, dataPrecision)}`;

      if (mechanismDescEl) {
        mechanismDescEl.textContent = `Resample ${n} values (with replacement) from data shifted to \u03BC\u2080 = ${getNullValue()}, compute mean`;
        mechanismDescEl.hidden = false;
      }
    }

    if (mechSimStat) {
      mechSimStat.innerHTML = lastSimDetail;
    }

    const direction = getDirection();

    // Compute domain for consistent bin alignment
    const lo = Math.min(...allStats, observedStat);
    const hi = Math.max(...allStats, observedStat);
    const pad = (hi - lo) * 0.05 || 0.05;
    const hlDomain = /** @type {[number,number]} */ ([lo - pad, hi + pad]);

    // Thresholds: snapped for proportions, default for means
    const thresholdOpts = isProp
      ? { domain: hlDomain, thresholds: snappedPropThresholds(sampleN, hlDomain, allStats.length) }
      : { domain: hlDomain };
    const { bins: fullBins } = computeBins(allStats, thresholdOpts);
    const lockedThresholds = fullBins.slice(1).map(b => b.x0);

    const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
      allStats, prevLength, count, computeBins,
      { domain: hlDomain, thresholds: lockedThresholds });

    const { pValue, extremeCount } = computePValue(allStats, observedStat, direction);
    displayResults(allStats, observedStat, pValue, extremeCount, direction);
    if (resetBtn) resetBtn.hidden = false;

    if (count === 1) {
      setTimeout(() => {
        flashMechanism(mechanismStrip);
        setTimeout(() => {
          renderChart(allStats, observedStat, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
        }, 120);
      }, 120);
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

    const lo = Math.min(...stats, observed);
    const hi = Math.max(...stats, observed);
    const pad = (hi - lo) * 0.05 || 0.05;
    /** @type {[number, number]} */
    const domain = hlDomain || [lo - pad, hi + pad];

    let activeChart = getActiveChartType();
    // Sync toggle
    if (toggleFieldset) {
      const radio = /** @type {HTMLInputElement|null} */ (
        toggleFieldset.querySelector(`input[value="${activeChart}"]`));
      if (radio) radio.checked = true;
    }

    /** @type {import('./chart-utils.js').ChartFrame} */
    let frame;
    /** @type {any} */
    let xScale;
    lastHistResult = null;

    const precision = isProp ? 2 : dataPrecision;

    if (activeChart === 'dotplot') {
      const dotOpts = {
        id: 'sim-chart',
        xLabel,
        titleText: 'Null Distribution',
        isExtreme: (/** @type {number} */ v) => isExtreme(v, observed, direction),
        observedStat: observed,
        animate: false,
        domain,
        highlightIndex,
        highlightIndices,
        precision,
        numBins: /** @type {number|undefined} */ (undefined),
      };
      if (isProp && sampleN <= 50) {
        dotOpts.numBins = sampleN;
      }
      const r = drawDotplot(chartContainer, stats, dotOpts);
      frame = r.frame;
      xScale = r.xScale;
    } else {
      const propThresholds = hlThresholds || (isProp ? snappedPropThresholds(sampleN, domain, n) : undefined);
      const histDomain = hlDomain || domain;
      const r = drawHistogram(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText: 'Null Distribution',
        isTail: (/** @type {number} */ v) => isExtreme(v, observed, direction),
        observedStat: observed,
        animate: false,
        domain: histDomain,
        thresholds: propThresholds,
        prevBinCounts,
        precision,
      });
      frame = r.frame;
      xScale = r.xScale;
      lastHistResult = { xScale: r.xScale, yScale: r.yScale, bins: r.bins, domain: histDomain };
    }

    // P-value pills
    if (stats.length > 0) {
      const { pValue } = computePValue(stats, observed, direction);
      renderSimPills(frame, xScale, {
        mode: 'randomization', pValue, observedStat: observed, direction,
      });
    }

    // Theory overlay (only on histogram)
    if (theoryOverlayOn && activeChart === 'histogram') {
      applyTheoryOverlay();
    }
  }

  // ─── P-value & extremes ───

  /**
   * @param {number} v
   * @param {number} obs
   * @param {'left'|'right'|'both'} dir
   */
  function isExtreme(v, obs, dir) {
    if (dir === 'left') return v <= obs;
    if (dir === 'both') return Math.abs(v - getNullValue()) >= Math.abs(obs - getNullValue());
    return v >= obs;
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

    resultDiv.innerHTML = `
      <p><strong>Null Distribution</strong> (${stats.length} simulations, ${nullParam} = ${nullVal})</p>
      <p>Observed <span class="observed-highlight">${statSymbolHTML} = ${fmtObs(observed)}</span></p>
      <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
      <p><strong>p-value:</strong> ${formatStat(pValue, 0, 'pvalue')}</p>
      <p class="interpretation">${extremeCount} of ${stats.length} simulated ${statName} were at least as extreme as the observed <span class="observed-highlight">${statSymbolHTML} = ${fmtObs(observed)}</span>. This provides ${strength} evidence against H\u2080: ${nullSymbol} = ${nullVal}.</p>
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
    seed = Math.random().toString(36).slice(2, 10);
    chartContainer.innerHTML = '';
    resultDiv.innerHTML = '<p class="placeholder">Enter sample data and run a simulation to see results.</p>';
    if (resetBtn) resetBtn.hidden = true;
  }

  // ─── Theory overlay ───

  function applyTheoryOverlay() {
    if (!chartContainer || !lastHistResult || sampleN === 0) return;
    const nullVal = getNullValue();
    let se;

    if (isProp) {
      se = Math.sqrt(nullVal * (1 - nullVal) / sampleN);
    } else {
      const sampleSD = sd(sampleData);
      se = sampleSD / Math.sqrt(sampleN);
    }
    if (!isFinite(se) || se <= 0) return;

    const { xScale: hxScale, yScale: hyScale, bins, domain: dom } = lastHistResult;
    if (bins.length === 0) return;
    const binWidth = /** @type {number} */ (bins[0].x1) - /** @type {number} */ (bins[0].x0);

    const label = isProp ? `N(${nullVal}, ${se.toFixed(3)})` : 'N(\u03BC\u2080, SE)';

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
  }
}
