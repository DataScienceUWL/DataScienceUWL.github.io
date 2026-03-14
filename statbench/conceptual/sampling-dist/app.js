// @ts-check
/**
 * Sampling Distribution Demonstrator.
 * Students pick a population shape, set n, draw samples, and watch
 * the sampling distribution of x̄ build up — CLT in action.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { mean, sd } from '../../js/stats.js';
import { drawHistogram, computeBins } from '../../js/histogram.js';
import { drawDotplot, computeDots, computeDotRadius } from '../../js/dotplot.js';
import { announce, initKeyboardShortcuts, initPlayPause, computeHighlights } from '../../js/page-utils.js';
import { resolveChartType } from '../../js/chart-defaults.js';
import * as d3Shape from 'd3-shape';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';

// ─── DOM ───

const popShapeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('pop-shape'));
const sampleSizeInput = /** @type {HTMLInputElement} */ (document.getElementById('sample-size'));
const popContainer = document.getElementById('pop-container');
const samplingContainer = document.getElementById('sampling-container');
const samplingStats = document.getElementById('sampling-stats');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));

const popMeanEl = document.getElementById('pop-mean');
const popSdEl = document.getElementById('pop-sd');
const nSamplesEl = document.getElementById('n-samples');
const meanXbarEl = document.getElementById('mean-xbar');
const sdXbarEl = document.getElementById('sd-xbar');
const seTheoryEl = document.getElementById('se-theory');

const showNormalCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-normal'));

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

// ─── Population definitions ───

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
    case 'left-skewed':
      for (let i = 0; i < POP_SIZE; i++) vals.push(50 - (-Math.log(1 - rng()) / 0.1));
      break;
    case 'uniform':
      for (let i = 0; i < POP_SIZE; i++) vals.push(rng() * 100);
      break;
    case 'bimodal':
      for (let i = 0; i < POP_SIZE; i++) {
        if (rng() < 0.5) vals.push(randNormal(30, 5, rng));
        else vals.push(randNormal(70, 5, rng));
      }
      break;
    default:
      for (let i = 0; i < POP_SIZE; i++) vals.push(randNormal(50, 10, rng));
  }
  return vals;
}

// ─── State ───

/** @type {number[]} */
let population = [];
let popMu = 0;
let popSigma = 0;

/** @type {number[]} */
let sampleMeans = [];

/** @type {(() => number)|null} */
let rng = null;
let seed = Math.random().toString(36).slice(2, 10);

// Cached chart params for checkbox toggle re-render
/** @type {[number,number]|undefined} */
let lastDomain;
/** @type {number[]|undefined} */
let lastThresholds;

// ─── Initialize ───

function initPopulation() {
  const shape = popShapeSelect.value;
  const popRng = createRng('pop-' + shape);
  population = generatePopulation(shape, popRng);
  popMu = mean(population);
  popSigma = sd(population);

  if (popMeanEl) popMeanEl.textContent = popMu.toFixed(2);
  if (popSdEl) popSdEl.textContent = popSigma.toFixed(2);

  renderPopulation();
  resetSimulation();
}

function renderPopulation() {
  if (!popContainer) return;
  popContainer.innerHTML = '';
  drawHistogram(popContainer, population, {
    id: 'pop-hist',
    xLabel: 'Value',
    titleText: 'Population Distribution',
    animate: false,
    numBins: 40,
  });
}

// ─── Sampling ───

/**
 * @param {number} count
 */
function drawSamples(count) {
  if (!rng) rng = createRng(seed);
  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const prevLength = sampleMeans.length;

  for (let i = 0; i < count; i++) {
    const sample = [];
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * population.length);
      sample.push(population[idx]);
    }
    sampleMeans.push(mean(sample));
  }

  // Update stats
  if (samplingStats) {
    const wasHidden = samplingStats.hidden;
    samplingStats.hidden = false;
    // KaTeX auto-render skips hidden elements — render on first show
    if (wasHidden && typeof renderMathInElement === 'function') {
      renderMathInElement(samplingStats, {
        delimiters: [{ left: '\\(', right: '\\)', display: false }],
      });
    }
  }
  if (nSamplesEl) nSamplesEl.textContent = String(sampleMeans.length);
  if (sampleMeans.length >= 2) {
    if (meanXbarEl) meanXbarEl.textContent = mean(sampleMeans).toFixed(4);
    if (sdXbarEl) sdXbarEl.textContent = sd(sampleMeans).toFixed(4);
  }
  if (seTheoryEl) seTheoryEl.textContent = (popSigma / Math.sqrt(n)).toFixed(4);

  // Compute shared domain + thresholds so prev/current bin edges align exactly
  const smLo = Math.min(...sampleMeans);
  const smHi = Math.max(...sampleMeans);
  const smPad = (smHi - smLo) * 0.05 || 0.5;
  const sharedDomain = /** @type {[number,number]} */ ([smLo - smPad, smHi + smPad]);

  // Pre-compute bins for the full dataset to lock in bin edges
  const { bins: fullBins } = computeBins(sampleMeans, { domain: sharedDomain });
  const thresholds = fullBins.slice(1).map(b => b.x0);

  // Cache for checkbox toggle re-render
  lastDomain = sharedDomain;
  lastThresholds = thresholds;

  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    sampleMeans, prevLength, count, computeBins,
    { domain: sharedDomain, thresholds });

  renderSamplingDist(hlIndex, hlIndices, prevBinCounts, sharedDomain, thresholds);
  displayInterpretation();

  if (resetBtn) resetBtn.hidden = false;
  announce(`Drew ${count} sample${count > 1 ? 's' : ''}. Total: ${sampleMeans.length}`);
}

