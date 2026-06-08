// @ts-check
/**
 * Distribution curve chart module for StatLens.
 * Used by distribution calculator pages (normal, t, chi-square, F).
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import * as d3Shape from 'd3-shape';
import { createChart, addAxes, formatTick, pillDimensions } from './chart-utils.js';

/** IMS blue for curve stroke. */
const CURVE_STROKE = '#569BBD';

/** Shaded area fill (IMS blue at 50% opacity). */
const SHADE_FILL = '#569BBD80';

/** Light gray fill for the complement (non-shaded) area under the curve. */
const COMPLEMENT_FILL = '#ededed';

/** Purple for observed test statistic annotations. */
const STAT_COLOR = '#7B2D8E';

/** Number of evaluation points for the curve. */
const N_POINTS = 200;

/**
 * Compute the display domain for a distribution.
 *
 * @param {'normal'|'t'|'chisq'|'F'} type
 * @param {object} params
 * @param {number} [params.mu] - Mean (normal)
 * @param {number} [params.sigma] - SD (normal)
 * @param {number} [params.df] - Degrees of freedom (t, chi-sq)
 * @param {number} [params.df1] - Numerator df (F)
 * @param {number} [params.df2] - Denominator df (F)
 * @param {(p: number) => number} [params.invCdf] - Inverse CDF for chi-sq/F upper bound
 * @returns {[number, number]}
 */
export function computeDomain(type, params = {}) {
  switch (type) {
    case 'normal': {
      const mu = params.mu ?? 0;
      const sigma = params.sigma ?? 1;
      return [mu - 4 * sigma, mu + 4 * sigma];
    }
    case 't': {
      const df = params.df ?? 1;
      // Adaptive: wider for small df, narrower for large df
      let halfWidth;
      if (df <= 3) halfWidth = 6;
      else if (df >= 30) halfWidth = 4;
      else halfWidth = 6 - (2 * (df - 3)) / (30 - 3);  // linear interpolation
      return [-halfWidth, halfWidth];
    }
    case 'chisq': {
      if (!params.invCdf) throw new Error('invCdf required for chisq domain');
      const upper = params.invCdf(0.999);
      return [0, upper];
    }
    case 'F': {
      if (!params.invCdf) throw new Error('invCdf required for F domain');
      const upper = params.invCdf(0.999);
      return [0, upper];
    }
    default:
      return [0, 1];
  }
}

/**
 * Generate curve data points from a PDF function over a domain.
 *
 * @param {(x: number) => number} pdfFn - PDF function
 * @param {[number, number]} domain - [xMin, xMax]
 * @param {number} [nPoints=200] - Number of evaluation points
 * @returns {Array<{x: number, y: number}>}
 */
export function generateCurveData(pdfFn, domain, nPoints = N_POINTS) {
  const [xMin, xMax] = domain;
  const step = (xMax - xMin) / nPoints;
  const data = [];
  for (let i = 0; i <= nPoints; i++) {
    const x = xMin + i * step;
    const y = pdfFn(x);
    data.push({ x, y: isFinite(y) ? y : 0 });
  }
  return data;
}

/**
 * Draw a distribution curve with optional shading.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {(x: number) => number} pdfFn - PDF function
 * @param {[number, number]} domain - [xMin, xMax]
 * @param {object} [options]
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.yLabel] - Y-axis label (default: "Density")
 * @param {string} [options.titleText]
 * @param {string} [options.descText]
 * @param {string} [options.id]
 * @param {'left'|'right'|'both'|'middle'} [options.tail] - Shading direction
 * @param {number} [options.critValue] - Critical value for left/right tail shading
 * @param {number} [options.critLow] - Lower bound for both/middle shading
 * @param {number} [options.critHigh] - Upper bound for both/middle shading
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {boolean} [options.showExport] - Show export buttons (default: true)
 * @param {string} [options.filename] - PNG download filename
 * @returns {{ frame: ChartFrame, curveData: Array<{x: number, y: number}>, xScale: import('d3-scale').ScaleLinear<number,number>, yScale: import('d3-scale').ScaleLinear<number,number>, update: (opts: object) => void }}
 */
