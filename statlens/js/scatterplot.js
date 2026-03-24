// @ts-check
/**
 * Scatterplot chart module for StatLens.
 * Used by explore/two-variable and simulation pages (bootstrap/randomization slope).
 *
 * @import { ChartFrame } from './types.js'
 */

import * as d3Array from 'd3-array';
import * as d3Scale from 'd3-scale';
import * as d3Selection from 'd3-selection';
import * as d3Axis from 'd3-axis';
import * as d3Shape from 'd3-shape';
import { createChart, addAxes, formatTick, attachTooltip } from './chart-utils.js';

/** IMS blue. */
const IMS_BLUE = '#569BBD';

/** IMS blue at 60% opacity for point fill. */
const POINT_FILL = '#569BBD99';

/** IMS red for highlighted point. */
const IMS_RED = '#F05133';

/** Regression line color — Okabe-Ito vermillion, visible against blue points. */
const REGRESSION_COLOR = '#D55E00';

/** Bootstrap line color (IMS blue at 8% opacity). */
const BOOTSTRAP_LINE_OPACITY = 0.08;

/**
 * Compute point radius based on sample size.
 * @param {number} n - Number of data points
 * @returns {number}
 */
export function pointRadius(n) {
  if (n <= 200) return 4;
  return Math.max(2, 4 - n / 200);
}

/**
 * Draw a scatterplot into a container element.
 *
 * @param {string|Element} container - CSS selector or DOM element
 * @param {number[]} xValues - X data
 * @param {number[]} yValues - Y data
 * @param {object} [options]
 * @param {string} [options.xLabel] - X-axis label
 * @param {string} [options.yLabel] - Y-axis label
 * @param {string} [options.titleText] - Chart title for accessibility
 * @param {string} [options.descText] - Chart description for accessibility
 * @param {string} [options.id] - Unique ID prefix
 * @param {{slope: number, intercept: number}} [options.regression] - Regression line to overlay
 * @param {Array<{slope: number, intercept: number}>} [options.bootstrapLines] - Bootstrap regression lines (draws first 100)
 * @param {Array<{x: number, y: number}>} [options.loessCurve] - LOESS smoothed curve points to overlay
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @param {boolean} [options.minimal] - If true, hide axis labels and tick labels (show only dots + regression line)
 * @param {number} [options.yTicks] - Number of y-axis ticks (default: auto)
 * @param {number} [options.xTicks] - Number of x-axis ticks (default: auto)
 * @param {boolean} [options.showExport] - Show export buttons (default: true)
 * @param {string} [options.filename] - PNG download filename
 * @returns {{ frame: ChartFrame, xScale: d3Scale.ScaleLinear<number,number>, yScale: d3Scale.ScaleLinear<number,number> }}
 */
