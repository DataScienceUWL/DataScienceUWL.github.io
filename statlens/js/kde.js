// @ts-check
/**
 * Kernel Density Estimation (KDE) for StatLens.
 * Gaussian kernel with Silverman's rule-of-thumb bandwidth.
 *
 * Used for density overlays on histograms and grouped density plots.
 */

import * as d3Scale from 'd3-scale';
import * as d3Axis from 'd3-axis';
import { createChart, addAxes, getColors } from './chart-utils.js';

/**
 * Dash patterns for distinguishing grouped density curves without color alone.
 * Solid, dashed, dotted, dash-dot, long-dash, etc.
 * @type {readonly string[]}
 */
const DASH_PATTERNS = ['', '8,4', '2,3', '8,3,2,3', '12,4', '4,4', '2,2', '6,2,2,2,2,2'];

/**
 * Silverman's rule-of-thumb bandwidth.
 * h = 0.9 * min(sd, IQR/1.34) * n^(-1/5)
 *
 * @param {number[]} values - Sorted or unsorted numeric data
 * @returns {number}
 */
export function silvermanBandwidth(values) {
  const n = values.length;
  if (n < 2) return 1;

  const sorted = [...values].sort((a, b) => a - b);
  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const sd = Math.sqrt(variance);

  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  const spread = Math.min(sd, iqr / 1.34);
  // Fallback if spread is 0 (constant data)
  if (spread === 0) return sd > 0 ? sd : 1;
  return 0.9 * spread * n ** (-0.2);
}

/**
 * Gaussian kernel function.
 * @param {number} u
 * @returns {number}
 */
