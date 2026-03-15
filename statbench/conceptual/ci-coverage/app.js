// @ts-check
/**
 * CI Coverage Simulator.
 * Draw many samples from a known population, build a t-interval for each,
 * see how many capture the true μ.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { mean, sd } from '../../js/stats.js';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import * as d3Array from 'd3-array';
import { announce, initKeyboardShortcuts, initPlayPause } from '../../js/page-utils.js';

// ─── DOM ───

const popShapeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('pop-shape'));
const sampleSizeInput = /** @type {HTMLInputElement} */ (document.getElementById('sample-size'));
const ciLevelSelect = /** @type {HTMLSelectElement} */ (document.getElementById('ci-level'));
const ciContainer = document.getElementById('ci-container');
const coverageStats = document.getElementById('coverage-stats');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const popInfoEl = document.getElementById('pop-info');

const nCisEl = document.getElementById('n-cis');
const nCapturedEl = document.getElementById('n-captured');
const nMissedEl = document.getElementById('n-missed');
const coverageRateEl = document.getElementById('coverage-rate');

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

// ─── Population ───

const POP_SIZE = 10000;

/**
 * @param {string} shape
 * @param {() => number} rng
 * @returns {number[]}
 */
function generatePopulation(shape, rng) {
  const vals = [];
  switch (shape) {
    case 'normal':
      for (let i = 0; i < POP_SIZE; i++) vals.push(randNormal(50, 10, rng));
      break;
    case 'right-skewed':
      for (let i = 0; i < POP_SIZE; i++) vals.push(-Math.log(1 - rng()) / 0.1);
      break;
    case 'uniform':
      for (let i = 0; i < POP_SIZE; i++) vals.push(rng() * 100);
      break;
    default:
      for (let i = 0; i < POP_SIZE; i++) vals.push(randNormal(50, 10, rng));
  }
  return vals;
}

// ─── t critical values (common ones, avoids jStat dependency) ───

/** @type {Record<string, Record<number, number>>} */
const T_CRIT = {};

/**
 * Approximate t critical value using normal for large df.
 * For small df, use a lookup or Cornish-Fisher expansion.
 * @param {number} df
 * @param {number} alpha - two-tailed alpha (e.g., 0.05 for 95% CI)
 * @returns {number}
 */
function tCritical(df, alpha) {
  // For df >= 120, use z approximation
  const zLookup = { 0.10: 1.645, 0.05: 1.960, 0.01: 2.576 };
  if (df >= 120) return zLookup[alpha] || 1.960;

  // Cornish-Fisher approximation for moderate df
  const z = zLookup[alpha] || 1.960;
  const g1 = (z * z * z + z) / 4;
  const g2 = (5 * z * z * z * z * z + 16 * z * z * z + 3 * z) / 96;
  const g3 = (3 * z * z * z * z * z * z * z + 19 * z * z * z * z * z + 17 * z * z * z - 15 * z) / 384;
  return z + g1 / df + g2 / (df * df) + g3 / (df * df * df);
}

// ─── State ───

/** @type {number[]} */
let population = [];
let popMu = 0;

/** @type {Array<{lo: number, hi: number, xbar: number, captures: boolean}>} */
let intervals = [];

/** @type {(() => number)|null} */
let rng = null;
let seed = Math.random().toString(36).slice(2, 10);

// ─── Initialize ───

function initPopulation() {
  const shape = popShapeSelect.value;
  const popRng = createRng('cov-' + shape);
  population = generatePopulation(shape, popRng);
  popMu = mean(population);

  const popSigma = sd(population);
  if (popInfoEl) {
    const names = { normal: 'Normal', 'right-skewed': 'Right-skewed', uniform: 'Uniform' };
    popInfoEl.textContent = `Population: ${names[shape] || shape} (μ = ${popMu.toFixed(2)}, σ = ${popSigma.toFixed(2)})`;
  }

  resetSimulation();
}

// ─── Sampling ───

/**
 * @param {number} count
 */
function drawCIs(count) {
  if (!rng) rng = createRng(seed);
  const n = parseInt(sampleSizeInput.value, 10) || 25;
  const ciLevel = parseInt(ciLevelSelect.value, 10);
  const alpha = (100 - ciLevel) / 100;
  const df = n - 1;
  const tStar = tCritical(df, alpha);

  for (let i = 0; i < count; i++) {
    // Draw sample from population
    const sample = [];
    for (let j = 0; j < n; j++) {
      sample.push(population[Math.floor(rng() * population.length)]);
    }
    const xbar = mean(sample);
    const se = sd(sample) / Math.sqrt(n);
    const lo = xbar - tStar * se;
    const hi = xbar + tStar * se;
    const captures = lo <= popMu && popMu <= hi;
    intervals.push({ lo, hi, xbar, captures });
  }

  updateStats();
  renderChart();
  displayInterpretation();

  if (resetBtn) resetBtn.hidden = false;
  announce(`Drew ${count} CI${count > 1 ? 's' : ''}. Total: ${intervals.length}`);
}

function updateStats() {
  const total = intervals.length;
  const captured = intervals.filter(ci => ci.captures).length;
  const missed = total - captured;

  if (coverageStats) coverageStats.hidden = false;
  if (nCisEl) nCisEl.textContent = String(total);
  if (nCapturedEl) nCapturedEl.textContent = String(captured);
  if (nMissedEl) nMissedEl.textContent = String(missed);
  if (coverageRateEl) coverageRateEl.textContent = total > 0 ? `${(captured / total * 100).toFixed(1)}%` : '\u2014';
}

