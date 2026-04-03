// @ts-check
/**
 * Binomial Distribution Calculator.
 * PMF bar chart with shading, cumulative probabilities,
 * optional normal approximation overlay, and draggable k boundary.
 */

import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import * as d3Shape from 'd3-shape';
import { formatTick, pillDimensions } from '../../js/chart-utils.js';
import { initHelp, setPageTitle } from '../../js/page-utils.js';

initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ─── DOM ───

const paramN = /** @type {HTMLInputElement} */ (document.getElementById('param-n'));
const paramP = /** @type {HTMLInputElement} */ (document.getElementById('param-p'));
const paramK = /** @type {HTMLInputElement} */ (document.getElementById('param-k'));
const probType = /** @type {HTMLSelectElement} */ (document.getElementById('prob-type'));
const showMean = /** @type {HTMLInputElement} */ (document.getElementById('show-mean'));
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

// ─── Chart state (preserved across updates for drag interaction) ───

/** @type {d3Selection.Selection|null} */
let chartG = null;
/** @type {d3Scale.ScaleLinear<number,number>|null} */
let xLinear = null;
/** @type {d3Scale.ScaleBand<string>|null} */
let xBand = null;
/** @type {number} */
let chartInnerH = 0;
/** @type {number} */
let visibleLo = 0;
/** @type {number} */
let visibleHi = 0;

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

  // Compute the requested probability and shaded set
  const { prob, shadedKs } = computeShading(data, k, n, type);

  // Display result
  displayResult(k, type, prob);
  renderChart(data, n, p, k, shadedKs, mu, sigma, prob, type);
  renderTable(data, shadedKs);
  setPageTitle(baseTitle, undefined, { extra: `n=${n}, p=${p}` });
  announce(`${typeLabel(k, type)} = ${prob.toFixed(6)}`);
}

/**
 * Compute shading and probability for given k and type.
 * @param {Array<{k: number, pmf: number}>} data
 * @param {number} k
 * @param {number} n
 * @param {string} type
 */
