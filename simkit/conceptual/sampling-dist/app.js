// @ts-check
/**
 * Sampling Distribution Demonstrator.
 * Students pick a population shape, set n, draw samples, and watch
 * the sampling distribution of x̄ build up — CLT in action.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { mean, sd } from '../../js/stats.js';
import { drawHistogram, computeBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { announce, initKeyboardShortcuts, initPlayPause, computeHighlights } from '../../js/page-utils.js';
import * as d3Scale from 'd3-scale';
import * as d3Shape from 'd3-shape';
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

/** Population size for the "population" histogram */
const POP_SIZE = 10000;

/**
 * Generate population values for each shape.
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
      // Exponential(λ=0.1) shifted to center around 10
      for (let i = 0; i < POP_SIZE; i++) vals.push(-Math.log(1 - rng()) / 0.1);
      break;
    case 'left-skewed':
      // Reflect the right-skewed: max - exponential
      for (let i = 0; i < POP_SIZE; i++) vals.push(50 - (-Math.log(1 - rng()) / 0.1));
      break;
    case 'uniform':
      for (let i = 0; i < POP_SIZE; i++) vals.push(rng() * 100);
      break;
    case 'bimodal':
      // Mixture of two normals
      for (let i = 0; i < POP_SIZE; i++) {
        if (rng() < 0.5) {
          vals.push(randNormal(30, 5, rng));
        } else {
          vals.push(randNormal(70, 5, rng));
        }
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
    // Draw a random sample of size n from the population
    const sample = [];
    for (let j = 0; j < n; j++) {
      const idx = Math.floor(rng() * population.length);
      sample.push(population[idx]);
    }
    sampleMeans.push(mean(sample));
  }

  // Update stats
  if (samplingStats) samplingStats.hidden = false;
  if (nSamplesEl) nSamplesEl.textContent = String(sampleMeans.length);
  if (sampleMeans.length >= 2) {
    if (meanXbarEl) meanXbarEl.textContent = mean(sampleMeans).toFixed(4);
    if (sdXbarEl) sdXbarEl.textContent = sd(sampleMeans).toFixed(4);
  }
  if (seTheoryEl) seTheoryEl.textContent = (popSigma / Math.sqrt(n)).toFixed(4);

  // Pass domain from full data so prev bin edges align with current bins
  const smLo = Math.min(...sampleMeans);
  const smHi = Math.max(...sampleMeans);
  const smPad = (smHi - smLo) * 0.05 || 0.5;
  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    sampleMeans, prevLength, count, computeBins,
    { domain: [smLo - smPad, smHi + smPad] });

  renderSamplingDist(hlIndex, hlIndices, prevBinCounts);
  displayInterpretation();

  if (resetBtn) resetBtn.hidden = false;
  announce(`Drew ${count} sample${count > 1 ? 's' : ''}. Total: ${sampleMeans.length}`);
}

/**
 * Normal PDF: f(x) = (1 / (σ√(2π))) * exp(-0.5 * ((x-μ)/σ)²)
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
 * Scales the PDF so the curve's area matches the histogram (count × binWidth).
 * @param {import('../../js/types.js').ChartFrame} frame
 * @param {number} mu
 * @param {number} se - standard error (σ/√n)
 * @param {import('d3-scale').ScaleLinear<number,number>} xScale
 * @param {number} totalCount - number of sample means
 * @param {number} binWidth - histogram bin width
 * @param {number} maxBinCount - tallest bin's count (pre-nice)
 */
function overlayNormalCurve(frame, mu, se, xScale, totalCount, binWidth, maxBinCount) {
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  overlays.selectAll('.normal-curve').remove();

  if (se <= 0 || totalCount < 10) return;

  const [xMin, xMax] = xScale.domain();
  const steps = 120;
  const dx = (xMax - xMin) / steps;

  // Scale PDF density → count so area under curve ≈ histogram area
  const scaleFactor = totalCount * binWidth;
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const x = xMin + i * dx;
    const y = normalPdf(x, mu, se) * scaleFactor;
    points.push([x, y]);
  }

  // Reconstruct the histogram's yScale: [0, nice(maxBinCount)] → [height, 0]
  const yScale = d3Scale.scaleLinear()
    .domain([0, maxBinCount])
    .nice()
    .range([frame.height, 0]);

  const line = d3Shape.line()
    .x(d => xScale(d[0]))
    .y(d => yScale(d[1]));

  overlays.append('path')
    .attr('class', 'normal-curve')
    .attr('d', line(points))
    .attr('fill', 'none')
    .attr('stroke', '#114B5F')
    .attr('stroke-width', 2.5)
    .attr('stroke-dasharray', '8,4')
    .attr('aria-label', `Normal curve: N(${mu.toFixed(2)}, ${se.toFixed(4)})`);
}