export function drawScatterplot(container, xValues, yValues, options = {}) {
  const {
    xLabel,
    yLabel,
    titleText = 'Scatterplot',
    descText = '',
    id,
    regression,
    bootstrapLines,
    loessCurve,
    margin,
    minimal = false,
    yTicks,
    xTicks,
    showExport,
    filename,
  } = options;

  const n = Math.min(xValues.length, yValues.length);
  const frame = createChart(container, { titleText, descText, id, margin, showExport, filename });

  // Compute domains with 5% padding (guard against empty/NaN data)
  const xExtent = d3Array.extent(xValues.slice(0, n));
  const yExtent = d3Array.extent(yValues.slice(0, n));
  const xPad = isFinite(xExtent[1] - xExtent[0]) ? (xExtent[1] - xExtent[0]) * 0.05 || 0.5 : 0.5;
  const yPad = isFinite(yExtent[1] - yExtent[0]) ? (yExtent[1] - yExtent[0]) * 0.05 || 0.5 : 0.5;

  const xScale = d3Scale.scaleLinear()
    .domain([xExtent[0] - xPad, xExtent[1] + xPad])
    .range([0, frame.width]);

  const yScale = d3Scale.scaleLinear()
    .domain([yExtent[0] - yPad, yExtent[1] + yPad])
    .nice()
    .range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale).tickFormat(minimal ? () => '' : formatTick);
  const yAxis = d3Axis.axisLeft(yScale).tickFormat(minimal ? () => '' : formatTick);
  if (xTicks !== undefined) xAxis.ticks(xTicks);
  if (yTicks !== undefined) yAxis.ticks(yTicks);
  if (minimal) {
    xAxis.tickSize(0);
    yAxis.tickSize(0);
  }
  addAxes(frame, xAxis, yAxis, xLabel, yLabel);

  const overlays = d3Selection.select(frame.inner).select('.overlays');

  // Bootstrap regression lines (draw first, behind everything)
  if (bootstrapLines && bootstrapLines.length > 0) {
    const [xMin, xMax] = xScale.domain();
    const lines = bootstrapLines.slice(0, 100);
    for (const { slope, intercept } of lines) {
      overlays.append('line')
        .attr('class', 'bootstrap-line')
        .attr('x1', xScale(xMin))
        .attr('y1', yScale(intercept + slope * xMin))
        .attr('x2', xScale(xMax))
        .attr('y2', yScale(intercept + slope * xMax))
        .attr('stroke', IMS_BLUE)
        .attr('stroke-opacity', BOOTSTRAP_LINE_OPACITY)
        .attr('stroke-width', 1);
    }
  }

  // Regression line
  if (regression) {
    const [xMin, xMax] = xScale.domain();
    const { slope, intercept } = regression;
    overlays.append('line')
      .attr('class', 'regression-line')
      .attr('x1', xScale(xMin))
      .attr('y1', yScale(intercept + slope * xMin))
      .attr('x2', xScale(xMax))
      .attr('y2', yScale(intercept + slope * xMax))
      .attr('stroke', REGRESSION_COLOR)
      .attr('stroke-width', 2);
  }

  // LOESS curve
  if (loessCurve && loessCurve.length > 1) {
    const line = d3Shape.line()
      .x(d => xScale(d.x))
      .y(d => yScale(d.y))
      .curve(d3Shape.curveBasis);
    overlays.append('path')
      .attr('class', 'loess-curve')
      .attr('d', line(loessCurve))
      .attr('fill', 'none')
      .attr('stroke', '#009E73')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6,3')
      .attr('aria-label', 'LOESS smooth curve');
  }

  // Data points
  const r = pointRadius(n);
  const points = xValues.slice(0, n).map((x, i) => ({ x, y: yValues[i], i }));

  const dataGroup = d3Selection.select(frame.inner).select('.data');
  dataGroup.selectAll('circle')
    .data(points)
    .join('circle')
    .attr('cx', d => xScale(d.x))
    .attr('cy', d => yScale(d.y))
    .attr('r', r)
    .attr('fill', POINT_FILL)
    .attr('stroke', IMS_BLUE)
    .attr('stroke-width', 1)
    .attr('role', 'listitem')
    .attr('aria-label', d => `(${d.x}, ${d.y})`);

  attachTooltip(dataGroup.selectAll('circle'), frame.inner, (d) => ({
    lines: [`(${formatTick(d.x)}, ${formatTick(d.y)})`],
    x: xScale(d.x),
    y: yScale(d.y) - r,
  }));

  return { frame, xScale, yScale };
}

/**
 * Draw a residual plot into a container element.
 * X-axis = fitted values (y-hat), Y-axis = residuals (y - y-hat).
 *
 * @param {string|Element} container
 * @param {number[]} fitted - Fitted/predicted values
 * @param {number[]} residuals - Residual values
 * @param {object} [options]
 * @param {string} [options.xLabel] - X-axis label (default: "Fitted values")
 * @param {string} [options.yLabel] - Y-axis label (default: "Residuals")
 * @param {string} [options.titleText]
 * @param {string} [options.descText]
 * @param {string} [options.id]
 * @param {{top:number,right:number,bottom:number,left:number}} [options.margin]
 * @returns {{ frame: ChartFrame }}
 */
export function drawResidualPlot(container, fitted, residuals, options = {}) {
  const {
    xLabel = 'Fitted values',
    yLabel = 'Residuals',
    titleText = 'Residual plot',
    descText = '',
    id,
    margin,
  } = options;

  const result = drawScatterplot(container, fitted, residuals, {
    xLabel, yLabel, titleText, descText, id, margin,
  });

  // Override generic tooltips with residual-specific tooltips
  const dataGroup = d3Selection.select(result.frame.inner).select('.data');
  const circles = dataGroup.selectAll('circle');
  circles.attr('aria-label', d => `Fitted ${formatTick(d.x)}, Residual ${formatTick(d.y)}`);
  attachTooltip(circles, result.frame.inner, (d) => ({
    lines: [`Fitted: ${formatTick(d.x)}`, `Residual: ${formatTick(d.y)}`],
    x: result.xScale(d.x),
    y: result.yScale(d.y) - pointRadius(fitted.length),
  }));

  // Add horizontal reference line at y = 0
  const overlays = d3Selection.select(result.frame.inner).select('.overlays');
  overlays.append('line')
    .attr('class', 'zero-line')
    .attr('x1', 0)
    .attr('x2', result.frame.width)
    .attr('y1', result.yScale(0))
    .attr('y2', result.yScale(0))
    .attr('stroke', '#808080')
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '4,3');

  return { frame: result.frame };
}