function computeShading(data, k, n, type) {
  let prob = 0;
  /** @type {Set<number>} */
  const shadedKs = new Set();

  switch (type) {
    case 'exact':
      prob = binomPMF(k, n, data.length > 0 ? 0 : 0); // handled below
      prob = data[k]?.pmf ?? 0;
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
  return { prob, shadedKs };
}

/**
 * @param {number} k
 * @param {string} type
 * @returns {string}
 */
function typeLabel(k, type) {
  const labels = {
    exact: `P(X = ${k})`,
    leq: `P(X ≤ ${k})`,
    geq: `P(X ≥ ${k})`,
    lt: `P(X < ${k})`,
    gt: `P(X > ${k})`,
  };
  return labels[type] || '';
}

/**
 * @param {number} k
 * @param {string} type
 * @param {number} prob
 */
function displayResult(k, type, prob) {
  if (resultBanner) {
    resultBanner.innerHTML = `<span>${typeLabel(k, type)}</span> = <span class="prob-value">${prob.toFixed(6)}</span>`;
  }
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
 * @param {number} prob
 * @param {string} type
 */
function renderChart(data, n, p, k, shadedKs, mu, sigma, prob, type) {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';

  // For large n, only show the relevant range
  let lo = 0;
  let hi = n;
  if (n > 60) {
    lo = Math.max(0, Math.floor(mu - 4 * sigma));
    hi = Math.min(n, Math.ceil(mu + 4 * sigma));
  }
  visibleLo = lo;
  visibleHi = hi;
  const visible = data.slice(lo, hi + 1);

  const _mob = typeof globalThis.matchMedia === 'function'
    && globalThis.matchMedia('(max-width: 480px)').matches;
  const margin = { top: _mob ? 30 : 25, right: 20, bottom: _mob ? 65 : 55, left: 60 };
  const width = 560;
  const height = _mob ? 320 : 300;
  const innerW = width - margin.left - margin.right;
  const innerH = height - margin.top - margin.bottom;
  chartInnerH = innerH;

  const svg = d3Selection.select(chartContainer).append('svg')
    .attr('role', 'img')
    .attr('aria-label', `Binomial distribution PMF, n=${n}, p=${p}`)
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('width', '100%')
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Title
  svg.append('text')
    .attr('x', width / 2)
    .attr('y', _mob ? 20 : 14)
    .attr('text-anchor', 'middle')
    .attr('font-weight', 700)
    .text(`Binomial(n = ${n}, p = ${p})`);

  const g = svg.append('g').attr('transform', `translate(${margin.left}, ${margin.top})`);
  chartG = g;

  const kValues = visible.map(d => d.k);
  const maxPMF = Math.max(...visible.map(d => d.pmf), 0.001);

  xBand = d3Scale.scaleBand()
    .domain(kValues.map(String))
    .range([0, innerW])
    .paddingInner(n > 40 ? 0.05 : 0.15)
    .paddingOuter(0.05);

  const yScale = d3Scale.scaleLinear()
    .domain([0, maxPMF])
    .nice()
    .range([innerH, 0]);

  // Linear scale for drag (maps pixel → continuous k)
  xLinear = d3Scale.scaleLinear()
    .domain([lo - 0.5, hi + 0.5])
    .range([0, innerW]);

  // Axes — thin out x ticks so they don't overlap on narrow screens
  const xAxis = d3Axis.axisBottom(xBand);
  if (kValues.length > 15) {
    const step = Math.ceil(kValues.length / 10);
    xAxis.tickValues(kValues.filter((_, i) => i % step === 0).map(String));
  }
  g.append('g').attr('transform', `translate(0, ${innerH})`).call(xAxis);
  g.append('g').call(d3Axis.axisLeft(yScale).ticks(5).tickFormat(formatTick));

  // X label
  g.append('text')
    .attr('class', 'x-label')
    .attr('x', innerW / 2)
    .attr('y', innerH + (_mob ? 55 : 45))
    .attr('text-anchor', 'middle')
    .text('k (number of successes)');

  // Y label
  g.append('text')
    .attr('class', 'y-label')
    .attr('text-anchor', 'middle')
    .attr('transform', 'rotate(-90)')
    .attr('x', -innerH / 2)
    .attr('y', -45)
    .text('P(X = k)');

  // Bars
  g.selectAll('.pmf-bar')
    .data(visible)
    .join('rect')
    .attr('class', 'pmf-bar')
    .attr('x', d => xBand(String(d.k)))
    .attr('y', d => yScale(d.pmf))
    .attr('width', xBand.bandwidth())
    .attr('height', d => innerH - yScale(d.pmf))
    .attr('fill', d => shadedKs.has(d.k) ? '#569BBD' : '#DCE5EC')
    .attr('stroke', d => shadedKs.has(d.k) ? '#3A7CA5' : '#9BB0BF')
    .attr('stroke-width', 1);

  // Probability pills
  addProbPills(g, xLinear, innerW, innerH, lo, hi, k, prob, type);

  // Normal approximation overlay
  if (showNormal.checked && sigma > 0) {
    const nPts = 200;
    const xMin = lo - 0.5;
    const xMax = hi + 0.5;
    const curveStep = (xMax - xMin) / nPts;
    /** @type {Array<{x: number, y: number}>} */
    const curve = [];
    for (let i = 0; i <= nPts; i++) {
      const x = xMin + i * curveStep;
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

  // Mean line (optional)
  if (showMean.checked) {
    g.append('line')
      .attr('x1', xLinear(mu))
      .attr('x2', xLinear(mu))
      .attr('y1', 0)
      .attr('y2', innerH)
      .attr('stroke', '#7B2D8E')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,3');
  }

  // Tap-to-place: click anywhere on chart to move k boundary
  g.append('rect')
    .attr('class', 'tap-target')
    .attr('width', innerW).attr('height', innerH)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('click', function (event) {
      const svgEl = /** @type {SVGSVGElement} */ (svg.node());
      const pt = svgEl.createSVGPoint();
      pt.x = event.clientX; pt.y = event.clientY;
      const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
      const rawX = xLinear.invert(svgPt.x - margin.left);
      const newK = Math.max(visibleLo, Math.min(visibleHi, Math.round(rawX)));
      paramK.value = String(newK);
      update();
    });

  // Draggable k boundary line
  addDraggableKLine(g, svg, data, n, k, innerW, innerH, margin);

}

/**
 * Render a probability pill (rounded rect + text) at a given position.
 * @param {d3Selection.Selection} g
 * @param {number} cx - Center x in pixels
 * @param {number} cy - Center y in pixels
 * @param {string} text
 * @param {boolean} isComplement
 */
function renderPill(g, cx, cy, text, isComplement) {
  const { charW, pad, pillH } = pillDimensions('prob');
  const textWidth = text.length * charW + pad;
  g.append('rect')
    .attr('class', isComplement ? 'prob-label-bg prob-complement-bg' : 'prob-label-bg')
    .attr('x', cx - textWidth / 2)
    .attr('y', cy - pillH / 2)
    .attr('width', textWidth)
    .attr('height', pillH)
    .attr('rx', 4)
    .attr('fill', isComplement ? '#f5f5f5' : '#e8f4f8')
    .attr('stroke', isComplement ? '#ccc' : '#569BBD')
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');
  g.append('text')
    .attr('class', isComplement ? 'prob-label prob-complement' : 'prob-label')
    .attr('x', cx)
    .attr('y', cy)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', isComplement ? '#6B6B6B' : '#7B2D8E')
    .style('pointer-events', 'none')
    .text(text);
}

/**
 * Add probability pills on the chart matching the continuous distribution style.
 * @param {d3Selection.Selection} g
 * @param {d3Scale.ScaleLinear<number,number>} xLin
 * @param {number} innerW
 * @param {number} innerH
 * @param {number} lo - Visible range lower bound
 * @param {number} hi - Visible range upper bound
 * @param {number} k
 * @param {number} prob
 * @param {string} type
 */
function addProbPills(g, xLin, innerW, innerH, lo, hi, k, prob, type) {
  const labelY = innerH * 0.55;
  const complement = 1 - prob;
  const probText = prob.toFixed(4);
  const compText = complement.toFixed(4);

  if (type === 'exact') {
    // Center pill on the k line
    const cx = Math.max(45, Math.min(innerW - 45, xLin(k)));
    renderPill(g, cx, labelY, probText, false);
  } else if (type === 'leq' || type === 'lt') {
    // Shaded region is left of k — center pill in [lo, k]
    const leftMid = xLin((lo + k) / 2);
    const leftCx = Math.max(45, Math.min(innerW - 45, leftMid));
    renderPill(g, leftCx, labelY, probText, false);
    // Complement on right side
    if (k < hi) {
      const rightMid = xLin((k + hi) / 2);
      const rightCx = Math.max(45, Math.min(innerW - 45, rightMid));
      renderPill(g, rightCx, labelY, compText, true);
    }
  } else if (type === 'geq' || type === 'gt') {
    // Shaded region is right of k — center pill in [k, hi]
    const rightMid = xLin((k + hi) / 2);
    const rightCx = Math.max(45, Math.min(innerW - 45, rightMid));
    renderPill(g, rightCx, labelY, probText, false);
    // Complement on left side
    if (k > lo) {
      const leftMid = xLin((lo + k) / 2);
      const leftCx = Math.max(45, Math.min(innerW - 45, leftMid));
      renderPill(g, leftCx, labelY, compText, true);
    }
  }
}

/**
 * Add a draggable vertical line at X = k with snap-to-integer behavior.
 * @param {d3Selection.Selection} g
 * @param {d3Selection.Selection} svg
 * @param {Array<{k: number, pmf: number, cdf: number}>} data
 * @param {number} n
 * @param {number} k
 * @param {number} innerW
 * @param {number} innerH
 * @param {{top:number,right:number,bottom:number,left:number}} margin
 */
function addDraggableKLine(g, svg, data, n, k, innerW, innerH, margin) {
  if (!xLinear) return;
  const kPx = xLinear(k);

  // Visible dashed line
  const kLine = g.append('line')
    .attr('class', 'k-boundary')
    .attr('x1', kPx).attr('x2', kPx)
    .attr('y1', 0).attr('y2', innerH)
    .attr('stroke', '#333')
    .attr('stroke-width', 1.5)
    .attr('stroke-dasharray', '6,3');

  // Invisible wide handle for easier dragging (44px for touch targets)
  const handleWidth = 44;
  const handle = g.append('rect')
    .attr('class', 'k-drag-handle')
    .attr('x', kPx - handleWidth / 2)
    .attr('y', 0)
    .attr('width', handleWidth)
    .attr('height', innerH)
    .attr('fill', 'transparent')
    .attr('cursor', 'ew-resize');

  // k value label below the line
  const { charW: kCharW, pad: kPad, pillH: kPillH } = pillDimensions('crit');
  const labelG = g.append('g').attr('class', 'k-label-group');
  const labelText = `k = ${k}`;
  const tw = labelText.length * kCharW + kPad;
  labelG.append('rect')
    .attr('class', 'k-label-bg')
    .attr('x', kPx - tw / 2)
    .attr('y', innerH + 6)
    .attr('width', tw)
    .attr('height', kPillH)
    .attr('rx', 3)
    .attr('fill', '#fff')
    .attr('stroke', '#569BBD')
    .attr('stroke-width', 1);
  const labelEl = labelG.append('text')
    .attr('class', 'crit-label')
    .attr('x', kPx)
    .attr('y', innerH + 6 + kPillH / 2)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', '#333')
    .text(labelText);

  // Drag state
  let dragging = false;
  const svgEl = /** @type {SVGSVGElement} */ (svg.node());
  const type = probType.value;

  handle.node().addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    handle.node().setPointerCapture(e.pointerId);
  });

  handle.node().addEventListener('pointermove', (e) => {
    if (!dragging || !xLinear) return;

    // Convert pointer to data-space x
    const pt = svgEl.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svgEl.getScreenCTM().inverse());
    const rawX = xLinear.invert(svgPt.x - margin.left);

    // Snap to nearest integer k within visible range
    const newK = Math.max(visibleLo, Math.min(visibleHi, Math.round(rawX)));
    const newPx = xLinear(newK);

    // Move line + handle
    kLine.attr('x1', newPx).attr('x2', newPx);
    handle.attr('x', newPx - handleWidth / 2);

    // Update label
    const newLabel = `k = ${newK}`;
    labelEl.text(newLabel);
    const newTw = newLabel.length * kCharW + kPad;
    labelG.select('.k-label-bg')
      .attr('x', newPx - newTw / 2)
      .attr('width', newTw);
    labelEl.attr('x', newPx);

    // Update bar shading in-place
    const { prob, shadedKs } = computeShading(data, newK, n, type);
    g.selectAll('.pmf-bar')
      .attr('fill', (/** @type {{k:number}} */ d) => shadedKs.has(d.k) ? '#569BBD' : '#DCE5EC')
      .attr('stroke', (/** @type {{k:number}} */ d) => shadedKs.has(d.k) ? '#3A7CA5' : '#9BB0BF');

    // Update probability pills
    g.selectAll('.prob-label-bg, .prob-label').remove();
    addProbPills(g, xLinear, innerW, innerH, visibleLo, visibleHi, newK, prob, type);

    // Update result display
    displayResult(newK, type, prob);

    // Sync input (don't trigger full update)
    paramK.value = String(newK);
  });

  handle.node().addEventListener('pointerup', () => {
    if (dragging) {
      dragging = false;
      // Table update on drag end (heavier operation)
      const currentK = parseInt(paramK.value, 10);
      const { shadedKs } = computeShading(data, currentK, n, type);
      renderTable(data, shadedKs);
      announce(`${typeLabel(currentK, type)}`);
    }
  });

  handle.node().addEventListener('lostpointercapture', () => {
    dragging = false;
  });
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

// ─── Stepper buttons for integer inputs ───

/**
 * Wrap an integer input with [−] [input] [+] stepper buttons.
 * @param {HTMLInputElement} input
 */
function addStepperButtons(input) {
  const parent = input.parentElement;
  if (!parent) return;

  const wrapper = document.createElement('span');
  wrapper.className = 'stepper-group';

  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'stepper-btn';
  minusBtn.textContent = '−';
  minusBtn.setAttribute('aria-label', `Decrease ${input.id}`);

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'stepper-btn';
  plusBtn.textContent = '+';
  plusBtn.setAttribute('aria-label', `Increase ${input.id}`);

  minusBtn.addEventListener('click', () => { input.stepDown(); input.dispatchEvent(new Event('input')); });
  plusBtn.addEventListener('click', () => { input.stepUp(); input.dispatchEvent(new Event('input')); });

  parent.insertBefore(wrapper, input);
  wrapper.appendChild(minusBtn);
  wrapper.appendChild(input);
  wrapper.appendChild(plusBtn);
}

addStepperButtons(paramN);
addStepperButtons(paramK);

// ─── Preset probability buttons ───

const PRESET_PROBS = [0.01, 0.025, 0.05, 0.10, 0.25];

/**
 * Find the smallest k such that P(X ≤ k) ≥ targetP (binomial inverse CDF).
 * @param {number} n
 * @param {number} p
 * @param {number} targetP
 * @returns {number}
 */
function binomQuantile(n, p, targetP) {
  let cumulative = 0;
  for (let i = 0; i <= n; i++) {
    cumulative += binomPMF(i, n, p);
    if (cumulative >= targetP - 1e-12) return i;
  }
  return n;
}

function buildPresetButtons() {
  const existing = document.getElementById('preset-bar');
  if (existing) existing.remove();

  const n = Math.max(1, Math.min(500, parseInt(paramN.value, 10) || 20));
  const p = Math.max(0, Math.min(1, parseFloat(paramP.value) || 0.5));
  const type = probType.value;

  const bar = document.createElement('div');
  bar.id = 'preset-bar';
  bar.className = 'preset-bar';

  const label = document.createElement('span');
  label.textContent = 'Quick set: ';
  label.style.fontSize = '0.8rem';
  bar.appendChild(label);

  for (const prob of PRESET_PROBS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'preset-btn';

    let k;
    if (type === 'leq' || type === 'lt') {
      k = binomQuantile(n, p, prob);
      btn.textContent = `P≤${prob}→k=${k}`;
    } else if (type === 'geq' || type === 'gt') {
      // Find k such that P(X ≥ k) ≈ prob → P(X ≤ k-1) ≈ 1-prob
      k = binomQuantile(n, p, 1 - prob) + 1;
      if (k > n) k = n;
      btn.textContent = `P≥${prob}→k=${k}`;
    } else {
      // exact — less useful, skip presets for exact
      continue;
    }

    btn.addEventListener('click', () => {
      paramK.value = String(k);
      update();
    });
    bar.appendChild(btn);
  }

  // Insert after chart area
  const chartSection = document.getElementById('chart');
  if (chartSection) chartSection.appendChild(bar);
}

// ─── Event listeners ───

paramN.addEventListener('input', () => { buildPresetButtons(); update(); });
paramP.addEventListener('input', () => { buildPresetButtons(); update(); });
paramK.addEventListener('input', update);
probType.addEventListener('change', () => { buildPresetButtons(); update(); });
showMean.addEventListener('change', update);
showNormal.addEventListener('change', update);

/** @param {string} msg */
function announce(msg) {
  if (announceDiv) announceDiv.textContent = msg;
}

// ─── Init ───

update();
buildPresetButtons();
