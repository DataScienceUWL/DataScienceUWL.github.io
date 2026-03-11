// @ts-check
/**
 * One-proportion randomization test page.
 * Simulates from Bernoulli(p₀) under the null to build a null distribution of p̂.
 */

import { createRng } from '../../js/prng.js';
import { mean, formatStat } from '../../js/stats.js';
import { drawHistogram, computeBins, snappedPropThresholds } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { drawSpike } from '../../js/spike.js';
import * as d3Select from 'd3-selection';
import { announce, initKeyboardShortcuts, initPlayPause, initTabs, flashMechanism, initDataPanel, computeHighlights } from '../../js/page-utils.js';

// DOM elements
const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const hypothesisDisplay = document.getElementById('hypothesis-display');

const inputN = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));
const inputSuccesses = /** @type {HTMLInputElement} */ (document.getElementById('input-successes'));
const loadSummaryBtn = document.getElementById('load-summary');
const nullPropInput = /** @type {HTMLInputElement} */ (document.getElementById('null-prop'));
const altDirectionSelect = /** @type {HTMLSelectElement} */ (document.getElementById('alt-direction'));
const successSelector = document.getElementById('success-selector');
const successOutcome = /** @type {HTMLSelectElement} */ (document.getElementById('success-outcome'));

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
/** @type {HTMLDivElement|null} */
let toggleDiv = null;
if (chartFigure) {
  toggleDiv = document.createElement('div');
  toggleDiv.className = 'chart-type-toggle';
  toggleDiv.setAttribute('role', 'group');
  toggleDiv.setAttribute('aria-label', 'Chart type');
  toggleDiv.innerHTML = `
    <button type="button" class="btn-sm" data-chart="dotplot" aria-pressed="true">Dotplot</button>
    <button type="button" class="btn-sm" data-chart="spike" aria-pressed="false">Spike</button>
    <button type="button" class="btn-sm" data-chart="histogram" aria-pressed="false">Histogram</button>`;
  chartFigure.insertBefore(toggleDiv, chartContainer);
  toggleDiv.addEventListener('click', (e) => {
    const btn = /** @type {HTMLButtonElement} */ (e.target);
    if (!btn.dataset.chart) return;
    chartType = btn.dataset.chart;
    for (const b of toggleDiv.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', b === btn ? 'true' : 'false');
    }
    if (allStats.length > 0) {
      const direction = getDirection();
      renderChart(allStats, observedPHat, direction);
    }
  });
}

/** @type {number[]} */
let allStats = [];
/** @type {(() => number)|null} */
let rng = null;
let seed = Math.random().toString(36).slice(2, 10);

let sampleN = 0;
let sampleSuccesses = 0;
let observedPHat = 0;

/** @type {string[]} */
let rawOutcomes = [];

// ─── Dataset + File loading ───

