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

// Cached population histogram result for overlay animation
/** @type {{ frame: import('../../js/types.js').ChartFrame, xScale: d3Scale.ScaleLinear<number,number> }|null} */
let popHistResult = null;

// Animation lock — prevent rapid clicks during +1 animation
let animating = false;

// ─── Reduced motion preference ───
const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  const result = drawHistogram(popContainer, population, {
    id: 'pop-hist',
    xLabel: 'Value',
    yLabel: '',
    titleText: 'Population Distribution',
    animate: false,
    numBins: 40,
  });
  popHistResult = { frame: result.frame, xScale: result.xScale };
}

// ─── Sampling ───

/**
 * Draw one sample and return the sampled values.
 * @param {number} n - sample size
 * @returns {{ sample: number[], sampleMean: number }}
 */
function drawOneSample(n) {
  if (!rng) rng = createRng(seed);
  const sample = [];
  for (let j = 0; j < n; j++) {
    const idx = Math.floor(rng() * population.length);
    sample.push(population[idx]);
  }
  return { sample, sampleMean: mean(sample) };
}

/**
 * @param {number} count
 */
function drawSamples(count) {
  // For +1 with animation, use the animated path
  if (count === 1 && !prefersReducedMotion) {
    drawOneSampleAnimated();
    return;
  }

  if (!rng) rng = createRng(seed);
  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const prevLength = sampleMeans.length;

  for (let i = 0; i < count; i++) {
    const { sampleMean } = drawOneSample(n);
    sampleMeans.push(sampleMean);
  }

  updateStatsAndRender(prevLength, count);
}

/**
 * Animated +1 path: shows sample on population, then drops dot to sampling dist.
 */
function drawOneSampleAnimated() {
  if (animating) return;
  animating = true;

  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const prevLength = sampleMeans.length;
  const { sample, sampleMean } = drawOneSample(n);
  sampleMeans.push(sampleMean);

  // Step 1: Show orange sample lines on population
  showSampleOnPopulation(sample, sampleMean, () => {
    // Step 2: After showing sample, update the sampling distribution
    updateStatsAndRender(prevLength, 1);

    // Step 3: Animate the orange dot dropping into the sampling distribution
    animateDropDot(sampleMean, () => {
      animating = false;
    });
  });
}

/**
 * Draw thin orange lines on the population histogram for each sampled value,
 * then show the sample mean marker.
 * @param {number[]} sample
 * @param {number} sampleMean
 * @param {() => void} onDone
 */
function showSampleOnPopulation(sample, sampleMean, onDone) {
  if (!popHistResult) { onDone(); return; }

  const { frame, xScale } = popHistResult;
  const inner = d3Selection.select(frame.inner);
  const overlays = inner.select('.overlays');

  // Remove any previous sample overlay
  overlays.selectAll('.sample-overlay').remove();

  const g = overlays.append('g').attr('class', 'sample-overlay');

  // Draw thin orange lines for each sampled value
  const lineHeight = frame.height * 0.35; // lines go 35% up from x-axis
  for (const val of sample) {
    const x = xScale(val);
    if (x >= 0 && x <= frame.width) {
      g.append('line')
        .attr('x1', x).attr('y1', frame.height)
        .attr('x2', x).attr('y2', frame.height - lineHeight)
        .attr('stroke', '#F05133')
        .attr('stroke-width', 1.2)
        .attr('opacity', 0);
    }
  }

  // Fade in the sample lines
  g.selectAll('line')
    .attr('opacity', 0)
    .each(function () {
      const line = /** @type {SVGLineElement} */ (this);
      line.style.transition = 'opacity 0.2s ease-in';
      // Force reflow then set opacity
      void line.getBBox();
      line.setAttribute('opacity', '0.5');
    });

  // After 350ms, show the mean marker
  setTimeout(() => {
    const mx = xScale(sampleMean);

    // Orange triangle marker at x-axis pointing up
    g.append('polygon')
      .attr('points', `${mx - 6},${frame.height + 2} ${mx + 6},${frame.height + 2} ${mx},${frame.height - 8}`)
      .attr('fill', '#F05133');

    // Mean label
    g.append('text')
      .attr('x', mx)
      .attr('y', frame.height - 14)
      .attr('text-anchor', 'middle')
      .attr('font-size', '13px')
      .attr('font-weight', '700')
      .attr('fill', '#F05133')
      .text(`x̄ = ${sampleMean.toFixed(2)}`);

    // After showing the mean, proceed
    setTimeout(() => {
      // Fade out sample lines (keep mean marker a bit longer)
      g.selectAll('line').each(function () {
        /** @type {SVGLineElement} */ (this).style.transition = 'opacity 0.3s ease-out';
        /** @type {SVGLineElement} */ (this).setAttribute('opacity', '0');
      });

      setTimeout(() => {
        g.remove();
        onDone();
      }, 350);
    }, 400);
  }, 300);
}

