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
import { announce, initKeyboardShortcuts, initPlayPause, fetchDataset } from '../../js/page-utils.js';
import { renderStatLabel } from '../../js/chart-utils.js';

// ─── DOM ───

const popShapeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('pop-shape'));
const sampleSizeInput = /** @type {HTMLInputElement} */ (document.getElementById('sample-size'));
const ciLevelSelect = /** @type {HTMLSelectElement} */ (document.getElementById('ci-level'));
const ciContainer = document.getElementById('ci-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const popInfoEl = document.getElementById('pop-info');
const settingsSection = document.getElementById('settings');

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

// ─── URL params ───

const params = new URLSearchParams(location.search);
const urlDataset = params.get('dataset');
const urlMu = params.has('mu') ? parseFloat(params.get('mu')) : null;
const urlSigma = params.has('sigma') ? parseFloat(params.get('sigma')) : null;
const urlN = params.has('n') ? parseInt(params.get('n'), 10) : null;
const urlCi = params.has('ci') ? params.get('ci') : null;

// ─── Population ───

const POP_SIZE = 10000;
/** @type {string|null} */
let datasetName = null;

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
      // Standardize to exactly μ = 50, σ = 10 for clean display
      { const m = mean(vals), s = sd(vals);
        for (let i = 0; i < vals.length; i++) vals[i] = 50 + (vals[i] - m) / s * 10; }
      break;
    case 'right-skewed':
      for (let i = 0; i < POP_SIZE; i++) vals.push(-Math.log(1 - rng()) / 0.1);
      break;
    case 'uniform':
      for (let i = 0; i < POP_SIZE; i++) vals.push(rng() * 100);
      break;
    default:
      for (let i = 0; i < POP_SIZE; i++) vals.push(randNormal(50, 10, rng));
      { const m = mean(vals), s = sd(vals);
        for (let i = 0; i < vals.length; i++) vals[i] = 50 + (vals[i] - m) / s * 10; }
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

/**
 * Set population from a dataset's numeric column.
 * The actual data rows become the population — subsamples are drawn from them.
 * @param {string} datasetId
 */
async function loadDatasetPopulation(datasetId) {
  try {
    const ds = await fetchDataset(datasetId);
    // Find the first numeric variable
    const numVar = (ds.variables || []).find(v => v.type === 'numeric');
    if (!numVar) {
      console.warn('CI Coverage: no numeric variable in dataset', datasetId);
      initPopulation();
      return;
    }
    population = ds.rows.map(r => r[numVar.name]).filter(v => v != null && !isNaN(v));
    if (population.length < 2) {
      console.warn('CI Coverage: too few numeric values in dataset', datasetId);
      initPopulation();
      return;
    }
    popMu = mean(population);
    datasetName = ds.name || datasetId;

    const popSigma = sd(population);
    if (popInfoEl) {
      popInfoEl.textContent = `Population: ${datasetName} — ${numVar.label || numVar.name} (N = ${population.length}, μ = ${popMu.toFixed(2)}, σ = ${popSigma.toFixed(2)})`;
    }
    // Hide the shape selector since we're using a dataset
    if (popShapeSelect && popShapeSelect.closest('.coverage-controls')) {
      const shapeLabel = popShapeSelect.closest('label');
      if (shapeLabel) shapeLabel.style.display = 'none';
    }
    resetSimulation();
  } catch (err) {
    console.warn('CI Coverage: failed to load dataset', datasetId, err);
    initPopulation();
  }
}

function initPopulation() {
  const shape = popShapeSelect.value;
  const popRng = createRng('cov-' + shape);

  // Use custom mu/sigma if provided via URL
  if (urlMu != null && !isNaN(urlMu) && urlSigma != null && !isNaN(urlSigma)) {
    population = [];
    for (let i = 0; i < POP_SIZE; i++) population.push(randNormal(urlMu, urlSigma, popRng));
    // Lock shape selector to normal since we used custom params
    popShapeSelect.value = 'normal';
  } else {
    population = generatePopulation(shape, popRng);
  }
  popMu = mean(population);

  const popSigma = sd(population);
  if (popInfoEl) {
    const names = { normal: 'Normal', 'right-skewed': 'Right-skewed', uniform: 'Uniform' };
    // Use clean integers when values are close to whole numbers
    const fmtNum = (v) => Math.abs(v - Math.round(v)) < 0.005 ? Math.round(v).toString() : v.toFixed(2);
    popInfoEl.textContent = `Population: ${names[shape] || shape} (μ = ${fmtNum(popMu)}, σ = ${fmtNum(popSigma)})`;
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

  renderChart();
  displayInterpretation();

  if (resetBtn) resetBtn.hidden = false;
  announce(`Drew ${count} CI${count > 1 ? 's' : ''}. Total: ${intervals.length}`);
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

  const isMobile = window.innerWidth < 600;
  const margin = { top: 38, right: 30, bottom: 44, left: 50 };
  const width = 560;
  const barHeight = Math.min(isMobile ? 8 : 5, (isMobile ? 600 : 400) / shown.length);
  const height = Math.max(isMobile ? 420 : 200, shown.length * (barHeight + 1) + margin.top + margin.bottom);
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
    .attr('aria-label', `${shown.length} confidence intervals. ${shown.filter(c => c.captures).length} capture the true mean.`)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Font sizes: scale up on mobile since viewBox (560px) shrinks to ~412px
  const titleSize = isMobile ? '17px' : '14px';
  const labelSize = isMobile ? '15px' : '13px';
  const statsSize = isMobile ? '14px' : '13px';

  // Title
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', 14)
    .attr('text-anchor', 'middle')
    .attr('font-weight', 700)
    .attr('font-size', titleSize)
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
    .attr('y', -4)
    .attr('text-anchor', 'middle')
    .attr('font-size', labelSize)
    .attr('fill', '#7B2D8E')
    .attr('font-weight', 700)
    .text(`μ = ${Math.abs(popMu - Math.round(popMu)) < 0.005 ? Math.round(popMu) : popMu.toFixed(2)}`);

  // Tooltip group (hidden by default, rendered on top of everything)
  const tooltipG = svg.append('g')
    .attr('class', 'ci-tooltip')
    .attr('visibility', 'hidden')
    .attr('pointer-events', 'none');

  const tooltipFontSize = isMobile ? '16px' : '13px';

  const tooltipRect = tooltipG.append('rect')
    .attr('rx', 4).attr('ry', 4)
    .attr('fill', 'white').attr('fill-opacity', 0.95)
    .attr('stroke', '#999').attr('stroke-width', 1);

  const tooltipLine1 = tooltipG.append('text')
    .attr('font-size', tooltipFontSize);
  const tooltipLine2 = tooltipG.append('text')
    .attr('font-size', tooltipFontSize).attr('font-weight', 600);

  /**
   * @param {typeof shown[0]} ci
   * @param {number} idx — index within shown array
   * @param {number} cy — y position of the CI line
   */
  function showTooltip(ci, idx, cy) {
    const captureText = ci.captures ? 'Captures μ' : 'Misses μ';
    const captureColor = ci.captures ? '#569BBD' : '#F05133';

    tooltipLine1.text('');  // clear previous tspans
    renderStatLabel(tooltipLine1, `(${ci.lo.toFixed(2)}, ${ci.hi.toFixed(2)})  x\u0304 = ${ci.xbar.toFixed(2)}`);
    tooltipLine2.text(captureText).attr('fill', captureColor).attr('font-weight', 600);

    const pad = isMobile ? 8 : 6;
    const lineSpacing = isMobile ? 20 : 16;

    tooltipLine1.attr('x', pad).attr('y', lineSpacing);
    tooltipLine2.attr('x', pad).attr('y', lineSpacing * 2 + 1);

    // Must be visible to measure text; park offscreen to avoid flicker
    tooltipRect.attr('width', 0).attr('height', 0);
    tooltipG.attr('visibility', 'visible').attr('transform', 'translate(-9999,-9999)');

    const textW = /** @type {SVGTextElement} */ (tooltipLine1.node()).getComputedTextLength();
    const boxW = textW + pad * 2;
    const boxH = lineSpacing * 2 + pad + 2;
    tooltipRect.attr('width', boxW).attr('height', boxH);

    let tx = margin.left + xScale((ci.lo + ci.hi) / 2) - boxW / 2;
    tx = Math.max(4, Math.min(width - boxW - 4, tx));
    let ty = margin.top + cy - boxH - 4;
    if (ty < 4) ty = margin.top + cy + 6;

    tooltipG.attr('transform', `translate(${tx}, ${ty})`);
  }

  let pinnedIndex = -1;  // track which CI is tapped/pinned on mobile

  function hideTooltip() {
    tooltipG.attr('visibility', 'hidden');
    pinnedIndex = -1;
  }

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

    // Invisible wider hit target for hover/touch
    g.append('rect')
      .attr('x', xScale(ci.lo) - 4)
      .attr('y', y - Math.max(isMobile ? 10 : 4, yStep / 2))
      .attr('width', Math.max(8, xScale(ci.hi) - xScale(ci.lo) + 8))
      .attr('height', Math.max(isMobile ? 20 : 8, yStep))
      .attr('fill', 'transparent')
      .attr('cursor', 'pointer')
      .on('mouseenter', () => showTooltip(ci, i, y))
      .on('mouseleave', () => { if (pinnedIndex === -1) hideTooltip(); })
      .on('touchstart', (e) => {
        e.preventDefault();
        if (pinnedIndex === i) {
          hideTooltip();  // tap same CI again → dismiss
        } else {
          showTooltip(ci, i, y);
          pinnedIndex = i;  // pin until next tap
        }
      });
  }

  // Tap on empty chart area dismisses pinned tooltip
  svg.on('touchstart', (e) => {
    if (pinnedIndex !== -1 && e.target === svg.node()) {
      hideTooltip();
    }
  });

  // X axis
  const xAxis = d3Axis.axisBottom(xScale).ticks(8);
  g.append('g')
    .attr('transform', `translate(0, ${innerH})`)
    .call(xAxis);

  g.append('text')
    .attr('x', innerW / 2)
    .attr('y', innerH + 32)
    .attr('text-anchor', 'middle')
    .attr('font-size', labelSize)
    .text('Value');

  // Coverage stats overlay (top-right corner, always visible)
  const captured = shown.filter(c => c.captures).length;
  const missed = shown.length - captured;
  const rate = (intervals.filter(c => c.captures).length / total * 100).toFixed(1);
  const statsG = svg.append('g')
    .attr('transform', `translate(${width - margin.right - 4}, ${margin.top + 4})`);

  // Background rect for readability
  const statsLines = [
    `${total} CIs drawn`,
    `${intervals.filter(c => c.captures).length} captured μ,  ${total - intervals.filter(c => c.captures).length} missed`,
    `Coverage: ${rate}%`,
  ];
  const lineH = 17;
  const boxH = statsLines.length * lineH + 10;
  const boxW = 170;
  statsG.append('rect')
    .attr('x', -boxW)
    .attr('y', 0)
    .attr('width', boxW)
    .attr('height', boxH)
    .attr('rx', 4)
    .attr('fill', 'white')
    .attr('fill-opacity', 0.9)
    .attr('stroke', '#ccc')
    .attr('stroke-width', 0.5);

  statsLines.forEach((line, i) => {
    statsG.append('text')
      .attr('x', -boxW + 6)
      .attr('y', lineH * (i + 1))
      .attr('font-size', statsSize)
      .attr('fill', i === 2 ? '#114B5F' : '#333')
      .attr('font-weight', i === 2 ? 700 : 400)
      .text(line);
  });

  // Raise tooltip to front so it renders above the stats overlay
  svg.node().appendChild(tooltipG.node());
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

popShapeSelect.addEventListener('change', () => {
  datasetName = null; // switching shape clears any loaded dataset
  initPopulation();
});

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
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Click a button to draw samples and build confidence intervals.</p>';
  if (resetBtn) resetBtn.hidden = true;
}

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── Init ───

// Apply URL params to inputs before initializing
if (urlN != null && !isNaN(urlN) && urlN >= 2 && urlN <= 500) {
  sampleSizeInput.value = String(urlN);
}
if (urlCi && ['90', '95', '99'].includes(urlCi)) {
  ciLevelSelect.value = urlCi;
}

if (urlDataset) {
  loadDatasetPopulation(urlDataset);
} else {
  initPopulation();
}
