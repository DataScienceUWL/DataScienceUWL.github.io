// @ts-check
/**
 * Dotplot Editor — click to add/remove points, live summary stats.
 * An interactive Explore Lab for building intuition about descriptive statistics.
 */

import * as d3 from 'd3-selection';
import * as d3Scale from 'd3-scale';
import * as d3Array from 'd3-array';
import * as d3Axis from 'd3-axis';
import { mean, median, sd, iqr, quantile, formatStat } from '../../js/stats.js';
import { computeBoxplotStats } from '../../js/boxplot.js';
import { createChart } from '../../js/chart-utils.js';
import { initHelp, announce } from '../../js/page-utils.js';

// ─── Constants ───

const PRESETS = {
  symmetric: [3, 5, 6, 7, 8, 8, 9, 10, 11, 13],
  skewed:    [1, 2, 2, 3, 3, 3, 4, 4, 5, 12],
  bimodal:   [2, 3, 3, 4, 4, 12, 13, 13, 14, 14],
  uniform:   [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
  empty:     [],
};

const MEAN_COLOR = '#569BBD';
const MEDIAN_COLOR = '#D89A9E';
const DOT_FILL = '#555';
const DOT_STROKE = '#333';
const DOT_RADIUS = window.matchMedia('(max-width: 600px)').matches ? 11 : 7;
const MAX_HISTORY = 100;
const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 360;
const MARGIN = { top: 20, right: 20, bottom: 65, left: 20 };
const BOXPLOT_BAND = 45; // viewBox units reserved at top for boxplot

// ─── DOM refs ───

const chartArea = /** @type {HTMLElement} */ (document.getElementById('chart-area'));
const presetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('preset-select'));
const undoBtn = /** @type {HTMLButtonElement} */ (document.getElementById('undo-btn'));
const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear-btn'));
const boxplotCheck = /** @type {HTMLInputElement} */ (document.getElementById('boxplot-check'));
const freezeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('freeze-btn'));
const unfreezeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('unfreeze-btn'));

// Stat cells
const statEls = {
  n:      /** @type {HTMLElement} */ (document.getElementById('stat-n')),
  mean:   /** @type {HTMLElement} */ (document.getElementById('stat-mean')),
  median: /** @type {HTMLElement} */ (document.getElementById('stat-median')),
  sd:     /** @type {HTMLElement} */ (document.getElementById('stat-sd')),
  iqr:    /** @type {HTMLElement} */ (document.getElementById('stat-iqr')),
  range:  /** @type {HTMLElement} */ (document.getElementById('stat-range')),
  min:    /** @type {HTMLElement} */ (document.getElementById('stat-min')),
  q1:     /** @type {HTMLElement} */ (document.getElementById('stat-q1')),
  q3:     /** @type {HTMLElement} */ (document.getElementById('stat-q3')),
  max:    /** @type {HTMLElement} */ (document.getElementById('stat-max')),
};

/** Previous stat values for change detection. @type {Record<string, string>} */
let prevStats = {};

// ─── State ───

/** @type {number[]} */
let values = [];
/** @type {number[][]} */
let history = [];
let showBoxplot = false;
/** @type {import('../../js/boxplot.js').BoxplotStats|null} */
let frozenBoxplot = null;

// ─── Initialization ───

initHelp();

// Help dialog
const helpDialog = /** @type {HTMLDialogElement|null} */ (document.getElementById('page-help'));
const helpBtn = document.querySelector('.help-btn');
if (helpBtn && helpDialog) {
  helpBtn.addEventListener('click', () => helpDialog.showModal());
  helpDialog.querySelector('button')?.addEventListener('click', () => helpDialog.close());
}

// Preset selector
presetSelect.addEventListener('change', () => {
  loadPreset(presetSelect.value);
});

// Undo / Clear
undoBtn.addEventListener('click', undo);
clearBtn.addEventListener('click', clearAll);

// Boxplot toggle
boxplotCheck.addEventListener('change', () => {
  showBoxplot = boxplotCheck.checked;
  freezeBtn.disabled = !showBoxplot;
  if (!showBoxplot) {
    frozenBoxplot = null;
    unfreezeBtn.style.display = 'none';
    freezeBtn.style.display = '';
  }
  render();
});

freezeBtn.addEventListener('click', () => {
  if (values.length < 2) return;
  frozenBoxplot = computeBoxplotStats(values);
  freezeBtn.style.display = 'none';
  unfreezeBtn.style.display = '';
  render();
  announce('Boxplot frozen. Edit the data to compare.');
});

unfreezeBtn.addEventListener('click', () => {
  frozenBoxplot = null;
  unfreezeBtn.style.display = 'none';
  freezeBtn.style.display = '';
  render();
  announce('Boxplot unfrozen.');
});

