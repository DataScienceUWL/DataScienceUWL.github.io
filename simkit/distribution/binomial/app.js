// @ts-check
/**
 * Binomial Distribution Calculator.
 * PMF bar chart with shading, cumulative probabilities,
 * optional normal approximation overlay.
 */

import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import * as d3Shape from 'd3-shape';
import { createChart, formatTick } from '../../js/chart-utils.js';

// ─── DOM ───

const paramN = /** @type {HTMLInputElement} */ (document.getElementById('param-n'));
const paramP = /** @type {HTMLInputElement} */ (document.getElementById('param-p'));
const paramK = /** @type {HTMLInputElement} */ (document.getElementById('param-k'));
const probType = /** @type {HTMLSelectElement} */ (document.getElementById('prob-type'));
const showNormal = /** @type {HTMLInputElement} */ (document.getElementById('show-normal'));
const chartContainer = document.getElementById('chart-container');
const tableContainer = document.getElementById('table-container');
const resultBanner = document.getElementById('result-banner');
const statMean = document.getElementById('stat-mean');
const statSd = document.getElementById('stat-sd');
const announceDiv = document.getElementById('sr-announce');

// ─── Binomial math ───

/**
 * Log of n choose k (avoids overflow for large n).
 * @param {number} n
 * @param {number} k
 * @returns {number}
 */
function logChoose(n, k) {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  if (k > n - k) k = n - k;
  let result = 0;
  for (let i = 0; i < k; i++) {
    result += Math.log(n - i) - Math.log(i + 1);
  }
  return result;
}

/**
 * Binomial PMF: P(X = k)
 * @param {number} k
 * @param {number} n
 * @param {number} p
 * @returns {number}
 */
function binomPMF(k, n, p) {
  if (k < 0 || k > n) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(logChoose(n, k) + k * Math.log(p) + (n - k) * Math.log(1 - p));
}

/**
 * Normal PDF for overlay.
 * @param {number} x
 * @param {number} mu
 * @param {number} sigma
 * @returns {number}
 */