export function drawCurve(container, pdfFn, domain, options = {}) {
  const {
    xLabel,
    yLabel = 'Density',
    titleText = 'Distribution',
    descText = '',
    id,
    tail,
    critValue,
    critLow,
    critHigh,
    margin,
    showExport,
    filename,
  } = options;

  const frame = createChart(container, { titleText, descText, id, margin, showExport, filename });
  const curveData = generateCurveData(pdfFn, domain);

  const xScale = d3Scale.scaleLinear()
    .domain(domain)
    .range([0, frame.width]);

  const yMax = d3Array.max(curveData, d => d.y) || 1;
  const yScale = d3Scale.scaleLinear()
    .domain([0, yMax * 1.05])
    .range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
  const yAxis = d3Axis.axisLeft(yScale).ticks(5).tickFormat(formatTick);
  addAxes(frame, xAxis, yAxis, xLabel, yLabel);

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  const overlays = d3Selection.select(frame.inner).select('.overlays');

  // Draw full complement fill (light gray under entire curve, behind everything)
  const fullAreaGen = d3Shape.area()
    .x(d => xScale(d.x))
    .y0(yScale(0))
    .y1(d => yScale(d.y))
    .curve(d3Shape.curveNatural);

  overlays.append('path')
    .datum(curveData)
    .attr('class', 'complement-area')
    .attr('d', fullAreaGen)
    .attr('fill', COMPLEMENT_FILL)
    .attr('stroke', 'none');

  // Draw shading on top (blue tail areas over the gray)
  renderShading(overlays, curveData, xScale, yScale, { tail, critValue, critLow, critHigh });

  // Draw curve
  const lineGen = d3Shape.line()
    .x(d => xScale(d.x))
    .y(d => yScale(d.y))
    .curve(d3Shape.curveNatural);

  dataGroup.append('path')
    .datum(curveData)
    .attr('class', 'curve')
    .attr('d', lineGen)
    .attr('fill', 'none')
    .attr('stroke', CURVE_STROKE)
    .attr('stroke-width', 2);

  return {
    frame,
    curveData,
    xScale,
    yScale,
    update: (opts) => {
      updateShading(overlays, curveData, xScale, yScale, {
        tail: opts.tail ?? tail,
        critValue: opts.critValue ?? critValue,
        critLow: opts.critLow ?? critLow,
        critHigh: opts.critHigh ?? critHigh,
      });
    },
  };
}

/**
 * Render shaded regions on the curve.
 * @param {d3Selection.Selection} overlays
 * @param {Array<{x: number, y: number}>} curveData
 * @param {d3Scale.ScaleLinear<number,number>} xScale
 * @param {d3Scale.ScaleLinear<number,number>} yScale
 * @param {object} opts
 * @param {'left'|'right'|'both'|'middle'} [opts.tail]
 * @param {number} [opts.critValue]
 * @param {number} [opts.critLow]
 * @param {number} [opts.critHigh]
 */
function renderShading(overlays, curveData, xScale, yScale, opts) {
  if (!opts.tail) return;

  const areaGen = d3Shape.area()
    .x(d => xScale(d.x))
    .y0(yScale(0))
    .y1(d => yScale(d.y))
    .curve(d3Shape.curveNatural);

  if (opts.tail === 'left' && opts.critValue != null) {
    const data = curveData.filter(d => d.x <= opts.critValue);
    if (data.length > 0) {
      overlays.append('path')
        .datum(data)
        .attr('class', 'shaded-area')
        .attr('d', areaGen)
        .attr('fill', SHADE_FILL)
        .attr('stroke', 'none');
    }
  } else if (opts.tail === 'right' && opts.critValue != null) {
    const data = curveData.filter(d => d.x >= opts.critValue);
    if (data.length > 0) {
      overlays.append('path')
        .datum(data)
        .attr('class', 'shaded-area')
        .attr('d', areaGen)
        .attr('fill', SHADE_FILL)
        .attr('stroke', 'none');
    }
  } else if (opts.tail === 'both' && opts.critLow != null && opts.critHigh != null) {
    const leftData = curveData.filter(d => d.x <= opts.critLow);
    const rightData = curveData.filter(d => d.x >= opts.critHigh);
    for (const data of [leftData, rightData]) {
      if (data.length > 0) {
        overlays.append('path')
          .datum(data)
          .attr('class', 'shaded-area')
          .attr('d', areaGen)
          .attr('fill', SHADE_FILL)
          .attr('stroke', 'none');
      }
    }
  } else if (opts.tail === 'middle' && opts.critLow != null && opts.critHigh != null) {
    const data = curveData.filter(d => d.x >= opts.critLow && d.x <= opts.critHigh);
    if (data.length > 0) {
      overlays.append('path')
        .datum(data)
        .attr('class', 'shaded-area')
        .attr('d', areaGen)
        .attr('fill', SHADE_FILL)
        .attr('stroke', 'none');
    }
  }
}

/**
 * Update shading by reusing existing path elements when possible.
 * Falls back to full remove/recreate if the number of paths changes.
 * @param {d3Selection.Selection} overlays
 * @param {Array<{x: number, y: number}>} curveData
 * @param {d3Scale.ScaleLinear<number,number>} xScale
 * @param {d3Scale.ScaleLinear<number,number>} yScale
 * @param {object} opts
 */