// Keyboard: Ctrl+Z, ?
document.addEventListener('keydown', (e) => {
  if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
    e.preventDefault();
    undo();
  }
  if (e.key === '?' && !e.ctrlKey && !e.metaKey &&
      !(e.target instanceof HTMLInputElement) &&
      !(e.target instanceof HTMLSelectElement) &&
      !(e.target instanceof HTMLTextAreaElement)) {
    helpDialog?.showModal();
  }
});

// Load default preset
loadPreset('symmetric');

// ─── Core functions ───

function loadPreset(name) {
  const data = PRESETS[/** @type {keyof typeof PRESETS} */ (name)];
  if (!data) return;
  values = [...data];
  history = [];
  undoBtn.disabled = true;
  render();
}

function pushHistory() {
  history.push([...values]);
  if (history.length > MAX_HISTORY) history.shift();
  undoBtn.disabled = false;
}

function undo() {
  if (history.length === 0) return;
  values = /** @type {number[]} */ (history.pop());
  undoBtn.disabled = history.length === 0;
  render();
  announce('Undo.');
}

function clearAll() {
  if (values.length === 0) return;
  pushHistory();
  values = [];
  render();
  announce('Cleared all points.');
}

function addPoint(val) {
  pushHistory();
  values.push(val);
  values.sort((a, b) => a - b);
  render();
  announce(`Added ${val}. ${values.length} points. Mean: ${values.length > 0 ? formatStat(mean(values), 0) : '—'}`);
}

function removePoint(val) {
  const idx = values.indexOf(val);
  if (idx === -1) return;
  pushHistory();
  values.splice(idx, 1);
  render();
  announce(`Removed ${val}. ${values.length} points.${values.length > 0 ? ' Mean: ' + formatStat(mean(values), 0) : ''}`);
}

// ─── Rendering ───

function render() {
  chartArea.innerHTML = '';

  // Compute domain
  const dataMin = values.length > 0 ? d3Array.min(values) ?? 0 : 0;
  const dataMax = values.length > 0 ? d3Array.max(values) ?? 20 : 20;
  const lo = Math.min(0, dataMin - 2);
  const hi = Math.max(20, dataMax + 2);

  // Create chart frame
  const frame = createChart(chartArea, {
    viewWidth: VIEW_WIDTH,
    viewHeight: VIEW_HEIGHT,
    margin: MARGIN,
    titleText: 'Interactive dotplot editor',
    descText: `Dotplot with ${values.length} data points. Click to add or remove.`,
  });

  // frame.inner is a raw DOM node; wrap as D3 selection for chaining
  const g = d3.select(frame.inner);

  const xScale = d3Scale.scaleLinear()
    .domain([lo, hi])
    .range([0, frame.width]);

  // X-axis with integer ticks
  const tickValues = [];
  const step = (hi - lo) > 40 ? 5 : (hi - lo) > 25 ? 2 : 1;
  for (let i = Math.ceil(lo / step) * step; i <= hi; i += step) {
    tickValues.push(i);
  }

  const xAxis = d3Axis.axisBottom(xScale)
    .tickValues(tickValues)
    .tickFormat(d => String(Math.round(/** @type {number} */ (d))));

  g.append('g')
    .attr('class', 'x-axis')
    .attr('transform', `translate(0,${frame.height})`)
    .call(xAxis);

  // Light grid lines
  g.append('g')
    .attr('class', 'grid-lines')
    .selectAll('line')
    .data(tickValues)
    .join('line')
    .attr('x1', d => xScale(d))
    .attr('x2', d => xScale(d))
    .attr('y1', 0)
    .attr('y2', frame.height)
    .attr('stroke', '#e8e8e8')
    .attr('stroke-width', 0.5);

  // Clickable background rect (for adding points)
  g.append('rect')
    .attr('class', 'click-target')
    .attr('x', 0)
    .attr('y', 0)
    .attr('width', frame.width)
    .attr('height', frame.height)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('click', (event) => {
      const [mx] = d3.pointer(event);
      const rawVal = xScale.invert(mx);
      const snapped = Math.round(rawVal);
      // Only add within a reasonable range of the domain
      if (snapped >= lo && snapped <= hi) {
        addPoint(snapped);
      }
    });

  // ─── Boxplot (above dots) ───
  const bpTop = showBoxplot ? BOXPLOT_BAND : 0; // vertical offset for dots

  if (showBoxplot) {
    drawInlineBoxplot(g, xScale, frozenBoxplot, values, bpTop);
  }

  // ─── Stack dots ───
  /** @type {Map<number, number>} */
  const stacks = new Map();
  /** @type {Array<{value: number, stackIndex: number}>} */
  const dots = [];

  for (const v of values) {
    const count = stacks.get(v) ?? 0;
    dots.push({ value: v, stackIndex: count });
    stacks.set(v, count + 1);
  }

  // Compute dot radius — shrink if stacks get too tall
  const maxStack = Math.max(...stacks.values(), 1);
  const availHeight = frame.height - bpTop - 10;
  const naturalR = DOT_RADIUS;
  const neededHeight = maxStack * naturalR * 2.2;
  const r = neededHeight > availHeight ? Math.max(3, availHeight / (maxStack * 2.2)) : naturalR;

  // Draw dots
  const dotGroup = g.append('g').attr('class', 'dots');

  dotGroup.selectAll('circle')
    .data(dots)
    .join('circle')
    .attr('class', 'data-dot')
    .attr('cx', d => xScale(d.value))
    .attr('cy', d => frame.height - r - d.stackIndex * r * 2.2)
    .attr('r', r)
    .attr('fill', DOT_FILL)
    .attr('stroke', DOT_STROKE)
    .attr('stroke-width', 1)
    .attr('tabindex', 0)
    .attr('role', 'button')
    .attr('aria-label', d => `Value ${d.value}. Click to remove.`)
    .attr('cursor', 'pointer')
    .on('click', (event, d) => {
      event.stopPropagation();
      removePoint(d.value);
    })
    .on('keydown', (event, d) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        removePoint(d.value);
      }
    });

  // Mean and median markers (below x-axis)
  if (values.length > 0) {
    const m = mean(values);
    const med = median(values);
    const markerY = frame.height + 18;
    const triSize = 7;

    const mx = xScale(m);
    const medX = xScale(med);
    const tooClose = Math.abs(medX - mx) < 55; // viewBox units — ~width of "Mean: 8.0"

    // Mean triangle
    g.append('polygon')
      .attr('points', `${mx - triSize},${markerY + triSize} ${mx + triSize},${markerY + triSize} ${mx},${markerY}`)
      .attr('fill', MEAN_COLOR)
      .attr('pointer-events', 'none');

    // Median triangle (skip if exactly on top of mean)
    if (Math.abs(medX - mx) > 3) {
      g.append('polygon')
        .attr('points', `${medX - triSize},${markerY + triSize} ${medX + triSize},${markerY + triSize} ${medX},${markerY}`)
        .attr('fill', MEDIAN_COLOR)
        .attr('pointer-events', 'none');
    }

    // Mean label — always on first row
    g.append('text')
      .attr('class', 'marker-label')
      .attr('x', mx)
      .attr('y', markerY + triSize + 14)
      .attr('text-anchor', 'middle')
      .attr('fill', MEAN_COLOR)
      .text(`Mean: ${formatStat(m, 0)}`);

    // Median label — drop to second row if too close to mean
    g.append('text')
      .attr('class', 'marker-label')
      .attr('x', medX)
      .attr('y', markerY + triSize + (tooClose ? 28 : 14))
      .attr('text-anchor', 'middle')
      .attr('fill', MEDIAN_COLOR)
      .text(`Median: ${formatStat(med, 0)}`);
  }

  updateStats();
}