/**
 * Populate success outcome selector from categorical levels.
 * @param {string[]} levels
 * @param {string} [autoSelect] - Auto-select this level if present
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

initDataPanel({
  datasetFilter: ds => ds.type === 'bootstrap_prop',
  onDataset: (ds) => {
    const catVar = ds.variables.find(v => v.type === 'categorical') || ds.variables[0];
    if (!catVar) { announce('No categorical variable found.'); return; }
    rawOutcomes = ds.rows.map(r => String(r[catVar.name]));
    const levels = [...new Set(rawOutcomes)];
    const ctx = ds.context || {};
    populateSuccessSelector(levels, ctx.successLabel);
    announce(`${ds.name}.`);
  },
  onText: (parsed) => {
    const catIdx = parsed.types.indexOf('categorical');
    if (catIdx < 0) {
      announce('Need at least one categorical column.');
      return;
    }
    const colName = parsed.headers[catIdx];
    rawOutcomes = parsed.data.map(r => String(r[colName]));
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

function applyDatasetOutcome() {
  const successVal = successOutcome?.value;
  if (!successVal || rawOutcomes.length === 0) return;

  sampleN = rawOutcomes.length;
  sampleSuccesses = rawOutcomes.filter(v => v === successVal).length;
  observedPHat = sampleSuccesses / sampleN;

  resetSimulation();
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) {
    dataSummary.textContent = `n = ${sampleN}, successes = ${sampleSuccesses} ("${successVal}"), p̂ = ${formatStat(observedPHat, 0, 'proportion')}`;
  }
  if (hypothesisDisplay) hypothesisDisplay.hidden = false;
  for (const btn of genBtns) btn.disabled = false;
  resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  if (mechanismStrip && mechObservedStat) {
    mechanismStrip.hidden = false;
    mechObservedStat.textContent = `${sampleSuccesses} of ${sampleN} (p̂ = ${formatStat(observedPHat, 0, 'proportion')})`;
  }

  setTimeout(() => {
    const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ─── Summary input ───

if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', loadData);
}

function loadData() {
  const n = parseInt(inputN?.value, 10);
  const k = parseInt(inputSuccesses?.value, 10);
  if (!n || n < 1 || !isFinite(k) || k < 0 || k > n) {
    announce('Enter a valid sample size and number of successes.');
    return;
  }

  sampleN = n;
  sampleSuccesses = k;
  observedPHat = k / n;

  resetSimulation();

  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) {
    dataSummary.textContent = `n = ${n}, successes = ${k}, p̂ = ${formatStat(observedPHat, 0, 'proportion')}`;
  }
  if (hypothesisDisplay) hypothesisDisplay.hidden = false;
  for (const btn of genBtns) btn.disabled = false;
  resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  if (mechanismStrip && mechObservedStat) {
    mechanismStrip.hidden = false;
    mechObservedStat.textContent = `${k} of ${n} (p̂ = ${formatStat(observedPHat, 0, 'proportion')})`;
  }
  announce(`Data loaded: n = ${n}, successes = ${k}`);

  // Scroll controls into view after DOM settles
  setTimeout(() => {
    const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ─── Null proportion & direction ───

function getNullProp() {
  const val = parseFloat(nullPropInput?.value);
  if (!isFinite(val) || val < 0 || val > 1) return 0.5;
  return val;
}

function getDirection() {
  const alt = altDirectionSelect?.value ?? 'greater';
  if (alt === 'greater') return /** @type {const} */ ('right');
  if (alt === 'less') return /** @type {const} */ ('left');
  return /** @type {const} */ ('both');
}

if (nullPropInput) {
  nullPropInput.addEventListener('change', () => {
    if (allStats.length > 0) {
      resetSimulation();
      resultDiv.innerHTML = '<p class="hint">Null proportion changed. Run simulation again.</p>';
      announce('Null proportion changed. Simulation reset.');
    }
  });
}

