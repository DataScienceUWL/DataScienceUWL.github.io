// @ts-check
/**
 * Randomization test for a single mean (shifted bootstrap).
 *
 * Algorithm:
 *   1. User provides sample data and null hypothesis mean mu0.
 *   2. Compute observed sample mean xbar.
 *   3. Shift data: shifted[i] = original[i] - xbar + mu0 (centers at mu0).
 *   4. Each simulation: resample WITH replacement from shifted data, compute mean.
 *   5. p-value = proportion of simulated means as extreme as xbar.
 */

import { createRng, sampleWithReplacement } from '../../js/prng.js';
import { mean, sd, detectPrecision, formatStat } from '../../js/stats.js';
import { drawHistogram, computeBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { drawSpike } from '../../js/spike.js';
import { renderSimPills } from '../../js/chart-utils.js';
import { announce, initKeyboardShortcuts, initPlayPause, initTabs, flashMechanism, initDataPanel, computeHighlights } from '../../js/page-utils.js';
import { normalPdf, overlayTheoryCurve, removeTheoryOverlay, createTheoryToggle } from '../../js/theory-overlay.js';

// ─── DOM elements ───

const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const hypothesisDisplay = document.getElementById('hypothesis-display');

const nullMeanInput = /** @type {HTMLInputElement} */ (document.getElementById('null-mean'));
const altDirectionBtn = /** @type {HTMLButtonElement} */ (document.getElementById('alt-direction'));
const altNullValue = document.getElementById('alt-null-value');

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

// Mechanism strip elements
const mechanismStrip = document.getElementById('mechanism-strip');
const mechObservedStat = document.getElementById('mech-observed-stat');
const mechSimStat = document.getElementById('mech-sim-stat');
const mechanismDescEl = document.getElementById('mechanism-description');
const simTitleEl = document.getElementById('sim-title');

initTabs();
initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── Chart type toggle ───

let chartType = 'auto';
const chartFigure = chartContainer?.closest('figure');
/** @type {HTMLFieldSetElement|null} */
let toggleFieldset = null;
if (chartFigure) {
  toggleFieldset = document.createElement('fieldset');
  toggleFieldset.className = 'chart-type-toggle';
  toggleFieldset.insertAdjacentHTML('beforeend', [
    ['dotplot', 'Dotplot'], ['histogram', 'Histogram'],
  ].map(([v, l]) =>
    `<label class="chart-toggle-option"><input type="radio" name="chart-type" value="${v}"${v === 'dotplot' ? ' checked' : ''}> ${l}</label>`
  ).join(''));
  chartFigure.insertBefore(toggleFieldset, chartContainer);
  toggleFieldset.addEventListener('change', (e) => {
    const radio = /** @type {HTMLInputElement} */ (e.target);
    if (!radio.value) return;
    chartType = radio.value;
    if (allStats.length > 0) {
      const direction = getDirection();
      renderChart(allStats, observedMean, direction);
    }
  });

  // Theory overlay toggle
  createTheoryToggle(toggleFieldset, (checked) => {
    theoryOverlayOn = checked;
    if (allStats.length > 0 && chartContainer) {
      if (checked && chartType === 'histogram') {
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

/** @type {number[]} */
let sampleData = [];
let observedMean = 0;
let dataPrecision = 0;
let theoryOverlayOn = false;

/** @type {{ xScale: any, yScale: any, bins: any[], domain: [number,number] } | null} */
let lastHistResult = null;

/** @type {number[]} */
let shiftedData = [];

// ─── Dataset + File + Paste loading ───

initDataPanel({
  datasetFilter: (/** @type {any} */ ds) => ds.hasNumeric !== false,
  onDataset: (ds) => {
    const numVar = ds.variables.find(/** @param {any} v */ v => v.type === 'numeric') || ds.variables[0];
    if (!numVar) { announce('No numeric variable found.'); return; }
    const values = ds.rows
      .map(/** @param {any} r */ r => Number(r[numVar.name]))
      .filter(/** @param {number} v */ v => isFinite(v));
    if (values.length === 0) { announce('No valid numeric values found.'); return; }
    loadNumericData(values);
    announce(`${ds.name}.`);
  },
  onText: (parsed) => {
    const numIdx = parsed.types.indexOf('numeric');
    if (numIdx < 0) {
      announce('Need at least one numeric column.');
      return;
    }
    const colName = parsed.headers[numIdx];
    const values = parsed.data
      .map(r => Number(r[colName]))
      .filter(v => isFinite(v));
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

/**
 * Load numeric data into the page state.
 * @param {number[]} values
 */
function loadNumericData(values) {
  sampleData = values;
  observedMean = mean(sampleData);
  dataPrecision = detectPrecision(sampleData);

  resetSimulation();

  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) {
    const sampleSD = sd(sampleData);
    dataSummary.innerHTML = `n = ${sampleData.length}, <span class="x-bar">x</span> = ${formatStat(observedMean, dataPrecision)}, s = ${formatStat(sampleSD, dataPrecision)}`;
  }
  if (hypothesisDisplay) hypothesisDisplay.hidden = false;
  for (const btn of genBtns) btn.disabled = false;
  resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  // Update shifted data
  computeShiftedData();

  if (mechanismStrip && mechObservedStat) {
    mechanismStrip.hidden = false;
    mechObservedStat.innerHTML = `n = ${sampleData.length}, <span class="observed-highlight"><span class="x-bar">x</span> = ${formatStat(observedMean, dataPrecision)}</span>`;
  }

  setTimeout(() => {
    const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

/**
 * Compute shifted data centered at the null hypothesis mean.
 * shifted[i] = original[i] - xbar + mu0
 */
function computeShiftedData() {
  const mu0 = getNullMean();
  const shift = mu0 - observedMean;
  shiftedData = sampleData.map(v => v + shift);
}

// ─── Null mean & direction ───

function getNullMean() {
  const val = parseFloat(nullMeanInput?.value);
  if (!isFinite(val)) return 0;
  return val;
}

function getDirection() {
  const alt = altDirectionBtn?.dataset.value ?? 'greater';
  if (alt === 'greater') return /** @type {const} */ ('right');
  if (alt === 'less') return /** @type {const} */ ('left');
  return /** @type {const} */ ('both');
}

/** Sync the alternative hypothesis display with the null mean input value. */
function syncAltNullValue() {
  if (altNullValue) altNullValue.textContent = nullMeanInput?.value ?? '0';
}

if (nullMeanInput) {
  nullMeanInput.addEventListener('change', () => {
    syncAltNullValue();
    computeShiftedData();
    if (allStats.length > 0) {
      resetSimulation();
      resultDiv.innerHTML = '<p class="hint">Null mean changed. Run simulation again.</p>';
      announce('Null mean changed. Simulation reset.');
    }
  });
  nullMeanInput.addEventListener('input', syncAltNullValue);
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
      renderChart(allStats, observedMean, direction);
      const { pValue, extremeCount } = computePValue(allStats, observedMean, direction);
      displayResults(allStats, observedMean, pValue, extremeCount, direction);
    }
  });
}

// ─── Generate ───

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.count, 10);
    if (sampleData.length === 0) {
      announce('Please load data first.');
      return;
    }
    generateSimulations(count);
  });
}

/** @param {number} count */
function generateSimulations(count) {
  if (!rng) rng = createRng(seed);
  const n = shiftedData.length;
  const prevLength = allStats.length;

  if (simTitleEl) {
    simTitleEl.textContent = count === 1 ? 'This Simulation' : 'Last Simulation';
  }

  let lastSimMean = 0;
  for (let i = 0; i < count; i++) {
    const resampleArr = sampleWithReplacement(shiftedData, n, rng);
    const simMean = mean(/** @type {number[]} */ (resampleArr));
    lastSimMean = simMean;
    allStats.push(simMean);
  }

  if (mechSimStat && mechanismDescEl) {
    mechSimStat.innerHTML = `<span class="x-bar">x</span>* = ${formatStat(lastSimMean, dataPrecision)}`;
    mechanismDescEl.textContent = `Resample ${n} values (with replacement) from data shifted to \u03BC\u2080 = ${getNullMean()}, compute mean`;
    mechanismDescEl.hidden = false;
  }

  const direction = getDirection();

  // Compute domain for consistent bin alignment
  const lo = Math.min(...allStats, observedMean);
  const hi = Math.max(...allStats, observedMean);
  const pad = (hi - lo) * 0.05 || 0.05;
  const hlDomain = /** @type {[number,number]} */ ([lo - pad, hi + pad]);

  const { bins: fullBins } = computeBins(allStats, { domain: hlDomain });
  const lockedThresholds = fullBins.slice(1).map(b => b.x0);

  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    allStats, prevLength, count, computeBins,
    { domain: hlDomain, thresholds: lockedThresholds });

  const { pValue, extremeCount } = computePValue(allStats, observedMean, direction);
  displayResults(allStats, observedMean, pValue, extremeCount, direction);
  if (resetBtn) resetBtn.hidden = false;

  if (count === 1) {
    setTimeout(() => {
      flashMechanism(mechanismStrip);
      setTimeout(() => {
        renderChart(allStats, observedMean, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
      }, 120);
    }, 120);
  } else {
    renderChart(allStats, observedMean, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
  }
  announce(`Generated ${count} simulation${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
}

// ─── Chart ───

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

  // Determine active chart type
  let activeChart = chartType;
  if (activeChart === 'auto') {
    activeChart = n <= 200 ? 'dotplot' : 'histogram';
  }
  if (activeChart === 'spike') activeChart = 'histogram'; // no spike for continuous
  // Sync toggle
  if (toggleFieldset) {
    const radio = /** @type {HTMLInputElement|null} */ (
      toggleFieldset.querySelector(`input[value="${activeChart}"]`));
    if (radio) radio.checked = true;
  }

  /** @type {import('../../js/chart-utils.js').ChartFrame} */
  let frame;
  /** @type {any} */
  let xScale;
  lastHistResult = null;

  if (activeChart === 'dotplot') {
    const r = drawDotplot(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Simulated Mean (x\u0304*)',
      titleText: 'Null Distribution',
      isExtreme: (v) => isExtreme(v, observed, direction),
      observedStat: observed,
      animate: false,
      domain,
      highlightIndex,
      highlightIndices,
    });
    frame = r.frame;
    xScale = r.xScale;
  } else {
    const r = drawHistogram(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Simulated Mean (x\u0304*)',
      titleText: 'Null Distribution',
      isTail: (v) => isExtreme(v, observed, direction),
      observedStat: observed,
      animate: false,
      domain: domain,
      thresholds: hlThresholds,
      prevBinCounts,
    });
    frame = r.frame;
    xScale = r.xScale;
    lastHistResult = { xScale: r.xScale, yScale: r.yScale, bins: r.bins, domain };
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

/**
 * @param {number} v
 * @param {number} obs
 * @param {'left'|'right'|'both'} dir
 */
function isExtreme(v, obs, dir) {
  if (dir === 'left') return v <= obs;
  if (dir === 'both') return Math.abs(v - getNullMean()) >= Math.abs(obs - getNullMean());
  return v >= obs;
}

/**
 * @param {number[]} stats
 * @param {number} observed
 * @param {'left'|'right'|'both'} direction
 */
function computePValue(stats, observed, direction) {
  let extremeCount = 0;
  const mu0 = getNullMean();
  for (const s of stats) {
    if (direction === 'right' && s >= observed) extremeCount++;
    else if (direction === 'left' && s <= observed) extremeCount++;
    else if (direction === 'both' && Math.abs(s - mu0) >= Math.abs(observed - mu0)) extremeCount++;
  }
  return { pValue: extremeCount / stats.length, extremeCount };
}

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
  const fmtS = (v) => formatStat(v, dataPrecision);
  resultDiv.innerHTML = `
    <p><strong>Null Distribution</strong> (${stats.length} simulations, \u03BC\u2080 = ${getNullMean()})</p>
    <p>Observed <span class="x-bar">x</span> = ${fmtS(observed)}</p>
    <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
    <p><strong>p-value:</strong> ${formatStat(pValue, 0, 'pvalue')}</p>
    <p class="interpretation">${extremeCount} of ${stats.length} simulated means were at least as extreme as the observed <span class="x-bar">x</span> = ${fmtS(observed)}. This provides ${strength} evidence against H\u2080: \u03BC = ${getNullMean()}.</p>
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

/**
 * Overlay the normal approximation N(μ₀, s/√n) on the histogram.
 * Under the null, the sampling distribution of x̄ is approximately normal
 * centered at μ₀ with SE = s/√n.
 */
function applyTheoryOverlay() {
  if (!chartContainer || !lastHistResult || sampleData.length === 0) return;
  const mu0 = getNullMean();
  const sampleSD = sd(sampleData);
  const se = sampleSD / Math.sqrt(sampleData.length);
  if (!isFinite(se) || se <= 0) return;

  const { xScale: hxScale, yScale: hyScale, bins, domain: dom } = lastHistResult;
  if (bins.length === 0) return;
  const binWidth = /** @type {number} */ (bins[0].x1) - /** @type {number} */ (bins[0].x0);

  overlayTheoryCurve({
    container: chartContainer,
    pdf: (x) => normalPdf(x, mu0, se),
    xDomain: dom,
    totalN: allStats.length,
    binWidth,
    xScale: hxScale,
    yScale: hyScale,
    label: `N(μ₀, SE)`,
  });
}