// ─── Stats display ───

function updateStats() {
  const n = values.length;
  const dash = '\u2014';

  /** @type {Record<string, string>} */
  const stats = {
    n:      String(n),
    mean:   n > 0 ? formatStat(mean(values), 0) : dash,
    median: n > 0 ? formatStat(median(values), 0) : dash,
    sd:     n > 1 ? formatStat(sd(values), 0) : dash,
    iqr:    n > 0 ? formatStat(iqr(values), 0) : dash,
    range:  n > 0 ? formatStat((d3Array.max(values) ?? 0) - (d3Array.min(values) ?? 0), 0) : dash,
    min:    n > 0 ? String(d3Array.min(values)) : dash,
    q1:     n > 0 ? formatStat(quantile(values, 0.25), 0) : dash,
    q3:     n > 0 ? formatStat(quantile(values, 0.75), 0) : dash,
    max:    n > 0 ? String(d3Array.max(values)) : dash,
  };

  for (const [key, val] of Object.entries(stats)) {
    const el = statEls[/** @type {keyof typeof statEls} */ (key)];
    if (!el) continue;
    const changed = prevStats[key] !== undefined && prevStats[key] !== val;
    el.textContent = val;
    if (changed) {
      const row = el.closest('tr');
      if (row) {
        row.classList.remove('stat-changed');
        void row.offsetWidth; // force reflow
        row.classList.add('stat-changed');
      }
    }
  }

  prevStats = stats;
}

// ─── Inline boxplot renderer ───

/**
 * Draw a boxplot (and optional frozen ghost) in the top band of the chart.
 * @param {d3.Selection} parent - D3 selection of the chart inner group
 * @param {d3Scale.ScaleLinear<number,number>} xScale
 * @param {import('../../js/boxplot.js').BoxplotStats|null} frozen
 * @param {number[]} currentValues
 * @param {number} bandHeight - height of the boxplot band
 */