/**
 * @param {number} [highlightIndex]
 * @param {Set<number>} [highlightIndices]
 * @param {number[]} [prevBinCounts]
 */
function renderSamplingDist(highlightIndex = -1, highlightIndices, prevBinCounts) {
  if (!samplingContainer) return;
  samplingContainer.innerHTML = '';
  const n = sampleMeans.length;
  if (n === 0) return;

  const sampleN = parseInt(sampleSizeInput.value, 10) || 30;
  const se = popSigma / Math.sqrt(sampleN);

  // Use histogram when we have enough samples (or when normal overlay is on)
  const useHistogram = n > 200 || (showNormalCheckbox?.checked && n > 30);

  if (!useHistogram) {
    drawDotplot(samplingContainer, sampleMeans, {
      id: 'sampling-dist',
      xLabel: 'Sample Mean (x̄)',
      titleText: 'Sampling Distribution of x̄',
      observedStat: popMu,
      animate: false,
      highlightIndex,
      highlightIndices,
    });
  } else {
    const result = drawHistogram(samplingContainer, sampleMeans, {
      id: 'sampling-dist',
      xLabel: 'Sample Mean (x̄)',
      titleText: 'Sampling Distribution of x̄',
      observedStat: popMu,
      animate: false,
      prevBinCounts,
    });
    if (showNormalCheckbox?.checked && result?.bins?.length > 0) {
      const binWidth = result.bins[0].x1 - result.bins[0].x0;
      const maxBinCount = Math.max(...result.bins.map(b => b.length));
      overlayNormalCurve(result.frame, popMu, se, result.xScale, n, binWidth, maxBinCount);
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

  let html = `<p><strong>Sampling Distribution</strong> (${k} samples of size <em>n</em> = ${n})</p>`;
  html += `<p>Population: <em>&mu;</em> = ${popMu.toFixed(2)}, &ensp;<em>&sigma;</em> = ${popSigma.toFixed(2)}</p>`;
  html += `<p>Mean of <em>x&#x0304;</em>&rsquo;s = ${xbarMean.toFixed(4)} &ensp;(should be close to <em>&mu;</em> = ${popMu.toFixed(2)})</p>`;
  html += `<p>SD of <em>x&#x0304;</em>&rsquo;s = ${xbarSd.toFixed(4)} &ensp;(theory: <em>&sigma;</em>/&radic;<em>n</em> = ${theorySE.toFixed(4)})</p>`;

  if (k >= 100) {
    html += `<p class="interpretation">The Central Limit Theorem says the sampling distribution of <em>x&#x0304;</em> is approximately normal with mean <em>&mu;</em> and standard deviation <em>&sigma;</em>/&radic;<em>n</em>, regardless of the population shape — as long as <em>n</em> is large enough. `;
    if (n >= 30) {
      html += `With <em>n</em> = ${n}, notice how the distribution of sample means is roughly bell-shaped, even though the population may not be.</p>`;
    } else {
      html += `With <em>n</em> = ${n}, the shape depends more on the population. Try increasing <em>n</em> to see the distribution become more normal.</p>`;
    }
  } else {
    html += `<p class="hint">Draw more samples (at least 100) to see the pattern clearly.</p>`;
  }

  resultDiv.innerHTML = html;
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
    if (sampleMeans.length > 0) renderSamplingDist();
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
  if (samplingContainer) samplingContainer.innerHTML = '';
  if (samplingStats) samplingStats.hidden = true;
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Choose a population shape and click a button to draw samples.</p>';
  if (resetBtn) resetBtn.hidden = true;
}

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── Init ───

initPopulation();