/**
 * Animate an orange dot dropping from the top of the sampling distribution
 * chart to its x-position.
 * @param {number} sampleMean
 * @param {() => void} onDone
 */
function animateDropDot(sampleMean, onDone) {
  if (!samplingContainer) { onDone(); return; }

  const svg = samplingContainer.querySelector('svg');
  if (!svg) { onDone(); return; }

  const inner = svg.querySelector('.chart-inner');
  if (!inner) { onDone(); return; }

  // Find the xScale from the rendered chart by reading the x-axis domain
  // We need to position the dot — grab dimensions from the inner group transform
  const overlays = d3Selection.select(inner).select('.overlays');

  // Get the chart frame dimensions from the inner transform
  const transform = inner.getAttribute('transform') || '';
  const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
  const marginLeft = match ? parseFloat(match[1]) : 60;

  // Get SVG viewBox dimensions
  const vb = svg.getAttribute('viewBox')?.split(' ').map(Number) || [0, 0, 600, 371];
  const innerWidth = vb[2] - marginLeft - 20; // approximate right margin
  const innerHeight = vb[3] - (match ? parseFloat(match[2]) : 28) - 50; // approximate bottom margin

  // We need the xScale domain — get it from lastDomain
  if (!lastDomain) { onDone(); return; }
  const xScale = d3Scale.scaleLinear().domain(lastDomain).range([0, innerWidth]);
  const dotX = xScale(sampleMean);

  // Clamp to visible area
  if (dotX < 0 || dotX > innerWidth) { onDone(); return; }

  // Create the dropping dot
  const dot = overlays.append('circle')
    .attr('class', 'drop-dot')
    .attr('cx', dotX)
    .attr('cy', -10) // start above the chart
    .attr('r', 6)
    .attr('fill', '#F05133')
    .attr('opacity', 0.9);

  // Animate: drop from top to the x-axis level
  const targetY = innerHeight;
  const duration = 500;
  const startTime = performance.now();

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease-in (quadratic) for gravity-like feel
    const eased = t * t;
    const cy = -10 + (targetY + 10) * eased;
    dot.attr('cy', cy);

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // Brief pulse then fade
      dot.attr('r', 8).attr('opacity', 1);
      setTimeout(() => {
        dot.attr('opacity', 0);
        setTimeout(() => { dot.remove(); onDone(); }, 200);
      }, 300);
    }
  }

  requestAnimationFrame(step);
}

/**
 * Update stats display and render the sampling distribution chart.
 * @param {number} prevLength
 * @param {number} count
 */
function updateStatsAndRender(prevLength, count) {
  const n = parseInt(sampleSizeInput.value, 10) || 30;

  // Update stats
  if (samplingStats) {
    const wasHidden = samplingStats.hidden;
    samplingStats.hidden = false;
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

  const { bins: fullBins } = computeBins(sampleMeans, { domain: sharedDomain });
  const thresholds = fullBins.slice(1).map(b => b.x0);

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
    .attr('stroke', '#7B2D8E')
    .attr('stroke-width', 2.5)
    .attr('stroke-dasharray', '8,4');
}

/**
 * Overlay a N(mu, se) curve on a dotplot chart.
 * @param {{ frame: import('../../js/types.js').ChartFrame, dots: Array<{value: number, binCenter: number, stackIndex: number}>, xScale: d3Scale.ScaleLinear<number,number> }} result
 * @param {number[]} values
 */
function overlayNormalOnDotplot(result, values) {
  const { frame, xScale } = result;
  const n = values.length;
  const empiricalMu = mean(values);
  const empiricalSE = sd(values);
  if (empiricalSE <= 0 || n < 10) return;

  const dotInfo = computeDots(values);
  const { maxStack, binWidth } = dotInfo;
  const effectiveBins = Math.min(n, 40);
  const dotRadius = computeDotRadius(frame.width, frame.height, maxStack, effectiveBins);

  const maxY = maxStack * 1.1;
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
  animating = false;
  if (samplingContainer) samplingContainer.innerHTML = '';
  if (samplingStats) samplingStats.hidden = true;
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Choose a population shape and click a button to draw samples.</p>';
  if (resetBtn) resetBtn.hidden = true;
}

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── Init ───

initPopulation();