if (altDirectionSelect) {
  altDirectionSelect.addEventListener('change', () => {
    if (allStats.length > 0) {
      const direction = getDirection();
      renderChart(allStats, observedPHat, direction);
      const { pValue, extremeCount } = computePValue(allStats, observedPHat, direction);
      displayResults(allStats, observedPHat, pValue, extremeCount, direction);
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
  const p0 = getNullProp();
  const n = sampleN;
  const prevLength = allStats.length;

  if (simTitleEl) {
    simTitleEl.textContent = count === 1 ? 'This Simulation' : 'Last Simulation';
  }

  let lastSimSuccesses = 0;
  for (let i = 0; i < count; i++) {
    let successes = 0;
    for (let j = 0; j < n; j++) {
      if (rng() < p0) successes++;
    }
    lastSimSuccesses = successes;
    allStats.push(successes / n);
  }

  if (mechSimStat && mechanismDescEl) {
    const lastPHat = lastSimSuccesses / n;
    mechSimStat.textContent = `${lastSimSuccesses} of ${n} (p̂ = ${formatStat(lastPHat, 0, 'proportion')})`;
    mechanismDescEl.textContent = `Simulate ${n} trials, each with P(success) = ${p0}`;
    mechanismDescEl.hidden = false;
  }

  const direction = getDirection();
  // Compute domain from full dataset for consistent bin alignment
  const lo = Math.min(...allStats, observedPHat);
  const hi = Math.max(...allStats, observedPHat);
  const pad = (hi - lo) * 0.05 || 0.05;
  const hlDomain = /** @type {[number,number]} */ ([lo - pad, hi + pad]);
  const hlThresholds = snappedPropThresholds(n, hlDomain, allStats.length);
  // Pre-compute bins to lock in bin edges for both computeHighlights and drawHistogram
  const { bins: fullBins } = computeBins(allStats, { domain: hlDomain, thresholds: hlThresholds });
  const lockedThresholds = fullBins.slice(1).map(b => b.x0);

  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    allStats, prevLength, count, computeBins,
    { domain: hlDomain, thresholds: lockedThresholds });

  const { pValue, extremeCount } = computePValue(allStats, observedPHat, direction);
  displayResults(allStats, observedPHat, pValue, extremeCount, direction);
  if (resetBtn) resetBtn.hidden = false;

  if (count === 1) {
    setTimeout(() => {
      flashMechanism(mechanismStrip);
      setTimeout(() => {
        renderChart(allStats, observedPHat, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
      }, 120);
    }, 120);
  } else {
    renderChart(allStats, observedPHat, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
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
  const domain = [lo - pad, hi + pad];

  // Determine active chart type
  let activeChart = chartType;
  if (activeChart === 'auto') {
    activeChart = n <= 200 ? 'dotplot' : 'spike';
  }
  // Sync toggle
  if (toggleDiv) {
    for (const b of toggleDiv.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.dataset.chart === activeChart));
    }
  }

  /** @type {import('../../js/chart-utils.js').ChartFrame} */
  let frame;
  /** @type {any} */
  let xScale;

  if (activeChart === 'dotplot') {
    const r = drawDotplot(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Sample Proportion (p̂)',
      titleText: 'Null Distribution',
      isExtreme: (v) => isExtreme(v, observed, direction),
      observedStat: observed,
      animate: false,
      domain,
      numBins: sampleN <= 50 ? sampleN : undefined,
      highlightIndex,
      highlightIndices,
    });
    frame = r.frame;
    xScale = r.xScale;
  } else if (activeChart === 'spike') {
    const r = drawSpike(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Sample Proportion (p̂)',
      titleText: 'Null Distribution',
      isTail: (v) => isExtreme(v, observed, direction),
      observedStat: observed,
      domain,
    });
    frame = r.frame;
    xScale = r.xScale;
  } else {
    const propThresholds = hlThresholds || snappedPropThresholds(sampleN, domain, n);
    const histDomain = hlDomain || domain;
    const r = drawHistogram(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Sample Proportion (p̂)',
      titleText: 'Null Distribution',
      isTail: (v) => isExtreme(v, observed, direction),
      observedStat: observed,
      animate: false,
      domain: histDomain,
      thresholds: propThresholds,
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
 * Render p-value pills on the chart (replaces single annotation).
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
  if (dir === 'both') return Math.abs(v - getNullProp()) >= Math.abs(obs - getNullProp());
  return v >= obs;
}

/**
 * @param {number[]} stats
 * @param {number} observed
 * @param {'left'|'right'|'both'} direction
 */
function computePValue(stats, observed, direction) {
  let extremeCount = 0;
  const p0 = getNullProp();
  for (const s of stats) {
    if (direction === 'right' && s >= observed) extremeCount++;
    else if (direction === 'left' && s <= observed) extremeCount++;
    else if (direction === 'both' && Math.abs(s - p0) >= Math.abs(observed - p0)) extremeCount++;
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
  const fmtP = (v) => formatStat(v, 0, 'proportion');
  resultDiv.innerHTML = `
    <p><strong>Null Distribution</strong> (${stats.length} simulations, p₀ = ${getNullProp()})</p>
    <p>Observed p̂ = ${fmtP(observed)}</p>
    <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
    <p><strong>p-value:</strong> ${formatStat(pValue, 0, 'pvalue')}</p>
    <p class="interpretation">${extremeCount} of ${stats.length} simulated proportions were at least as extreme as the observed p̂ = ${fmtP(observed)}. This provides ${strength} evidence against H₀: p = ${getNullProp()}.</p>
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
