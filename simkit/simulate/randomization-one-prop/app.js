// @ts-check
/**
 * One-proportion randomization test page.
 * Simulates from Bernoulli(p₀) under the null to build a null distribution of p̂.
 */

import { createRng } from '../../js/prng.js';
import { mean } from '../../js/stats.js';
import { drawHistogram, computeBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { announce, initKeyboardShortcuts, initPlayPause, flashMechanism, computeHighlights } from '../../js/page-utils.js';

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

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

// Mechanism strip elements
const mechanismStrip = document.getElementById('mechanism-strip');
const mechObservedStat = document.getElementById('mech-observed-stat');
const mechSimStat = document.getElementById('mech-sim-stat');
const mechanismDescEl = document.getElementById('mechanism-description');
const simTitleEl = document.getElementById('sim-title');

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

/** @type {number[]} */
let allStats = [];
/** @type {(() => number)|null} */
let rng = null;
let seed = Math.random().toString(36).slice(2, 10);

let sampleN = 0;
let sampleSuccesses = 0;
let observedPHat = 0;

// ─── Load data ───

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
    dataSummary.textContent = `n = ${n}, successes = ${k}, p̂ = ${observedPHat.toFixed(4)}`;
  }
  if (hypothesisDisplay) hypothesisDisplay.hidden = false;
  for (const btn of genBtns) btn.disabled = false;
  resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  if (mechanismStrip && mechObservedStat) {
    mechanismStrip.hidden = false;
    mechObservedStat.textContent = `${k} of ${n} (p̂ = ${observedPHat.toFixed(4)})`;
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
    mechSimStat.textContent = `${lastSimSuccesses} of ${n} (p̂ = ${lastPHat.toFixed(4)})`;
    mechanismDescEl.textContent = `Simulate ${n} trials, each with P(success) = ${p0}`;
    mechanismDescEl.hidden = false;
  }

  const direction = getDirection();
  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(allStats, prevLength, count, computeBins);

  const { pValue, extremeCount } = computePValue(allStats, observedPHat, direction);
  displayResults(allStats, observedPHat, pValue, extremeCount, direction);
  if (resetBtn) resetBtn.hidden = false;

  if (count === 1) {
    setTimeout(() => {
      flashMechanism(mechanismStrip);
      setTimeout(() => {
        renderChart(allStats, observedPHat, direction, hlIndex, hlIndices, prevBinCounts);
      }, 120);
    }, 120);
  } else {
    renderChart(allStats, observedPHat, direction, hlIndex, hlIndices, prevBinCounts);
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
 */
function renderChart(stats, observed, direction, highlightIndex = -1, highlightIndices, prevBinCounts) {
  chartContainer.innerHTML = '';
  const n = stats.length;

  const lo = Math.min(...stats, observed);
  const hi = Math.max(...stats, observed);
  const pad = (hi - lo) * 0.05 || 0.05;
  /** @type {[number, number]} */
  const domain = [lo - pad, hi + pad];

  if (n <= 200) {
    drawDotplot(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Sample Proportion (p̂)',
      titleText: 'Null Distribution',
      isExtreme: (v) => isExtreme(v, observed, direction),
      observedStat: observed,
      animate: false,
      domain,
      highlightIndex,
      highlightIndices,
    });
  } else {
    drawHistogram(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Sample Proportion (p̂)',
      titleText: 'Null Distribution',
      isTail: (v) => isExtreme(v, observed, direction),
      observedStat: observed,
      animate: false,
      domain,
      prevBinCounts,
    });
  }
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
  resultDiv.innerHTML = `
    <p><strong>Null Distribution</strong> (${stats.length} simulations, p₀ = ${getNullProp()})</p>
    <p>Observed p̂ = ${observed.toFixed(4)}</p>
    <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
    <p><strong>p-value:</strong> ${pValue.toFixed(4)}</p>
    <p class="interpretation">${extremeCount} of ${stats.length} simulated proportions were at least as extreme as the observed p̂ = ${observed.toFixed(4)}. This provides ${strength} evidence against H₀: p = ${getNullProp()}.</p>
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
