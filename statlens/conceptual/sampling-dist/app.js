// @ts-check
/**
 * Sampling Distribution Demonstrator.
 * Students pick a population shape, set n, draw samples, and watch
 * the sampling distribution of x̄ build up — CLT in action.
 */

import { createRng, randNormal } from '../../js/prng.js';
import { mean, sd, quantile } from '../../js/stats.js';
import { drawHistogram, computeBins } from '../../js/histogram.js';
import { drawDotplot, computeDots, computeDotRadius } from '../../js/dotplot.js';
import { announce, initKeyboardShortcuts, initPlayPause, computeHighlights } from '../../js/page-utils.js';
import { resolveChartType } from '../../js/chart-defaults.js';
import { renderStatLabel } from '../../js/chart-utils.js';
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

// Pre-computed sampling distribution domain + dotplot grid (stable axes & stacks)
/** @type {[number,number]|null} */
let samplingDomain = null;
/** @type {number|null} */
let samplingBinWidth = null;
/** @type {number|null} */
let samplingBinOrigin = null;

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
  precomputeSamplingDomain();
  resetSimulation();
}

/**
 * Pre-compute the sampling distribution domain by running 2000 pilot samples.
 * Uses a separate RNG so the user's simulation is unaffected.
 */
function precomputeSamplingDomain() {
  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const pilotRng = createRng('pilot-' + popShapeSelect.value + '-' + n);
  const pilotMeans = [];
  for (let i = 0; i < 10000; i++) {
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += population[Math.floor(pilotRng() * population.length)];
    }
    pilotMeans.push(sum / n);
  }
  pilotMeans.sort((a, b) => a - b);
  // Use 0.1th and 99.9th percentiles so rare outlier means don't cause rescaling
  const lo = pilotMeans[Math.floor(pilotMeans.length * 0.001)];
  const hi = pilotMeans[Math.floor(pilotMeans.length * 0.999)];
  const range = hi - lo || 1;
  // 15% padding on each side ensures virtually no sample mean falls outside
  samplingDomain = [lo - range * 0.15, hi + range * 0.15];
  // Lock the dotplot bin grid so stacks don't shift as dots are added
  const domainSpan = samplingDomain[1] - samplingDomain[0];
  const numDotBins = 40; // matches dotplot.js default max
  samplingBinWidth = domainSpan / numDotBins;
  samplingBinOrigin = samplingDomain[0];
}