/**
 * Normal PDF
 * @param {number} x
 * @param {number} mu
 * @param {number} sigma
 * @returns {number}
 */
function normalPdf(x, mu, sigma) {
  const z = (x - mu) / sigma;
  return Math.exp(-0.5 * z * z) / (sigma * Math.sqrt(2 * Math.PI));
}

/**
 * Overlay a N(mu, se) curve on a histogram chart.
 * @param {SVGGElement} inner
 * @param {number} mu
 * @param {number} se
 * @param {Function} xScale
 * @param {Function} yScale
 * @param {number} totalCount
 * @param {number} binWidth - average bin width
 */
function overlayNormalCurve(inner, mu, se, xScale, yScale, totalCount, binWidth) {
  const overlays = d3Selection.select(inner).select('.overlays');
  overlays.selectAll('.normal-curve').remove();

  if (se <= 0 || totalCount < 10) return;

  const [xMin, xMax] = xScale.domain();
  const steps = 150;
  const dx = (xMax - xMin) / steps;

  // Scale PDF density → frequency count
  const scaleFactor = totalCount * binWidth;

  /** @type {[number, number][]} */
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * dx;
    const y = normalPdf(x, mu, se) * scaleFactor;
    points.push([x, y]);
  }

  const line = d3Shape.line()
    .x(d => xScale(d[0]))
    .y(d => yScale(d[1]));

  overlays.append('path')
    .attr('class', 'normal-curve')
    .attr('d', line(points))
    .attr('fill', 'none')
    .attr('stroke', '#114B5F')
    .attr('stroke-width', 2.5)
    .attr('stroke-dasharray', '8,4');
}

/**
 * Overlay a N(mu, se) curve on a dotplot chart.
 * Builds a virtual yScale from the dotplot's stacking geometry so the
 * curve height matches the tallest dot stack.
 *
 * @param {{ frame: import('../../js/types.js').ChartFrame, dots: Array<{value: number, binCenter: number, stackIndex: number}>, xScale: d3Scale.ScaleLinear<number,number> }} result
 * @param {number[]} values
 */
function overlayNormalOnDotplot(result, values) {
  const { frame, xScale } = result;
  const n = values.length;
  const empiricalMu = mean(values);
  const empiricalSE = sd(values);
  if (empiricalSE <= 0 || n < 10) return;

  // Recompute dot geometry to get maxStack and binWidth
  const dotInfo = computeDots(values);
  const { maxStack, binWidth } = dotInfo;
  const effectiveBins = Math.min(n, 40);
  const dotRadius = computeDotRadius(frame.width, frame.height, maxStack, effectiveBins);

  // Build a virtual yScale: dotplot stacks go from 0 to maxStack,
  // mapping to pixel positions [innerHeight, innerHeight - maxStack * 2 * dotRadius]
  // The peak of the normal curve (in "count" units) should match ~maxStack
  const maxY = maxStack * 1.1; // small headroom
  const yScale = d3Scale.scaleLinear()
    .domain([0, maxY])
    .range([frame.height, frame.height - maxY * dotRadius * 2]);

  overlayNormalCurve(frame.inner, empiricalMu, empiricalSE,
    xScale, yScale, n, binWidth);
}

/**
 * @param {number} [highlightIndex]
 * @param {Set<number>} [highlightIndices]
 * @param {number[]} [prevBinCounts]
 * @param {[number,number]} [domain]
 * @param {number[]} [thresholds]
 */