function updateShading(overlays, curveData, xScale, yScale, opts) {
  if (!opts.tail) {
    overlays.selectAll('.shaded-area').remove();
    return;
  }

  const areaGen = d3Shape.area()
    .x(d => xScale(d.x))
    .y0(yScale(0))
    .y1(d => yScale(d.y))
    .curve(d3Shape.curveNatural);

  // Compute the path data arrays we need
  /** @type {Array<{x: number, y: number}>[]} */
  const pathDataSets = [];

  if (opts.tail === 'left' && opts.critValue != null) {
    pathDataSets.push(curveData.filter(d => d.x <= opts.critValue));
  } else if (opts.tail === 'right' && opts.critValue != null) {
    pathDataSets.push(curveData.filter(d => d.x >= opts.critValue));
  } else if (opts.tail === 'both' && opts.critLow != null && opts.critHigh != null) {
    pathDataSets.push(curveData.filter(d => d.x <= opts.critLow));
    pathDataSets.push(curveData.filter(d => d.x >= opts.critHigh));
  } else if (opts.tail === 'middle' && opts.critLow != null && opts.critHigh != null) {
    pathDataSets.push(curveData.filter(d => d.x >= opts.critLow && d.x <= opts.critHigh));
  }

  const existing = overlays.selectAll('.shaded-area');

  // If count matches, update in-place (fast path for dragging)
  if (existing.size() === pathDataSets.length && pathDataSets.length > 0) {
    existing.each(function(_, i) {
      d3Selection.select(this)
        .datum(pathDataSets[i])
        .attr('d', areaGen);
    });
  } else {
    // Count mismatch: full rebuild
    existing.remove();
    for (const data of pathDataSets) {
      if (data.length > 0) {
        overlays.append('path')
          .datum(data)
          .attr('class', 'shaded-area')
          .attr('d', areaGen)
          .attr('fill', SHADE_FILL)
          .attr('stroke', 'none');
      }
    }
  }
}

/**
 * Add inference annotations to a distribution curve chart:
 * a dashed vertical line at the test statistic, a stat-value label,
 * and a p-value pill in the shaded tail region.
 *
 * Shared across all inference pages (one-mean, two-means, paired,
 * one-prop, two-props, chi-square, slope, ANOVA) to ensure
 * consistent visual output matching distribution calculator pages.
 *
 * @param {object} chart - Return value from drawCurve()
 * @param {ChartFrame} chart.frame
 * @param {import('d3-scale').ScaleLinear<number,number>} chart.xScale
 * @param {import('d3-scale').ScaleLinear<number,number>} chart.yScale
 * @param {object} opts
 * @param {number} opts.statValue - Test statistic value (t, z, F, χ²)
 * @param {string} opts.statLabel - Label prefix (e.g., "t", "F", "χ²", "z")
 * @param {number} opts.pValue - P-value
 * @param {(x: number) => number} opts.pdfFn - PDF function for computing curve height
 * @param {'left'|'right'|'both'} opts.tail - Tail direction
 * @param {number} [opts.statValueNeg] - Negative stat value for two-tailed (plotted on left)
 * @param {number} [opts.decimals=3] - Decimal places for stat label
 */