function drawInlineBoxplot(parent, xScale, frozen, currentValues, bandHeight) {
  const bpGroup = parent.append('g').attr('class', 'boxplot-overlay');
  const midY = bandHeight / 2;
  const boxHalf = 14; // half-height of the box

  // Separator line between boxplot and dots
  bpGroup.append('line')
    .attr('x1', 0).attr('x2', /** @type {number} */ (xScale.range()[1]))
    .attr('y1', bandHeight).attr('y2', bandHeight)
    .attr('stroke', '#ddd').attr('stroke-width', 0.5).attr('stroke-dasharray', '4,3');

  // Draw frozen ghost first (behind)
  if (frozen) {
    drawOneBoxplot(bpGroup, xScale, frozen, midY, boxHalf, {
      fill: '#eee', stroke: '#aaa', strokeWidth: 1.5, dasharray: '4,2', opacity: 0.8, label: 'Frozen',
    });
  }

  // Draw live boxplot
  if (currentValues.length >= 2) {
    const live = computeBoxplotStats(currentValues);
    drawOneBoxplot(bpGroup, xScale, live, midY, boxHalf, {
      fill: 'rgba(86,155,189,0.15)', stroke: '#569BBD', strokeWidth: 2, dasharray: '', opacity: 1, label: '',
    });
  }
}

/**
 * @param {d3.Selection} parent
 * @param {d3Scale.ScaleLinear<number,number>} xScale
 * @param {import('../../js/boxplot.js').BoxplotStats} stats
 * @param {number} midY
 * @param {number} boxHalf
 * @param {{fill:string, stroke:string, strokeWidth:number, dasharray:string, opacity:number, label:string}} style
 */
function drawOneBoxplot(parent, xScale, stats, midY, boxHalf, style) {
  const bp = parent.append('g')
    .attr('opacity', style.opacity)
    .attr('pointer-events', 'none');

  // Whisker lines
  bp.append('line')
    .attr('x1', xScale(stats.whiskerLo)).attr('x2', xScale(stats.q1))
    .attr('y1', midY).attr('y2', midY)
    .attr('stroke', style.stroke).attr('stroke-width', style.strokeWidth)
    .attr('stroke-dasharray', style.dasharray);

  bp.append('line')
    .attr('x1', xScale(stats.q3)).attr('x2', xScale(stats.whiskerHi))
    .attr('y1', midY).attr('y2', midY)
    .attr('stroke', style.stroke).attr('stroke-width', style.strokeWidth)
    .attr('stroke-dasharray', style.dasharray);

  // Whisker caps
  bp.append('line')
    .attr('x1', xScale(stats.whiskerLo)).attr('x2', xScale(stats.whiskerLo))
    .attr('y1', midY - boxHalf * 0.5).attr('y2', midY + boxHalf * 0.5)
    .attr('stroke', style.stroke).attr('stroke-width', style.strokeWidth);

  bp.append('line')
    .attr('x1', xScale(stats.whiskerHi)).attr('x2', xScale(stats.whiskerHi))
    .attr('y1', midY - boxHalf * 0.5).attr('y2', midY + boxHalf * 0.5)
    .attr('stroke', style.stroke).attr('stroke-width', style.strokeWidth);

  // Box (Q1 to Q3)
  bp.append('rect')
    .attr('x', xScale(stats.q1))
    .attr('y', midY - boxHalf)
    .attr('width', Math.max(1, xScale(stats.q3) - xScale(stats.q1)))
    .attr('height', boxHalf * 2)
    .attr('fill', style.fill)
    .attr('stroke', style.stroke)
    .attr('stroke-width', style.strokeWidth)
    .attr('stroke-dasharray', style.dasharray);

  // Median line
  bp.append('line')
    .attr('x1', xScale(stats.median)).attr('x2', xScale(stats.median))
    .attr('y1', midY - boxHalf).attr('y2', midY + boxHalf)
    .attr('stroke', style.stroke).attr('stroke-width', style.strokeWidth + 0.5);

  // Outliers
  const outliers = [...stats.mildOutliers, ...stats.extremeOutliers];
  if (outliers.length > 0) {
    bp.selectAll('.bp-outlier')
      .data(outliers)
      .join('circle')
      .attr('class', 'bp-outlier')
      .attr('cx', d => xScale(d))
      .attr('cy', midY)
      .attr('r', 3)
      .attr('fill', 'none')
      .attr('stroke', style.stroke)
      .attr('stroke-width', 1);
  }

  // Label (for frozen)
  if (style.label) {
    bp.append('text')
      .attr('x', xScale(stats.whiskerHi) + 6)
      .attr('y', midY + 4)
      .attr('font-size', '10px')
      .attr('fill', style.stroke)
      .text(style.label);
  }
}
