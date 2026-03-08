// @ts-check
/**
 * Distribution curve chart module for SimKit.
 * Used by distribution calculator pages (normal, t, chi-square, F).
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import * as d3Shape from 'd3-shape';
import { createChart, addAxes, formatTick } from './chart-utils.js';

/** IMS blue for curve stroke. */
const CURVE_STROKE = '#569BBD';

/** Shaded area fill (IMS blue at 50% opacity). */
const SHADE_FILL = '#569BBD80';

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
  } = options;

  const frame = createChart(container, { titleText, descText, id, margin });
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

  // Draw shading first (behind curve)
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