function gaussian(u) {
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

/**
 * Compute KDE density estimates at evenly spaced points.
 *
 * @param {number[]} values - Source data
 * @param {object} [opts]
 * @param {number} [opts.bandwidth] - Kernel bandwidth (default: Silverman's rule)
 * @param {number} [opts.nPoints] - Number of evaluation points (default: 200)
 * @param {[number, number]} [opts.domain] - [min, max] evaluation range (default: data range ± 3h)
 * @returns {{ x: number[], y: number[] }} Arrays of x coordinates and density values
 */
export function kde(values, opts = {}) {
  const n = values.length;
  if (n === 0) return { x: [], y: [] };

  const h = opts.bandwidth ?? silvermanBandwidth(values);
  const nPoints = opts.nPoints ?? 200;

  const lo = opts.domain?.[0] ?? (Math.min(...values) - 3 * h);
  const hi = opts.domain?.[1] ?? (Math.max(...values) + 3 * h);
  const step = (hi - lo) / (nPoints - 1);

  const x = [];
  const y = [];

  for (let i = 0; i < nPoints; i++) {
    const xi = lo + i * step;
    let sum = 0;
    for (let j = 0; j < n; j++) {
      sum += gaussian((xi - values[j]) / h);
    }
    x.push(xi);
    y.push(sum / (n * h));
  }

  return { x, y };
}

/**
 * Draw a density curve path on an existing chart's inner <g>.
 *
 * @param {SVGGElement} innerNode - The chart's inner <g> element
 * @param {number[]} xData - x coordinates
 * @param {number[]} yData - density values
 * @param {any} xScale - d3 scale
 * @param {any} yScale - d3 scale
 * @param {object} [opts]
 * @param {string} [opts.stroke] - Stroke color (default: '#569BBD')
 * @param {number} [opts.strokeWidth] - Stroke width (default: 2)
 * @param {string} [opts.dashArray] - SVG stroke-dasharray (default: '' = solid)
 * @param {string} [opts.className] - CSS class (default: 'density-curve')
 * @returns {SVGPathElement}
 */
export function drawDensityCurve(innerNode, xData, yData, xScale, yScale, opts = {}) {
  const stroke = opts.stroke ?? '#569BBD';
  const strokeWidth = opts.strokeWidth ?? 2;
  const dashArray = opts.dashArray ?? '';
  const className = opts.className ?? 'density-curve';

  let d = '';
  for (let i = 0; i < xData.length; i++) {
    const px = xScale(xData[i]);
    const py = yScale(yData[i]);
    d += i === 0 ? `M${px},${py}` : `L${px},${py}`;
  }

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', stroke);
  path.setAttribute('stroke-width', String(strokeWidth));
  if (dashArray) path.setAttribute('stroke-dasharray', dashArray);
  path.setAttribute('class', className);
  path.setAttribute('aria-hidden', 'true');
  innerNode.appendChild(path);

  return path;
}

/**
 * Remove all density curves from a chart container.
 * @param {HTMLElement} container
 */
export function removeDensityCurves(container) {
  container.querySelectorAll('.density-curve').forEach(el => el.remove());
}

/**
 * Overlay a KDE density curve on an existing histogram.
 * Scales the density to match the histogram's y-axis (frequency = density * n * binWidth).
 *
 * @param {SVGGElement} innerNode
 * @param {number[]} values - Source data
 * @param {any} xScale - Histogram's x scale
 * @param {any} yScale - Histogram's y scale (frequency)
 * @param {number} binWidth - Histogram bin width
 * @param {object} [opts]
 * @param {string} [opts.stroke]
 * @returns {SVGPathElement}
 */
export function overlayDensityOnHistogram(innerNode, values, xScale, yScale, binWidth, opts = {}) {
  const n = values.length;
  const domain = /** @type {[number, number]} */ (xScale.domain());
  const { x, y } = kde(values, { domain });

  // Scale density → frequency: f(x) = density(x) * n * binWidth
  const yFreq = y.map(d => d * n * binWidth);

  return drawDensityCurve(innerNode, x, yFreq, xScale, yScale, {
    stroke: opts.stroke ?? '#114B5F',
    strokeWidth: 2,
  });
}

/**
 * Draw overlaid density curves for multiple groups on a single chart.
 *
 * @param {HTMLElement} container
 * @param {Record<string, number[]>} groupedData - { groupName: values[] }
 * @param {object} opts
 * @param {string} opts.xLabel
 * @param {string} [opts.titleText]
 * @param {string} [opts.descText]
 * @param {string} [opts.id]
 * @param {string[]} [opts.colors] - Colors per group (default: Okabe-Ito)
 * @param {number} [opts.bandwidth] - Override bandwidth (applies to all groups)
 * @param {boolean} [opts.fill] - Fill area under single-group curves (default: true when 1 group)
 * @param {boolean} [opts.showExport] - Show export buttons (default: true)
 * @param {string} [opts.filename] - PNG download filename
 * @returns {{ frame: import('./types.js').ChartFrame, xScale: any }}
 */
export function drawGroupedDensity(container, groupedData, opts) {
  const groups = Object.keys(groupedData);
  const colors = opts.colors ?? getColors(groups.length);

  // Compute shared domain from all values
  const allValues = groups.flatMap(g => groupedData[g]);
  const lo = Math.min(...allValues);
  const hi = Math.max(...allValues);
  const pad = (hi - lo) * 0.05 || 0.5;
  /** @type {[number, number]} */
  const domain = [lo - pad, hi + pad];

  // Compute all density curves and find max density
  /** @type {Array<{name: string, x: number[], y: number[], color: string, n: number}>} */
  /** @type {Array<{name: string, x: number[], y: number[], color: string, n: number, dash: string}>} */
  const curves = [];
  let maxDensity = 0;

  for (let i = 0; i < groups.length; i++) {
    const name = groups[i];
    const values = groupedData[name];
    if (values.length < 2) continue;
    const kdeOpts = { domain };
    if (opts.bandwidth != null) kdeOpts.bandwidth = opts.bandwidth;
    const result = kde(values, kdeOpts);
    const yMax = Math.max(...result.y);
    if (yMax > maxDensity) maxDensity = yMax;
    curves.push({ name, x: result.x, y: result.y, color: colors[i % colors.length], n: values.length, dash: DASH_PATTERNS[i % DASH_PATTERNS.length] });
  }

  if (maxDensity === 0) maxDensity = 1;

  // Create chart frame
  const frame = createChart(container, {
    titleText: opts.titleText ?? 'Density Plot',
    descText: opts.descText ?? '',
    id: opts.id ?? 'density',
    showExport: opts.showExport,
    filename: opts.filename,
  });

  // Scales
  const xScale = d3Scale.scaleLinear().domain(domain).range([0, frame.width]);
  const yScale = d3Scale.scaleLinear().domain([0, maxDensity * 1.08]).range([frame.height, 0]);

  const xAxis = d3Axis.axisBottom(xScale);
  const yAxis = d3Axis.axisLeft(yScale).ticks(5);
  addAxes(frame, xAxis, yAxis, opts.xLabel, 'Density');

  // Draw curves (with optional fill for single-group density plots)
  const shouldFill = opts.fill ?? (curves.length === 1);
  for (const curve of curves) {
    if (shouldFill) {
      // Filled area under curve
      let areaD = `M${xScale(curve.x[0])},${yScale(0)}`;
      for (let i = 0; i < curve.x.length; i++) {
        areaD += `L${xScale(curve.x[i])},${yScale(curve.y[i])}`;
      }
      areaD += `L${xScale(curve.x[curve.x.length - 1])},${yScale(0)}Z`;
      const areaPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      areaPath.setAttribute('d', areaD);
      areaPath.setAttribute('fill', curve.color);
      areaPath.setAttribute('fill-opacity', '0.25');
      areaPath.setAttribute('stroke', 'none');
      areaPath.setAttribute('class', 'density-fill');
      areaPath.setAttribute('aria-hidden', 'true');
      frame.inner.appendChild(areaPath);
    }
    drawDensityCurve(frame.inner, curve.x, curve.y, xScale, yScale, {
      stroke: curve.color,
      strokeWidth: 2.5,
      dashArray: curve.dash,
    });
  }

  // Legend (top-right, inside the chart) — skip for single-group
  if (curves.length <= 1) return { frame, xScale };

  const legendG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  legendG.setAttribute('class', 'density-legend');
  const legendX = frame.width - 10;
  let legendY = 8;

  for (let i = 0; i < curves.length; i++) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('transform', `translate(${legendX}, ${legendY})`);

    const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    line.setAttribute('x1', '-30');
    line.setAttribute('x2', '-10');
    line.setAttribute('y1', '0');
    line.setAttribute('y2', '0');
    line.setAttribute('stroke', curves[i].color);
    line.setAttribute('stroke-width', '2.5');
    if (curves[i].dash) line.setAttribute('stroke-dasharray', curves[i].dash);
    g.appendChild(line);

    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    text.setAttribute('x', '-35');
    text.setAttribute('y', '4');
    text.setAttribute('text-anchor', 'end');
    text.setAttribute('fill', curves[i].color);
    text.setAttribute('class', 'legend-text');
    text.textContent = `${curves[i].name} (n=${curves[i].n})`;
    g.appendChild(text);

    legendG.appendChild(g);
    legendY += 18;
  }

  frame.inner.appendChild(legendG);

  return { frame, xScale };
}
