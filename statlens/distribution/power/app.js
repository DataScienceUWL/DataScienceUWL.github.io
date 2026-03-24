// @ts-check
/**
 * Power & Error Visualizer — interactive D3 chart showing
 * null and alternative sampling distributions with shaded
 * regions for Type I error (α), Type II error (β), and Power (1−β).
 */

import { pdfNormal, normalCDF, normalInv, setJStat } from '../../js/distributions.js';
import { createChart, addAxes, formatTick, debounce, prefersReducedMotion } from '../../js/chart-utils.js';
import { generateCurveData } from '../../js/curve.js';
import { initHelp } from '../../js/page-utils.js';
import { parseParams } from '../../js/url-params.js';

import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import * as d3Shape from 'd3-shape';
import * as d3Array from 'd3-array';

// ── Colors ──────────────────────────────────────────────────────────
const NULL_STROKE  = '#569BBD';       // IMS blue — null distribution curve
const ALT_STROKE   = '#E07020';       // Warm orange — alternative distribution curve
const ALPHA_FILL   = 'rgba(244,67,54,0.30)';   // Red — Type I error
const BETA_FILL    = 'rgba(92,107,192,0.30)';   // Indigo — Type II error
const POWER_FILL   = 'rgba(76,175,80,0.30)';    // Green — Power
const CRIT_STROKE  = '#333';          // Dark gray — critical value line

import('jstat').then(jstat => {
  setJStat(jstat.default || jstat);
  initPowerVisualizer();
});