// ─── Chart: horizontal CI segments ───

function renderChart() {
  if (!ciContainer) return;
  ciContainer.innerHTML = '';

  const total = intervals.length;
  if (total === 0) return;

  // Show last 100 CIs (most recent)
  const maxShow = 100;
  const shown = intervals.slice(-maxShow);
  const startIdx = Math.max(0, total - maxShow);

  const margin = { top: 20, right: 30, bottom: 40, left: 50 };
  const width = 560;
  const barHeight = Math.min(5, 400 / shown.length);
  const height = Math.max(200, shown.length * (barHeight + 1) + margin.top + margin.bottom);
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  // X scale: range of all CI endpoints
  const allLo = d3Array.min(shown, d => d.lo) ?? 0;
  const allHi = d3Array.max(shown, d => d.hi) ?? 100;
  const pad = (allHi - allLo) * 0.05;
  const xScale = d3Scale.scaleLinear()
    .domain([Math.min(allLo - pad, popMu - pad), Math.max(allHi + pad, popMu + pad)])
    .range([0, innerW]);

  const svg = d3Selection.select(ciContainer).append('svg')
    .attr('role', 'img')
    .attr('aria-label', `${shown.length} confidence intervals. ${shown.filter(c => c.captures).length} capture the true mean.`)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Title
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 14)
    .attr('text-anchor', 'middle')
    .attr('font-weight', 700)
    .attr('font-size', '12px')
    .text(`Confidence Intervals (showing last ${shown.length} of ${total})`);

  const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);

  // True μ vertical line
  g.append('line')
    .attr('x1', xScale(popMu))
    .attr('x2', xScale(popMu))
    .attr('y1', 0)
    .attr('y2', innerH)
    .attr('stroke', '#7B2D8E')
    .attr('stroke-width', 2)
    .attr('stroke-dasharray', '4,3');

  // μ label
  g.append('text')
    .attr('x', xScale(popMu))
    .attr('y', -5)
    .attr('text-anchor', 'middle')
    .attr('font-size', '10px')
    .attr('fill', '#7B2D8E')
    .attr('font-weight', 700)
    .text(`μ = ${popMu.toFixed(2)}`);

  // CI segments
  const yStep = innerH / shown.length;
  for (let i = 0; i < shown.length; i++) {
    const ci = shown[i];
    const y = i * yStep + yStep / 2;
    const color = ci.captures ? '#569BBD' : '#F05133';

    // Line
    g.append('line')
      .attr('x1', xScale(ci.lo))
      .attr('x2', xScale(ci.hi))
      .attr('y1', y)
      .attr('y2', y)
      .attr('stroke', color)
      .attr('stroke-width', Math.max(1.5, barHeight * 0.7))
      .attr('stroke-linecap', 'round');

    // Center dot (x̄)
    g.append('circle')
      .attr('cx', xScale(ci.xbar))
      .attr('cy', y)
      .attr('r', Math.max(1.2, barHeight * 0.4))
      .attr('fill', color);
  }

  // X axis
  const xAxis = d3Axis.axisBottom(xScale).ticks(8);
  g.append('g')
    .attr('transform', `translate(0, ${innerH})`)
    .call(xAxis);

  g.append('text')
    .attr('x', innerW / 2)
    .attr('y', innerH + 32)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .text('Value');
}

// ─── Interpretation ───

function displayInterpretation() {
  if (!resultDiv) return;
  const total = intervals.length;
  const ciLevel = parseInt(ciLevelSelect.value, 10);
  const captured = intervals.filter(ci => ci.captures).length;
  const rate = (captured / total * 100).toFixed(1);

  let html = `<p><strong>${total} Confidence Intervals</strong> (${ciLevel}% level)</p>`;
  html += `<p><span style="color:#569BBD;font-weight:700">${captured}</span> captured μ, <span style="color:#F05133;font-weight:700">${total - captured}</span> missed. Coverage rate: ${rate}%</p>`;

  if (total >= 50) {
    html += `<p class="interpretation">"${ciLevel}% confidence" means that if we repeated this process many times, about ${ciLevel}% of the intervals would capture the true parameter. It does NOT mean there's a ${ciLevel}% chance the parameter is in any single interval — the parameter is fixed; the intervals are random.</p>`;
  } else {
    html += `<p class="hint">Draw more CIs (at least 50) to see the coverage rate stabilize near ${ciLevel}%.</p>`;
  }

  resultDiv.innerHTML = html;
}

// ─── Event listeners ───

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.count, 10);
    drawCIs(count);
  });
}

popShapeSelect.addEventListener('change', () => initPopulation());

sampleSizeInput.addEventListener('change', () => {
  const val = parseInt(sampleSizeInput.value, 10);
  if (val < 2) sampleSizeInput.value = '2';
  if (val > 500) sampleSizeInput.value = '500';
  resetSimulation();
});

ciLevelSelect.addEventListener('change', () => resetSimulation());

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    resetSimulation();
    announce('Simulation reset.');
  });
}

function resetSimulation() {
  intervals = [];
  rng = null;
  seed = Math.random().toString(36).slice(2, 10);
  if (ciContainer) ciContainer.innerHTML = '';
  if (coverageStats) coverageStats.hidden = true;
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Click a button to draw samples and build confidence intervals.</p>';
  if (resetBtn) resetBtn.hidden = true;
}

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── Init ───

initPopulation();