export function addInferenceAnnotations(chart, opts) {
  const { frame, xScale, yScale } = chart;
  const { statValue, statLabel, pValue, pdfFn, tail, statValueNeg, decimals = 3 } = opts;
  const w = frame.width;
  const h = frame.height;

  const annotations = d3Selection.select(frame.inner).select('.annotations');
  annotations.selectAll('.inf-annotation').remove();

  const domain = xScale.domain();

  // ── Solid line(s) at the test statistic ──
  // Matches simulation page observed-stat styling: solid purple, full height,
  // "observed" label + stat value above the line.
  // Visual continuity: students recognize "this is my observed statistic on a
  // distribution" — same concept as the simulation pages, now theoretical.
  const statPoints = tail === 'both' && statValueNeg != null
    ? [statValueNeg, statValue]
    : [statValue];

  for (const sv of statPoints) {
    // Clamp to domain edge so extreme stats still show a line at chart boundary
    const svClamped = Math.max(domain[0], Math.min(domain[1], sv));
    const sx = xScale(svClamped);

    // Solid vertical line — full chart height (matches simulation pages)
    annotations.append('line')
      .attr('class', 'inf-annotation inf-stat-line')
      .attr('x1', sx)
      .attr('x2', sx)
      .attr('y1', 0)
      .attr('y2', h)
      .attr('stroke', STAT_COLOR)
      .attr('stroke-width', 2.5);

    // "observed" label above the line (matches simulation pages)
    annotations.append('text')
      .attr('class', 'inf-annotation')
      .attr('x', sx).attr('y', -16)
      .attr('text-anchor', 'middle')
      .attr('fill', STAT_COLOR)
      .classed('overlay-label', true)
      .text('observed');

    // Stat value below "observed" (e.g., "F = 3.48")
    const valueText = `${statLabel} = ${sv.toFixed(decimals)}`;
    annotations.append('text')
      .attr('class', 'inf-annotation inf-stat-label overlay-label')
      .attr('x', sx).attr('y', -4)
      .attr('text-anchor', 'middle')
      .attr('fill', STAT_COLOR)
      .text(valueText);
  }

  // ── P-value pill in the shaded tail region ──
  let pText;
  if (pValue === 0) pText = 'p \u2248 0';
  else if (pValue < 0.0001) pText = 'p < 0.0001';
  else pText = `p = ${pValue.toFixed(4)}`;

  const compText = (1 - pValue).toFixed(4);
  const pillY = h * 0.6;

  if (tail === 'both') {
    // Two-tailed: p-value pill centered, show half-p in each tail
    const labelX = Math.max(60, Math.min(w - 60, w / 2));
    _addPill(annotations, `${pText}  (two-tailed)`, labelX, pillY, false);
  } else {
    const isLeft = tail === 'left';
    const obsX = xScale(Math.max(domain[0], Math.min(domain[1], statValue)));

    // Tail pill: centered in tail region, clamped
    const tailMidX = isLeft ? obsX / 2 : (obsX + w) / 2;
    const clampedTailX = Math.max(50, Math.min(w - 50, tailMidX));
    _addPill(annotations, pText, clampedTailX, pillY, false);

    // Complement pill: centered in body region, clamped
    const bodyMidX = isLeft ? (obsX + w) / 2 : obsX / 2;
    const clampedBodyX = Math.max(50, Math.min(w - 50, bodyMidX));
    _addPill(annotations, compText, clampedBodyX, pillY, true);

    // Leader lines — use pdfFn to find curve height at region midpoint
    const tailDataMid = isLeft ? (domain[0] + statValue) / 2 : (statValue + domain[1]) / 2;
    const bodyDataMid = isLeft ? (statValue + domain[1]) / 2 : (domain[0] + statValue) / 2;
    const pillBottom = pillY + 14;

    for (const [cx, targetMidPx, dataMid, color] of [
      [clampedTailX, Math.max(4, Math.min(w - 4, tailMidX)), tailDataMid, CURVE_STROKE],
      [clampedBodyX, Math.max(4, Math.min(w - 4, bodyMidX)), bodyDataMid, '#888'],
    ]) {
      // Smart Y: halfway between curve at midpoint and baseline, or halfway between pill and baseline
      const curveY = pdfFn ? yScale(pdfFn(dataMid)) : h * 0.5;
      const endY = Math.max((curveY + h) / 2, (pillBottom + h) / 2);
      annotations.append('line')
        .attr('class', 'inf-annotation')
        .attr('x1', cx).attr('y1', pillBottom)
        .attr('x2', targetMidPx).attr('y2', endY)
        .attr('stroke', color)
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '3,2')
        .style('pointer-events', 'none');
    }
  }
}

/**
 * Render a single pill (rounded rect + text) for inference annotations.
 * Matches the styling of renderSimPills in chart-utils.js.
 * @param {d3Selection.Selection} group
 * @param {string} text
 * @param {number} cx - Center x
 * @param {number} cy - Center y
 * @param {boolean} isComplement
 */
function _addPill(group, text, cx, cy, isComplement) {
  const g = group.append('g').attr('class', 'inf-annotation');
  const { charW, pad, pillH } = pillDimensions('prob');
  const textWidth = text.length * charW + pad;
  g.append('rect')
    .attr('x', cx - textWidth / 2)
    .attr('y', cy - pillH / 2)
    .attr('width', textWidth)
    .attr('height', pillH)
    .attr('rx', 4)
    .attr('fill', isComplement ? '#ffffff' : '#e8f4f8')
    .attr('stroke', isComplement ? '#888' : CURVE_STROKE)
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');
  g.append('text')
    .attr('class', isComplement ? 'prob-label prob-complement' : 'prob-label')
    .attr('x', cx)
    .attr('y', cy)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', isComplement ? '#6B6B6B' : '#2e7d32')
    .style('pointer-events', 'none')
    .text(text);
}