function initPowerVisualizer() {
  initHelp();
  const urlParams = parseParams(window.location.search);

  // ── DOM references ──────────────────────────────────────────────
  const chartContainer = document.getElementById('chart-container');
  const sliderAlpha = /** @type {HTMLInputElement} */ (document.getElementById('slider-alpha'));
  const inputAlpha  = /** @type {HTMLInputElement} */ (document.getElementById('input-alpha'));
  const sliderN     = /** @type {HTMLInputElement} */ (document.getElementById('slider-n'));
  const inputN      = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));
  const sliderDelta = /** @type {HTMLInputElement} */ (document.getElementById('slider-delta'));
  const inputDelta  = /** @type {HTMLInputElement} */ (document.getElementById('input-delta'));
  const sliderSigma = /** @type {HTMLInputElement} */ (document.getElementById('slider-sigma'));
  const inputSigma  = /** @type {HTMLInputElement} */ (document.getElementById('input-sigma'));
  const tailRadios  = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll('input[name="tail"]'));
  const announceDiv = document.getElementById('sr-announce');

  // Result display elements
  const resultPower = document.getElementById('result-power');
  const resultBeta  = document.getElementById('result-beta');
  const resultAlpha = document.getElementById('result-alpha');
  const resultCrit  = document.getElementById('result-crit');

  // Alpha preset buttons
  const presetBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.alpha-presets button[data-alpha]'));

  // ── Apply URL params ────────────────────────────────────────────
  if (urlParams.alpha != null) {
    inputAlpha.value = sliderAlpha.value = String(urlParams.alpha);
  }
  if (urlParams.n != null) {
    inputN.value = sliderN.value = String(urlParams.n);
  }
  if (urlParams.delta != null) {
    inputDelta.value = sliderDelta.value = String(urlParams.delta);
  }
  if (urlParams.sigma != null) {
    inputSigma.value = sliderSigma.value = String(urlParams.sigma);
  }
  if (urlParams.tail) {
    for (const r of tailRadios) r.checked = r.value === urlParams.tail;
  }

  // ── State ───────────────────────────────────────────────────────
  function getParams() {
    return {
      alpha: parseFloat(inputAlpha.value) || 0.05,
      n:     Math.max(2, Math.round(parseFloat(inputN.value) || 30)),
      delta: parseFloat(inputDelta.value) || 0,
      sigma: Math.max(0.01, parseFloat(inputSigma.value) || 1),
    };
  }

  function getTail() {
    for (const r of tailRadios) {
      if (r.checked) return /** @type {'left'|'right'|'both'} */ (r.value);
    }
    return 'right';
  }

  // ── Math ────────────────────────────────────────────────────────
  /**
   * Compute power analysis results.
   * @param {{ alpha: number, n: number, delta: number, sigma: number }} p
   * @param {'left'|'right'|'both'} tail
   */
  function computePower(p, tail) {
    const se = p.sigma / Math.sqrt(p.n);
    const mu0 = 0;
    const mu1 = p.delta; // μ₁ = μ₀ + δ, with μ₀ = 0

    let critLow = -Infinity;
    let critHigh = Infinity;
    let power;

    if (tail === 'right') {
      critHigh = normalInv(1 - p.alpha, mu0, se);
      // Power = P(X̄ > critHigh | μ = μ₁)
      power = 1 - normalCDF(critHigh, mu1, se);
    } else if (tail === 'left') {
      critLow = normalInv(p.alpha, mu0, se);
      // Power = P(X̄ < critLow | μ = μ₁)
      power = normalCDF(critLow, mu1, se);
    } else {
      // Two-tailed
      critLow = normalInv(p.alpha / 2, mu0, se);
      critHigh = normalInv(1 - p.alpha / 2, mu0, se);
      // Power = P(X̄ < critLow | μ₁) + P(X̄ > critHigh | μ₁)
      power = normalCDF(critLow, mu1, se) + (1 - normalCDF(critHigh, mu1, se));
    }

    const beta = 1 - power;
    return { power, beta, critLow, critHigh, se, mu0, mu1 };
  }

  // ── Chart rendering ─────────────────────────────────────────────
  function render() {
    const p = getParams();
    const tail = getTail();
    const result = computePower(p, tail);
    const { se, mu0, mu1, critLow, critHigh, power, beta } = result;

    // Domain: show both distributions with ample room
    const lowestMu = Math.min(mu0, mu1);
    const highestMu = Math.max(mu0, mu1);
    const span = Math.max(se * 4, (highestMu - lowestMu) / 2 + se * 4);
    const domLo = lowestMu - span;
    const domHi = highestMu + span;
    const domain = /** @type {[number, number]} */ ([domLo, domHi]);

    // Generate curve data
    const nullPdf = (/** @type {number} */ x) => pdfNormal(x, mu0, se);
    const altPdf  = (/** @type {number} */ x) => pdfNormal(x, mu1, se);
    const nullData = generateCurveData(nullPdf, domain, 300);
    const altData  = generateCurveData(altPdf, domain, 300);

    // Clear and create chart
    chartContainer.innerHTML = '';
    const frame = createChart(chartContainer, {
      titleText: 'Power & Error Visualizer',
      descText: `Null distribution N(${mu0}, ${se.toFixed(3)}²) and alternative distribution N(${mu1}, ${se.toFixed(3)}²)`,
      id: 'power-chart',
    });

    // Scales
    const yMax = Math.max(
      d3Array.max(nullData, d => d.y) || 0,
      d3Array.max(altData, d => d.y) || 0,
    );
    const xScale = d3Scale.scaleLinear().domain(domain).range([0, frame.width]);
    const yScale = d3Scale.scaleLinear().domain([0, yMax * 1.1]).range([frame.height, 0]);

    // Axes
    const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
    const yAxis = d3Axis.axisLeft(yScale).ticks(5).tickFormat(formatTick);
    addAxes(frame, xAxis, yAxis, 'x\u0304 (sample mean)', 'Density');

    const overlays = d3Selection.select(frame.inner).select('.overlays');
    const dataGroup = d3Selection.select(frame.inner).select('.data');
    const annotations = d3Selection.select(frame.inner).select('.annotations');

    // Area generators
    const areaGen = d3Shape.area()
      .x(d => xScale(d.x))
      .y0(yScale(0))
      .y1(d => yScale(d.y))
      .curve(d3Shape.curveNatural);

    const lineGen = d3Shape.line()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
      .curve(d3Shape.curveNatural);

    // ── Shaded regions ──────────────────────────────────────────
    // Type I error: area under null curve in the rejection region
    if (tail === 'right') {
      const alphaData = nullData.filter(d => d.x >= critHigh);
      if (alphaData.length > 0) {
        overlays.append('path').datum(alphaData)
          .attr('d', areaGen).attr('fill', ALPHA_FILL).attr('stroke', 'none');
      }
      // Beta: area under alt curve in the non-rejection region
      const betaData = altData.filter(d => d.x <= critHigh);
      if (betaData.length > 0) {
        overlays.append('path').datum(betaData)
          .attr('d', areaGen).attr('fill', BETA_FILL).attr('stroke', 'none');
      }
      // Power: area under alt curve in the rejection region
      const powerData = altData.filter(d => d.x >= critHigh);
      if (powerData.length > 0) {
        overlays.append('path').datum(powerData)
          .attr('d', areaGen).attr('fill', POWER_FILL).attr('stroke', 'none');
      }
    } else if (tail === 'left') {
      const alphaData = nullData.filter(d => d.x <= critLow);
      if (alphaData.length > 0) {
        overlays.append('path').datum(alphaData)
          .attr('d', areaGen).attr('fill', ALPHA_FILL).attr('stroke', 'none');
      }
      const betaData = altData.filter(d => d.x >= critLow);
      if (betaData.length > 0) {
        overlays.append('path').datum(betaData)
          .attr('d', areaGen).attr('fill', BETA_FILL).attr('stroke', 'none');
      }
      const powerData = altData.filter(d => d.x <= critLow);
      if (powerData.length > 0) {
        overlays.append('path').datum(powerData)
          .attr('d', areaGen).attr('fill', POWER_FILL).attr('stroke', 'none');
      }
    } else {
      // Two-tailed: alpha in both tails of null
      const alphaLeft = nullData.filter(d => d.x <= critLow);
      const alphaRight = nullData.filter(d => d.x >= critHigh);
      for (const data of [alphaLeft, alphaRight]) {
        if (data.length > 0) {
          overlays.append('path').datum(data)
            .attr('d', areaGen).attr('fill', ALPHA_FILL).attr('stroke', 'none');
        }
      }
      // Beta: area under alt curve in non-rejection region (between critLow and critHigh)
      const betaData = altData.filter(d => d.x >= critLow && d.x <= critHigh);
      if (betaData.length > 0) {
        overlays.append('path').datum(betaData)
          .attr('d', areaGen).attr('fill', BETA_FILL).attr('stroke', 'none');
      }
      // Power: area under alt curve in both rejection regions
      const powerLeft = altData.filter(d => d.x <= critLow);
      const powerRight = altData.filter(d => d.x >= critHigh);
      for (const data of [powerLeft, powerRight]) {
        if (data.length > 0) {
          overlays.append('path').datum(data)
            .attr('d', areaGen).attr('fill', POWER_FILL).attr('stroke', 'none');
        }
      }
    }

    // ── Curves ──────────────────────────────────────────────────
    // Null distribution curve
    dataGroup.append('path')
      .datum(nullData)
      .attr('d', lineGen)
      .attr('fill', 'none')
      .attr('stroke', NULL_STROKE)
      .attr('stroke-width', 2.5);

    // Alternative distribution curve
    dataGroup.append('path')
      .datum(altData)
      .attr('d', lineGen)
      .attr('fill', 'none')
      .attr('stroke', ALT_STROKE)
      .attr('stroke-width', 2.5);

    // ── Critical value line(s) ──────────────────────────────────
    const critValues = [];
    if (isFinite(critLow) && (tail === 'left' || tail === 'both')) critValues.push(critLow);
    if (isFinite(critHigh) && (tail === 'right' || tail === 'both')) critValues.push(critHigh);

    for (const cv of critValues) {
      const cx = xScale(cv);
      annotations.append('line')
        .attr('x1', cx).attr('y1', 0)
        .attr('x2', cx).attr('y2', frame.height)
        .attr('stroke', CRIT_STROKE)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '6,3');

      // Label on x-axis
      annotations.append('text')
        .attr('x', cx)
        .attr('y', frame.height + 20)
        .attr('text-anchor', 'middle')
        .attr('fill', CRIT_STROKE)
        .attr('font-size', '11px')
        .attr('font-weight', '600')
        .text(cv.toFixed(3));
    }

    // ── Distribution labels ─────────────────────────────────────
    // Label at the peak of each curve
    const nullPeakY = yScale(nullPdf(mu0));
    const altPeakY  = yScale(altPdf(mu1));

    annotations.append('text')
      .attr('x', xScale(mu0))
      .attr('y', nullPeakY - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', NULL_STROKE)
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .text('H\u2080');

    annotations.append('text')
      .attr('x', xScale(mu1))
      .attr('y', altPeakY - 10)
      .attr('text-anchor', 'middle')
      .attr('fill', ALT_STROKE)
      .attr('font-size', '12px')
      .attr('font-weight', '700')
      .text('H\u2081');

    // ── Region labels ───────────────────────────────────────────
    // Power label inside the power region (if big enough)
    if (power > 0.03) {
      const powerLabelX = _regionCenter(tail, 'power', critLow, critHigh, mu1, se, xScale);
      if (powerLabelX != null) {
        _addRegionLabel(annotations, `Power = ${(power * 100).toFixed(1)}%`,
          powerLabelX, frame.height * 0.65, '#2e7d32');
      }
    }

    // Beta label inside the beta region (if big enough)
    if (beta > 0.03) {
      const betaLabelX = _regionCenter(tail, 'beta', critLow, critHigh, mu1, se, xScale);
      if (betaLabelX != null) {
        _addRegionLabel(annotations, `\u03B2 = ${(beta * 100).toFixed(1)}%`,
          betaLabelX, frame.height * 0.45, '#283593');
      }
    }

    // ── Update results panel ────────────────────────────────────
    resultPower.textContent = power.toFixed(4);
    resultBeta.textContent  = beta.toFixed(4);
    resultAlpha.textContent = p.alpha.toFixed(4);

    // Show the critical value(s) used
    if (tail === 'both') {
      resultCrit.textContent = `${critLow.toFixed(4)}, ${critHigh.toFixed(4)}`;
      resultCrit.style.fontSize = '1rem'; // smaller for two values
    } else {
      const cv = tail === 'right' ? critHigh : critLow;
      resultCrit.textContent = cv.toFixed(4);
      resultCrit.style.fontSize = '';
    }

    // Screen reader announcement
    announceDiv.textContent =
      `Power is ${(power * 100).toFixed(1)}%, ` +
      `Type II error is ${(beta * 100).toFixed(1)}%, ` +
      `significance level is ${(p.alpha * 100).toFixed(1)}%`;
  }

  /**
   * Find horizontal center of a labeled region in pixels.
   * @param {'left'|'right'|'both'} tail
   * @param {'power'|'beta'} region
   * @param {number} critLow
   * @param {number} critHigh
   * @param {number} mu1
   * @param {number} se
   * @param {*} xScale
   * @returns {number|null}
   */
  function _regionCenter(tail, region, critLow, critHigh, mu1, se, xScale) {
    const domLo = xScale.domain()[0];
    const domHi = xScale.domain()[1];
    let lo, hi;

    if (tail === 'right') {
      if (region === 'power') { lo = critHigh; hi = domHi; }
      else { lo = domLo; hi = critHigh; }
    } else if (tail === 'left') {
      if (region === 'power') { lo = domLo; hi = critLow; }
      else { lo = critLow; hi = domHi; }
    } else {
      if (region === 'power') {
        // Use the tail where most of the power is (closer to mu1)
        if (mu1 >= 0) { lo = critHigh; hi = domHi; }
        else { lo = domLo; hi = critLow; }
      } else {
        lo = critLow; hi = critHigh;
      }
    }

    const midData = (lo + hi) / 2;
    const px = xScale(midData);
    if (px < 30 || px > xScale.range()[1] - 30) return null;
    return px;
  }

  /**
   * Add a small text label inside a shaded region.
   * @param {*} group
   * @param {string} text
   * @param {number} x
   * @param {number} y
   * @param {string} color
   */
  function _addRegionLabel(group, text, x, y, color) {
    // Semi-transparent white background for readability
    const tw = text.length * 7 + 10;
    group.append('rect')
      .attr('x', x - tw / 2).attr('y', y - 10)
      .attr('width', tw).attr('height', 18)
      .attr('rx', 3)
      .attr('fill', 'rgba(255,255,255,0.85)')
      .attr('stroke', 'none');
    group.append('text')
      .attr('x', x).attr('y', y + 2)
      .attr('text-anchor', 'middle')
      .attr('fill', color)
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .text(text);
  }

  // ── Slider ↔ Number input sync ──────────────────────────────────
  function syncPair(slider, input, isInt = false) {
    slider.addEventListener('input', () => {
      input.value = slider.value;
      debouncedRender();
    });
    input.addEventListener('input', () => {
      let v = parseFloat(input.value);
      if (!isFinite(v)) return;
      if (isInt) v = Math.round(v);
      const lo = parseFloat(slider.min);
      const hi = parseFloat(slider.max);
      slider.value = String(Math.min(hi, Math.max(lo, v)));
      debouncedRender();
    });
  }

  syncPair(sliderAlpha, inputAlpha);
  syncPair(sliderN, inputN, true);
  syncPair(sliderDelta, inputDelta);
  syncPair(sliderSigma, inputSigma);

  // ── Alpha presets ───────────────────────────────────────────────
  for (const btn of presetBtns) {
    btn.addEventListener('click', () => {
      const val = btn.dataset.alpha;
      inputAlpha.value = sliderAlpha.value = val;
      // Update active state
      for (const b of presetBtns) b.classList.remove('active');
      btn.classList.add('active');
      render();
    });
  }

  // Update active preset button on manual alpha change
  function updatePresetHighlight() {
    const v = parseFloat(inputAlpha.value);
    for (const b of presetBtns) {
      b.classList.toggle('active', Math.abs(parseFloat(b.dataset.alpha) - v) < 0.0005);
    }
  }
  inputAlpha.addEventListener('input', updatePresetHighlight);
  sliderAlpha.addEventListener('input', updatePresetHighlight);

  // ── Tail direction ──────────────────────────────────────────────
  for (const r of tailRadios) {
    r.addEventListener('change', render);
  }

  // ── Keyboard shortcuts ──────────────────────────────────────────
  const helpDialog = /** @type {HTMLDialogElement} */ (document.getElementById('page-help'));
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '?' && helpDialog) helpDialog.showModal();
  });
  if (helpDialog) {
    const closeBtn = helpDialog.querySelector('button');
    if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpDialog.open) helpDialog.close();
    });
  }

  // ── Render ──────────────────────────────────────────────────────
  const debouncedRender = debounce(render, 30);
  render();
}