function normalPDF(x, mu, sigma) {
  if (sigma <= 0) return 0;
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

// ─── Compute ───

function update() {
  const n = Math.max(1, Math.min(500, parseInt(paramN.value, 10) || 20));
  const p = Math.max(0, Math.min(1, parseFloat(paramP.value) || 0.5));
  const k = Math.max(0, Math.min(n, parseInt(paramK.value, 10) || 0));
  const type = probType.value;

  // Clamp k to valid range
  paramK.max = String(n);
  if (parseInt(paramK.value, 10) > n) paramK.value = String(n);

  const mu = n * p;
  const sigma = Math.sqrt(n * p * (1 - p));

  if (statMean) statMean.textContent = mu.toFixed(4);
  if (statSd) statSd.textContent = sigma.toFixed(4);

  // Compute all PMF values
  /** @type {Array<{k: number, pmf: number, cdf: number}>} */
  const data = [];
  let cumulative = 0;
  for (let i = 0; i <= n; i++) {
    const pmf = binomPMF(i, n, p);
    cumulative += pmf;
    data.push({ k: i, pmf, cdf: Math.min(cumulative, 1) });
  }

  // Compute the requested probability
  let prob = 0;
  /** @type {Set<number>} */
  const shadedKs = new Set();

  switch (type) {
    case 'exact':
      prob = binomPMF(k, n, p);
      shadedKs.add(k);
      break;
    case 'leq':
      for (let i = 0; i <= k; i++) { prob += data[i].pmf; shadedKs.add(i); }
      break;
    case 'geq':
      for (let i = k; i <= n; i++) { prob += data[i].pmf; shadedKs.add(i); }
      break;
    case 'lt':
      for (let i = 0; i < k; i++) { prob += data[i].pmf; shadedKs.add(i); }
      break;
    case 'gt':
      for (let i = k + 1; i <= n; i++) { prob += data[i].pmf; shadedKs.add(i); }
      break;
  }

  // Display result
  const typeLabels = {
    exact: `P(X = ${k})`,
    leq: `P(X ≤ ${k})`,
    geq: `P(X ≥ ${k})`,
    lt: `P(X < ${k})`,
    gt: `P(X > ${k})`,
  };
  if (resultBanner) {
    resultBanner.innerHTML = `<span>${typeLabels[type]}</span> = <span class="prob-value">${prob.toFixed(6)}</span>`;
  }

  renderChart(data, n, p, k, shadedKs, mu, sigma);
  renderTable(data, shadedKs);
  announce(`${typeLabels[type]} = ${prob.toFixed(6)}`);
}

// ─── Chart ───

/**
 * @param {Array<{k: number, pmf: number, cdf: number}>} data
 * @param {number} n
 * @param {number} p
 * @param {number} k
 * @param {Set<number>} shadedKs
 * @param {number} mu
 * @param {number} sigma
 */
function renderChart(data, n, p, k, shadedKs, mu, sigma) {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';

  // For large n, only show the relevant range
  let lo = 0;
  let hi = n;
  if (n > 60) {
    lo = Math.max(0, Math.floor(mu - 4 * sigma));
    hi = Math.min(n, Math.ceil(mu + 4 * sigma));
  }
  const visible = data.slice(lo, hi + 1);

  const margin = { top: 25, right: 20, bottom: 45, left: 55 };
  const width = 560;
  const height = 300;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;

  const svg = d3Selection.select(chartContainer).append('svg')
    .attr('role', 'img')
    .attr('aria-label', `Binomial distribution PMF, n=${n}, p=${p}`)
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
    .text(`Binomial(n = ${n}, p = ${p})`);

  const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);

  const kValues = visible.map(d => d.k);
  const maxPMF = Math.max(...visible.map(d => d.pmf), 0.001);

  const xScale = d3Scale.scaleBand()
    .domain(kValues.map(String))
    .range([0, innerW])
    .paddingInner(n > 40 ? 0.05 : 0.15)
    .paddingOuter(0.05);

  const yScale = d3Scale.scaleLinear()
    .domain([0, maxPMF])
    .nice()
    .range([innerH, 0]);

  // Axes
  const xAxis = d3Axis.axisBottom(xScale);
  // For large n, show fewer tick labels
  if (kValues.length > 30) {
    const step = Math.ceil(kValues.length / 15);
    xAxis.tickValues(kValues.filter((_, i) => i % step === 0).map(String));
  }
  g.append('g').attr('transform', `translate(0, ${innerH})`).call(xAxis);
  g.append('g').call(d3Axis.axisLeft(yScale).tickFormat(formatTick));

  // X label
  g.append('text')
    .attr('x', innerW / 2)
    .attr('y', innerH + 35)
    .attr('text-anchor', 'middle')
    .attr('font-size', '11px')
    .text('k (number of successes)');

  // Y label
  g.append('text')
    .attr('text-anchor', 'middle')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -40)
    .attr('font-size', '11px')
    .text('P(X = k)');

  // Bars
  for (const d of visible) {
    const isShaded = shadedKs.has(d.k);
    g.append('rect')
      .attr('x', xScale(String(d.k)))
      .attr('y', yScale(d.pmf))
      .attr('width', xScale.bandwidth())
      .attr('height', innerH - yScale(d.pmf))
      .attr('fill', isShaded ? '#569BBD' : '#c0d6e4')
      .attr('stroke', '#fff')
      .attr('stroke-width', 0.5);
  }

  // Normal approximation overlay
  if (showNormal.checked && sigma > 0) {
    const nPts = 200;
    const xMin = lo - 0.5;
    const xMax = hi + 0.5;
    const step = (xMax - xMin) / nPts;
    /** @type {Array<{x: number, y: number}>} */
    const curve = [];

    // Linear x scale for normal curve
    const xLinear = d3Scale.scaleLinear()
      .domain([lo - 0.5, hi + 0.5])
      .range([0, innerW]);

    for (let i = 0; i <= nPts; i++) {
      const x = xMin + i * step;
      curve.push({ x, y: normalPDF(x, mu, sigma) });
    }

    const line = d3Shape.line()
      .x(d => xLinear(d.x))
      .y(d => yScale(d.y));

    g.append('path')
      .datum(curve)
      .attr('d', line)
      .attr('fill', 'none')
      .attr('stroke', '#F05133')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '5,3')
      .attr('opacity', 0.8);
  }

  // Mean line
  const xLinear = d3Scale.scaleLinear()
    .domain([lo - 0.5, hi + 0.5])
    .range([0, innerW]);

  g.append('line')
    .attr('x1', xLinear(mu))
    .attr('x2', xLinear(mu))
    .attr('y1', 0)
    .attr('y2', innerH)
    .attr('stroke', '#114B5F')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '4,3');
}

// ─── Probability table ───

/**
 * @param {Array<{k: number, pmf: number, cdf: number}>} data
 * @param {Set<number>} shadedKs
 */
function renderTable(data, shadedKs) {
  if (!tableContainer) return;

  let html = '<table class="prob-table" aria-label="Binomial probabilities">';
  html += '<thead><tr><th>k</th><th>P(X = k)</th><th>P(X ≤ k)</th></tr></thead><tbody>';

  for (const d of data) {
    const cls = shadedKs.has(d.k) ? ' class="highlighted"' : '';
    html += `<tr${cls}><td>${d.k}</td><td>${d.pmf.toFixed(6)}</td><td>${d.cdf.toFixed(6)}</td></tr>`;
  }

  html += '</tbody></table>';
  tableContainer.innerHTML = html;
}

// ─── Event listeners ───

paramN.addEventListener('input', update);
paramP.addEventListener('input', update);
paramK.addEventListener('input', update);
probType.addEventListener('change', update);
showNormal.addEventListener('change', update);

/** @param {string} msg */
function announce(msg) {
  if (announceDiv) announceDiv.textContent = msg;
}

// ─── Init ───

update();