function renderPopulation() {
  if (!popContainer) return;
  popContainer.innerHTML = '';

  // Clip domain to 0.5th–99.5th percentile so long tails don't waste space
  const sorted = population.slice().sort((a, b) => a - b);
  const pLo = quantile(sorted, 0.005);
  const pHi = quantile(sorted, 0.995);
  const pad = (pHi - pLo) * 0.03;
  const popDomain = /** @type {[number, number]} */ ([pLo - pad, pHi + pad]);

  const result = drawHistogram(popContainer, population, {
    id: 'pop-hist',
    xLabel: 'Value',
    yLabel: '',
    titleText: 'Population Distribution',
    observedStat: popMu,
    observedLabel: 'μ',
    animate: false,
    numBins: 40,
    domain: popDomain,
  });
  popHistResult = { frame: result.frame, xScale: result.xScale };

  // Remove y-axis entirely — population chart shows shape only
  d3Selection.select(result.frame.inner).select('.y-axis').remove();
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
 * Animated +1: show sample on population, fly dot to sampling dist, then fade all.
 */
function drawOneSampleAnimated() {
  if (animating) return;
  animating = true;

  const n = parseInt(sampleSizeInput.value, 10) || 30;
  const prevLength = sampleMeans.length;
  const { sample, sampleMean } = drawOneSample(n);
  sampleMeans.push(sampleMean);

  // Step 1: Show sample lines + mean on population (stays visible)
  const popOverlay = showSampleOnPopulation(sample, sampleMean);

  // Step 2: After pause, render sampling dist, then fly dot from population to it
  setTimeout(() => {
    updateStatsAndRender(prevLength, 1);

    // Hide the highlight until the flying dot arrives
    const highlightEl = hideHighlight();

    // Step 3: Fly dot from population mean position to sampling distribution
    flyDotBetweenCharts(sampleMean, () => {
      // Reveal the highlight now that the dot has landed
      revealHighlights();
      // Step 4: Fade out everything together
      if (popOverlay) {
        popOverlay.style.transition = 'opacity 0.5s ease-out';
        popOverlay.style.opacity = '0';
      }
      setTimeout(() => {
        if (popOverlay) popOverlay.remove();
        animating = false;
      }, 550);
    });
  }, 900);
}

/**
 * Draw thin orange lines on the population histogram for each sampled value,
 * plus a mean marker. Returns the overlay group element (caller controls removal).
 * @param {number[]} sample
 * @param {number} sampleMean
 * @returns {SVGGElement|null}
 */
function showSampleOnPopulation(sample, sampleMean) {
  if (!popHistResult) return null;

  const { frame, xScale } = popHistResult;
  const inner = d3Selection.select(frame.inner);
  const overlays = inner.select('.overlays');

  // Remove any previous sample overlay
  overlays.selectAll('.sample-overlay').remove();

  const g = overlays.append('g').attr('class', 'sample-overlay');

  // Draw thin orange lines for each sampled value
  const lineHeight = frame.height * 0.35;
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
    .each(function () {
      const el = /** @type {SVGLineElement} */ (this);
      el.style.transition = 'opacity 0.3s ease-in';
      void el.getBBox();
      el.setAttribute('opacity', '0.5');
    });

  // After 500ms, add the mean marker
  setTimeout(() => {
    const mx = xScale(sampleMean);

    // Orange triangle pointing up
    g.append('polygon')
      .attr('class', 'mean-marker')
      .attr('points', `${mx - 7},${frame.height + 3} ${mx + 7},${frame.height + 3} ${mx},${frame.height - 9}`)
      .attr('fill', '#F05133')
      .attr('opacity', 0);

    // Mean label
    g.append('text')
      .attr('class', 'mean-label')
      .attr('x', mx)
      .attr('y', frame.height - 24)
      .attr('text-anchor', 'middle')
      .attr('font-size', '20px')
      .attr('font-weight', '700')
      .attr('fill', '#F05133')
      .attr('opacity', 0);

    // Set label text — use renderStatLabel for proper SVG overline on x̄
    renderStatLabel(g.select('.mean-label'), `x\u0304 = ${sampleMean.toFixed(2)}`);

    // Fade in marker + label
    g.select('.mean-marker').each(function () {
      const el = /** @type {SVGElement} */ (this);
      el.style.transition = 'opacity 0.25s ease-in';
      void el.getBBox();
      el.setAttribute('opacity', '1');
    });
    g.select('.mean-label').each(function () {
      const el = /** @type {SVGElement} */ (this);
      el.style.transition = 'opacity 0.25s ease-in';
      void el.getBBox();
      el.setAttribute('opacity', '1');
    });
  }, 450);

  return /** @type {SVGGElement} */ (g.node());
}

/**
 * Convert an SVG-local coordinate to a page-fixed position.
 * @param {SVGSVGElement} svg
 * @param {SVGGElement} inner
 * @param {number} localX - x in inner-group coordinates
 * @param {number} localY - y in inner-group coordinates
 * @returns {{ x: number, y: number }} viewport-fixed coordinates
 */
function svgLocalToFixed(svg, inner, localX, localY) {
  const pt = svg.createSVGPoint();
  pt.x = localX;
  pt.y = localY;
  // Transform from inner-group coords to SVG root coords
  const ctm = inner.getCTM();
  if (!ctm) return { x: 0, y: 0 };
  const svgPt = pt.matrixTransform(ctm);
  // Now convert from SVG viewport coords to screen coords
  const screenCtm = svg.getScreenCTM();
  if (!screenCtm) return { x: 0, y: 0 };
  const screenPt = pt.matrixTransform(/** @type {DOMMatrix} */ (inner.getCTM()).multiply(/** @type {DOMMatrix} */ (svg.getScreenCTM()).inverse()).inverse());
  // Simpler: use getBoundingClientRect + ratio
  const svgRect = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  const scaleX = svgRect.width / vb.width;
  const scaleY = svgRect.height / vb.height;
  // inner group transform
  const transform = inner.getAttribute('transform') || '';
  const match = transform.match(/translate\(([^,]+),\s*([^)]+)\)/);
  const tx = match ? parseFloat(match[1]) : 0;
  const ty = match ? parseFloat(match[2]) : 0;
  return {
    x: svgRect.left + (tx + localX) * scaleX,
    y: svgRect.top + (ty + localY) * scaleY,
  };
}

