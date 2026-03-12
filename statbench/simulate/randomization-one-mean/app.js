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
import * as d3Select from 'd3-selection';
import { announce, initKeyboardShortcuts, initPlayPause, initTabs, flashMechanism, initDataPanel, computeHighlights } from '../../js/page-utils.js';

// ─── DOM elements ───

const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const hypothesisDisplay = document.getElementById('hypothesis-display');

const nullMeanInput = /** @type {HTMLInputElement} */ (document.getElementById('null-mean'));
const altDirectionSelect = /** @type {HTMLSelectElement} */ (document.getElementById('alt-direction'));

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
    ['dotplot', 'Dotplot'], ['spike', 'Spike'], ['histogram', 'Histogram'],
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
    dataSummary.textContent = `n = ${sampleData.length}, x\u0304 = ${formatStat(observedMean, dataPrecision)}, s = ${formatStat(sampleSD, dataPrecision)}`;
  }
  if (hypothesisDisplay) hypothesisDisplay.hidden = false;
  for (const btn of genBtns) btn.disabled = false;
  resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  // Update shifted data
  computeShiftedData();

  if (mechanismStrip && mechObservedStat) {
    mechanismStrip.hidden = false;
    mechObservedStat.textContent = `n = ${sampleData.length}, x\u0304 = ${formatStat(observedMean, dataPrecision)}`;
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
  const alt = altDirectionSelect?.value ?? 'greater';
  if (alt === 'greater') return /** @type {const} */ ('right');
  if (alt === 'less') return /** @type {const} */ ('left');
  return /** @type {const} */ ('both');
}

if (nullMeanInput) {
  nullMeanInput.addEventListener('change', () => {
    computeShiftedData();
    if (allStats.length > 0) {
      resetSimulation();
      resultDiv.innerHTML = '<p class="hint">Null mean changed. Run simulation again.</p>';
      announce('Null mean changed. Simulation reset.');
    }
  });
}

if (altDirectionSelect) {
  altDirectionSelect.addEventListener('change', () => {
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
    mechSimStat.textContent = `x\u0304* = ${formatStat(lastSimMean, dataPrecision)}`;
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
  } else if (activeChart === 'spike') {
    const r = drawSpike(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Simulated Mean (x\u0304*)',
      titleText: 'Null Distribution',
      isTail: (v) => isExtreme(v, observed, direction),
      observedStat: observed,
      domain,
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
  }

  // P-value pills
  if (stats.length > 0) {
    const { pValue } = computePValue(stats, observed, direction);
    renderPValuePills(frame, xScale, pValue, observed, direction);
  }
}

/**
 * Render p-value pills on the chart.
 * @param {import('../../js/chart-utils.js').ChartFrame} frame
 * @param {any} xScale
 * @param {number} pValue
 * @param {number} observed
 * @param {'left'|'right'|'both'} direction
 */
function renderPValuePills(frame, xScale, pValue, observed, direction) {
  const annotations = d3Select.select(frame.inner).select('.annotations');
  const w = frame.width;
  const pillY = frame.height * 0.22;
  const obsX = xScale(observed);
  const comp = 1 - pValue;

  const pText = formatStat(pValue, 0, 'pvalue');

  if (direction === 'both') {
    const labelX = Math.max(60, Math.min(w - 60, obsX));
    _pill(annotations, `${pText}  (two-tailed)`, labelX, pillY, false);
  } else if (direction === 'left') {
    _pill(annotations, pText, Math.max(50, obsX / 2), pillY, false);
    _pill(annotations, formatStat(comp, 0, 'proportion'), Math.min(w - 50, (obsX + w) / 2), pillY, true);
  } else {
    _pill(annotations, pText, Math.min(w - 50, (obsX + w) / 2), pillY, false);
    _pill(annotations, formatStat(comp, 0, 'proportion'), Math.max(50, obsX / 2), pillY, true);
  }
}

/** @param {any} g @param {string} text @param {number} cx @param {number} cy @param {boolean} isComp */
function _pill(g, text, cx, cy, isComp) {
  const group = g.append('g').attr('class', 'sim-pill');
  const tw = text.length * 8.5 + 16;
  const ph = 24;
  group.append('rect')
    .attr('x', cx - tw / 2).attr('y', cy - ph / 2)
    .attr('width', tw).attr('height', ph).attr('rx', 4)
    .attr('fill', isComp ? '#f5f5f5' : '#e8f4f8')
    .attr('stroke', isComp ? '#ccc' : '#569BBD')
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');
  group.append('text')
    .attr('class', isComp ? 'prob-label prob-complement' : 'prob-label')
    .attr('x', cx).attr('y', cy)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', isComp ? '#6B6B6B' : '#114B5F')
    .style('pointer-events', 'none')
    .text(text);
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
    <p>Observed x\u0304 = ${fmtS(observed)}</p>
    <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
    <p><strong>p-value:</strong> ${formatStat(pValue, 0, 'pvalue')}</p>
    <p class="interpretation">${extremeCount} of ${stats.length} simulated means were at least as extreme as the observed x\u0304 = ${fmtS(observed)}. This provides ${strength} evidence against H\u2080: \u03BC = ${getNullMean()}.</p>
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