function renderSamplingDist(highlightIndex = -1, highlightIndices, prevBinCounts, domain, thresholds) {
  if (!samplingContainer) return;
  samplingContainer.innerHTML = '';
  const n = sampleMeans.length;
  if (n === 0) return;

  // Dotplot for small counts, histogram for large
  const activeChart = resolveChartType(n, 'auto');
  if (activeChart === 'dotplot') {
    const result = drawDotplot(samplingContainer, sampleMeans, {
      id: 'sampling-dist',
      xLabel: 'Sample Mean',
      titleText: 'Sampling Distribution of x̄',
      observedStat: popMu,
      observedLabel: 'μ',
      animate: false,
      highlightIndex,
      highlightIndices,
    });
    if (showNormalCheckbox?.checked && n >= 10) {
      overlayNormalOnDotplot(result, sampleMeans);
    }
  } else {
    const result = drawHistogram(samplingContainer, sampleMeans, {
      id: 'sampling-dist',
      xLabel: 'Sample Mean',
      titleText: 'Sampling Distribution of x̄',
      observedStat: popMu,
      observedLabel: 'μ',
      animate: false,
      prevBinCounts,
      domain,
      thresholds,
    });
    if (showNormalCheckbox?.checked && result?.bins?.length > 0) {
      // Use AVERAGE bin width — edge bins may differ due to padded domain
      const firstX0 = result.bins[0].x0;
      const lastX1 = result.bins[result.bins.length - 1].x1;
      const avgBinWidth = (lastX1 - firstX0) / result.bins.length;
      const empiricalMu = mean(sampleMeans);
      const empiricalSE = sd(sampleMeans);
      overlayNormalCurve(result.frame.inner, empiricalMu, empiricalSE,
        result.xScale, result.yScale, n, avgBinWidth);
    }
  }
}

function displayInterpretation() {
  if (!resultDiv) return;
  const k = sampleMeans.length;
  const n = parseInt(sampleSizeInput.value, 10) || 30;

  if (k < 2) {
    resultDiv.innerHTML = `<p><strong>Sampling Distribution</strong> (${k} sample${k > 1 ? 's' : ''})</p>
      <p>Draw more samples to see the distribution take shape.</p>`;
    return;
  }

  const xbarMean = mean(sampleMeans);
  const xbarSd = sd(sampleMeans);
  const theorySE = popSigma / Math.sqrt(n);

  let html = `<p><strong>Sampling Distribution</strong> — ${k} samples of size \\(n = ${n}\\)</p>`;
  html += `<p>Population: \\(\\mu = ${popMu.toFixed(2)}\\), &ensp;\\(\\sigma = ${popSigma.toFixed(2)}\\)</p>`;
  html += `<p>Mean of \\(\\bar{x}\\)'s \\(= ${xbarMean.toFixed(4)}\\) &ensp;(should be close to \\(\\mu = ${popMu.toFixed(2)}\\))</p>`;
  html += `<p>SD of \\(\\bar{x}\\)'s \\(= ${xbarSd.toFixed(4)}\\) &ensp;(theory: \\(\\sigma/\\sqrt{n} = ${theorySE.toFixed(4)}\\))</p>`;

  if (k >= 100) {
    html += `<p class="interpretation">The Central Limit Theorem says the sampling distribution of \\(\\bar{x}\\) is approximately normal with mean \\(\\mu\\) and standard deviation \\(\\sigma/\\sqrt{n}\\), regardless of the population shape — as long as \\(n\\) is large enough. `;
    if (n >= 30) {
      html += `With \\(n = ${n}\\), notice how the distribution of sample means is roughly bell-shaped, even though the population may not be.</p>`;
    } else {
      html += `With \\(n = ${n}\\), the shape depends more on the population. Try increasing \\(n\\) to see the distribution become more normal.</p>`;
    }
  } else {
    html += `<p class="hint">Draw more samples (at least 100) to see the pattern clearly.</p>`;
  }

  resultDiv.innerHTML = html;
  if (typeof renderMathInElement === 'function') {
    renderMathInElement(resultDiv, {
      delimiters: [{ left: '\\(', right: '\\)', display: false }],
    });
  }
}

// ─── Event listeners ───

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.count, 10);
    drawSamples(count);
  });
}

popShapeSelect.addEventListener('change', () => initPopulation());

if (showNormalCheckbox) {
  showNormalCheckbox.addEventListener('change', () => {
    if (sampleMeans.length > 0) {
      renderSamplingDist(-1, undefined, undefined, lastDomain, lastThresholds);
    }
  });
}

sampleSizeInput.addEventListener('change', () => {
  const val = parseInt(sampleSizeInput.value, 10);
  if (val < 1) sampleSizeInput.value = '1';
  if (val > 500) sampleSizeInput.value = '500';
  resetSimulation();
  announce(`Sample size set to ${sampleSizeInput.value}. Simulation reset.`);
});

// ─── Reset ───

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    resetSimulation();
    announce('Simulation reset.');
  });
}

function resetSimulation() {
  sampleMeans = [];
  rng = null;
  seed = Math.random().toString(36).slice(2, 10);
  lastDomain = undefined;
  lastThresholds = undefined;
  if (samplingContainer) samplingContainer.innerHTML = '';
  if (samplingStats) samplingStats.hidden = true;
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Choose a population shape and click a button to draw samples.</p>';
  if (resetBtn) resetBtn.hidden = true;
}

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── Init ───

initPopulation();