/**
 * Find the highlighted element in the sampling distribution chart and return
 * its center position (viewport-fixed) and rendered size.
 * @returns {{ x: number, y: number, size: number }|null}
 */
function findHighlightTarget() {
  if (!samplingContainer) return null;
  const sampSvg = /** @type {SVGSVGElement|null} */ (samplingContainer.querySelector('svg'));
  if (!sampSvg) return null;

  // For dotplot: find the highlighted circle (orange fill #E07020, enlarged)
  const circles = sampSvg.querySelectorAll('.data circle');
  for (const c of circles) {
    if (c.getAttribute('fill') === '#E07020') {
      const rect = c.getBoundingClientRect();
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        size: rect.width,
      };
    }
  }

  // For histogram: find the delta-bar (orange highlight bar)
  const deltaBars = sampSvg.querySelectorAll('.delta-bar');
  if (deltaBars.length > 0) {
    // Find the delta bar closest to the sample mean
    let best = deltaBars[0];
    let bestArea = 0;
    for (const bar of deltaBars) {
      const r = bar.getBoundingClientRect();
      const area = r.width * r.height;
      if (area > bestArea) { bestArea = area; best = bar; }
    }
    const rect = best.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      size: Math.min(rect.width, rect.height),
    };
  }

  return null;
}

/**
 * Hide the highlighted element in the sampling distribution chart.
 * Returns the element so the caller can reveal it later.
 * @returns {SVGElement|null}
 */
function hideHighlight() {
  if (!samplingContainer) return null;
  const sampSvg = samplingContainer.querySelector('svg');
  if (!sampSvg) return null;

  // Dotplot: hide the orange circle
  const circles = sampSvg.querySelectorAll('.data circle');
  for (const c of circles) {
    if (c.getAttribute('fill') === '#E07020') {
      /** @type {SVGElement} */ (c).style.opacity = '0';
      return /** @type {SVGElement} */ (c);
    }
  }

  // Histogram: hide delta-bars
  const deltaBars = sampSvg.querySelectorAll('.delta-bar');
  if (deltaBars.length > 0) {
    for (const bar of deltaBars) {
      /** @type {SVGElement} */ (bar).style.opacity = '0';
    }
    // Return first one — caller just needs a truthy value to trigger reveal
    return /** @type {SVGElement} */ (deltaBars[0]);
  }

  return null;
}

/**
 * Reveal all hidden highlights (for histogram delta-bars there may be multiple).
 */
function revealHighlights() {
  if (!samplingContainer) return;
  const sampSvg = samplingContainer.querySelector('svg');
  if (!sampSvg) return;
  // Restore any hidden circles
  for (const c of sampSvg.querySelectorAll('.data circle')) {
    if (/** @type {SVGElement} */ (c).style.opacity === '0') {
      /** @type {SVGElement} */ (c).style.removeProperty('opacity');
    }
  }
  // Restore any hidden delta-bars
  for (const bar of sampSvg.querySelectorAll('.delta-bar')) {
    if (/** @type {SVGElement} */ (bar).style.opacity === '0') {
      /** @type {SVGElement} */ (bar).style.removeProperty('opacity');
    }
  }
}

/**
 * Fly an orange dot from the mean position on the population chart
 * to the highlighted element in the sampling distribution chart.
 * Uses a fixed-position DOM element to cross between SVGs.
 * @param {number} sampleMean
 * @param {() => void} onDone
 */
function flyDotBetweenCharts(sampleMean, onDone) {
  if (!popHistResult || !popContainer || !samplingContainer) { onDone(); return; }

  const popSvg = /** @type {SVGSVGElement|null} */ (popContainer.querySelector('svg'));
  if (!popSvg) { onDone(); return; }

  const popInner = /** @type {SVGGElement|null} */ (popSvg.querySelector('.chart-inner'));
  if (!popInner) { onDone(); return; }

  // Start position: mean marker on population chart
  const { frame: popFrame, xScale: popXScale } = popHistResult;
  const popLocalX = popXScale(sampleMean);
  const popLocalY = popFrame.height - 10;
  const startPos = svgLocalToFixed(popSvg, popInner, popLocalX, popLocalY);

  // End position: the actual highlighted element in the sampling distribution
  const target = findHighlightTarget();
  if (!target) { onDone(); return; }
  const endPos = { x: target.x, y: target.y };

  // Fly the enlarged highlighted dot (matches dotplot highlight: 1.5× with black border)
  const dotSize = Math.max(target.size * 1.5, 12);
  const halfDot = dotSize / 2;

  // Create flying dot
  const dot = document.createElement('div');
  dot.className = 'flying-dot';
  dot.style.cssText = `
    position: fixed;
    width: ${dotSize}px; height: ${dotSize}px;
    border-radius: 50%;
    background: #E07020;
    border: 2px solid #000;
    box-sizing: border-box;
    z-index: 1000;
    pointer-events: none;
    left: ${startPos.x - halfDot}px;
    top: ${startPos.y - halfDot}px;
  `;
  document.body.appendChild(dot);

  // Animate from start to end using quadratic bezier (matches mechanism strip drop)
  const duration = 700;
  const startTime = performance.now();
  const sx = startPos.x, sy = startPos.y;
  const tx = endPos.x, ty = endPos.y;
  const dx = tx - sx;
  const dy = ty - sy;

  // Detect layout: side-by-side (dx dominant) vs stacked (dy dominant)
  const isSideBySide = Math.abs(dx) > Math.abs(dy);

  // Quadratic bezier control point
  let cpx, cpy;
  if (isSideBySide) {
    // Side-by-side: arc upward above both charts
    cpx = sx + dx * 0.5;
    cpy = Math.min(sy, ty) - Math.abs(dx) * 0.3 - 40;
  } else {
    // Stacked: pop up slightly from the mean, then fall down into the
    // sampling distribution — like tossing a ball into a bucket below.
    // Small upward launch (25px above start), gentle lateral drift.
    cpx = sx + dx * 0.5 + 25;
    cpy = sy - 25;
  }

  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease-in-out cubic
    const eased = t < 0.5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Quadratic bezier position
    const u = 1 - eased;
    const x = u * u * sx + 2 * u * eased * cpx + eased * eased * tx;
    const y = u * u * sy + 2 * u * eased * cpy + eased * eased * ty;

    dot.style.left = `${x - halfDot}px`;
    dot.style.top = `${y - halfDot}px`;

    if (t < 1) {
      requestAnimationFrame(step);
    } else {
      // Landed — fade out
      dot.style.transition = 'opacity 0.4s ease-out';
      setTimeout(() => {
        dot.style.opacity = '0';
        setTimeout(() => {
          dot.remove();
          onDone();
        }, 400);
      }, 250);
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

  // Use pre-computed domain so axes never shift
  const sharedDomain = samplingDomain || /** @type {[number,number]} */ ([
    Math.min(...sampleMeans) - 0.5,
    Math.max(...sampleMeans) + 0.5,
  ]);

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
      domain,
      binWidth: samplingBinWidth,
      binOrigin: samplingBinOrigin,
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
  precomputeSamplingDomain();
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
  // Clean up any lingering animation elements
  if (popHistResult?.frame?.inner) {
    d3Selection.select(popHistResult.frame.inner).selectAll('.sample-overlay').remove();
  }
  document.querySelectorAll('.flying-dot').forEach(el => el.remove());
  if (samplingContainer) samplingContainer.innerHTML = '';
  if (samplingStats) samplingStats.hidden = true;
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Choose a population shape and click a button to draw samples.</p>';
  if (resetBtn) resetBtn.hidden = true;
}

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── Init ───

initPopulation();
