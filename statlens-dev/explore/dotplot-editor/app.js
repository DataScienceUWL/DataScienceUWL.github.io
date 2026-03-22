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
const IS_MOBILE = window.matchMedia('(max-width: 600px)').matches;
const DOT_RADIUS = IS_MOBILE ? 14 : 7;
const MAX_HISTORY = 100;
const VIEW_WIDTH = 600;
const VIEW_HEIGHT = 360;
const MARGIN = { top: 20, right: 20, bottom: 65, left: 20 };
const BOXPLOT_BAND = 55; // viewBox units reserved at top for boxplot (fits two parallel rows)

// ─── DOM refs ───

const chartArea = /** @type {HTMLElement} */ (document.getElementById('chart-area'));
const presetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('preset-select'));
const undoBtn = /** @type {HTMLButtonElement} */ (document.getElementById('undo-btn'));
const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear-btn'));
const boxplotCheck = /** @type {HTMLInputElement} */ (document.getElementById('boxplot-check'));
const challengeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('challenge-btn'));
const challengeBanner = /** @type {HTMLElement} */ (document.getElementById('challenge-banner'));

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
let challengeActive = false;

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
  if (challengeActive) endChallenge();
  loadPreset(presetSelect.value);
});

// Undo / Clear
undoBtn.addEventListener('click', undo);
clearBtn.addEventListener('click', resetData);

// Boxplot toggle
boxplotCheck.addEventListener('change', () => {
  showBoxplot = boxplotCheck.checked;
  if (!showBoxplot) {
    frozenBoxplot = null;
    if (challengeActive) endChallenge();
  }
  render();
});

// Challenge mode
challengeBtn.addEventListener('click', startChallenge);

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

function resetData() {
  pushHistory();
  const preset = PRESETS[/** @type {keyof typeof PRESETS} */ (presetSelect.value)];
  values = preset ? [...preset] : [];
  render();
  announce(preset && preset.length > 0
    ? `Reset to ${presetSelect.value} preset. ${values.length} points.`
    : 'Cleared all points.');
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

  // Compute domain — include frozen/challenge boxplot range
  let dataMin = values.length > 0 ? d3Array.min(values) ?? 0 : 0;
  let dataMax = values.length > 0 ? d3Array.max(values) ?? 20 : 20;
  if (frozenBoxplot) {
    const allFrozen = [frozenBoxplot.whiskerLo, frozenBoxplot.whiskerHi,
      ...frozenBoxplot.mildOutliers, ...frozenBoxplot.extremeOutliers];
    dataMin = Math.min(dataMin, ...allFrozen);
    dataMax = Math.max(dataMax, ...allFrozen);
  }
  // On mobile, clamp domain to [0, 20] so dots stay large
  const lo = IS_MOBILE ? 0 : Math.min(0, dataMin - 2);
  const hi = IS_MOBILE ? 20 : Math.max(20, dataMax + 2);

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
      const snapped = IS_MOBILE
        ? Math.max(0, Math.min(20, Math.round(rawVal)))
        : Math.round(rawVal);
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
  updateChallengeBanner();
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
  const hasLive = currentValues.length >= 2;

  // Separator line between boxplot and dots
  bpGroup.append('line')
    .attr('x1', 0).attr('x2', /** @type {number} */ (xScale.range()[1]))
    .attr('y1', bandHeight).attr('y2', bandHeight)
    .attr('stroke', '#ddd').attr('stroke-width', 0.5).attr('stroke-dasharray', '4,3');

  // Mobile: bolder strokes and taller boxes so they're visible on small screens
  const sw = IS_MOBILE ? 3 : 2;

  if (frozen && hasLive) {
    // Two boxplots (challenge mode): parallel rows
    const targetY = bandHeight * 0.28;
    const liveY = bandHeight * 0.72;
    const boxHalf = IS_MOBILE ? 12 : 9;

    drawOneBoxplot(bpGroup, xScale, frozen, targetY, boxHalf, {
      fill: '#fff3cd', stroke: '#b8860b', strokeWidth: sw, dasharray: '', opacity: 0.9, label: 'Target',
    });

    const live = computeBoxplotStats(currentValues);
    drawOneBoxplot(bpGroup, xScale, live, liveY, boxHalf, {
      fill: 'rgba(86,155,189,0.15)', stroke: '#569BBD', strokeWidth: sw, dasharray: '', opacity: 1, label: 'Yours',
    });
  } else {
    // Single boxplot (either target-only or live-only)
    const midY = bandHeight / 2;
    const boxHalf = IS_MOBILE ? 18 : 14;

    if (frozen) {
      drawOneBoxplot(bpGroup, xScale, frozen, midY, boxHalf, {
        fill: '#fff3cd', stroke: '#b8860b', strokeWidth: sw, dasharray: '', opacity: 0.9, label: 'Target',
      });
    } else if (hasLive) {
      const live = computeBoxplotStats(currentValues);
      drawOneBoxplot(bpGroup, xScale, live, midY, boxHalf, {
        fill: 'rgba(86,155,189,0.15)', stroke: '#569BBD', strokeWidth: sw, dasharray: '', opacity: 1, label: '',
      });
    }
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
  const capFrac = IS_MOBILE ? 0.7 : 0.5;
  bp.append('line')
    .attr('x1', xScale(stats.whiskerLo)).attr('x2', xScale(stats.whiskerLo))
    .attr('y1', midY - boxHalf * capFrac).attr('y2', midY + boxHalf * capFrac)
    .attr('stroke', style.stroke).attr('stroke-width', style.strokeWidth);

  bp.append('line')
    .attr('x1', xScale(stats.whiskerHi)).attr('x2', xScale(stats.whiskerHi))
    .attr('y1', midY - boxHalf * capFrac).attr('y2', midY + boxHalf * capFrac)
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
      .attr('r', IS_MOBILE ? 5 : 3)
      .attr('fill', 'none')
      .attr('stroke', style.stroke)
      .attr('stroke-width', IS_MOBILE ? 2 : 1);
  }

  // Label (for frozen)
  if (style.label) {
    bp.append('text')
      .attr('x', xScale(stats.whiskerHi) + 6)
      .attr('y', midY + 4)
      .attr('class', 'overlay-label')
      .attr('fill', style.stroke)
      .text(style.label);
  }
}

// ─── Challenge mode ───

/** @type {Array<number[]>} */
const CHALLENGE_POOLS = [
  // No outliers — symmetric
  [4, 6, 7, 8, 8, 9, 10, 12],
  [2, 5, 6, 7, 8, 9, 11, 14],
  [3, 5, 6, 7, 7, 8, 9, 11],
  // No outliers — skewed
  [1, 2, 3, 3, 4, 5, 6, 10],
  [2, 3, 4, 5, 5, 6, 8, 12],
  [5, 8, 9, 10, 11, 12, 13, 15],
  // One outlier low
  [1, 6, 7, 8, 9, 10, 11, 13],
  [2, 9, 10, 11, 12, 13, 14, 16],
  // One outlier high
  [3, 5, 6, 7, 8, 9, 10, 18],
  [4, 6, 7, 8, 9, 10, 11, 20],
  [1, 3, 4, 5, 6, 7, 8, 16],
  // Two outliers (both sides)
  [1, 6, 8, 9, 10, 11, 13, 20],
  [0, 5, 7, 8, 9, 10, 12, 19],
  // Two outliers same side
  [2, 3, 5, 6, 7, 8, 9, 16, 19],
  [1, 4, 8, 9, 10, 11, 12, 13, 20],
];

function startChallenge() {
  // Pick a random challenge dataset
  const pool = CHALLENGE_POOLS[Math.floor(Math.random() * CHALLENGE_POOLS.length)];
  const target = computeBoxplotStats(pool);

  // Enable boxplot, set target
  showBoxplot = true;
  boxplotCheck.checked = true;
  frozenBoxplot = target;
  challengeActive = true;
  challengeBtn.textContent = 'New Challenge';

  // Clear data so student starts fresh
  pushHistory();
  values = [];
  history = [];
  undoBtn.disabled = true;

  // Switch preset to empty
  presetSelect.value = 'empty';

  render();
  updateChallengeBanner();
  announce('Challenge started! Build a dataset that matches the target boxplot.');
}

function endChallenge() {
  challengeActive = false;
  challengeBtn.textContent = 'Challenge';
  challengeBanner.style.display = 'none';
  frozenBoxplot = null;
}

function updateChallengeBanner() {
  if (!challengeActive || !frozenBoxplot) {
    challengeBanner.style.display = 'none';
    return;
  }

  challengeBanner.style.display = '';

  if (values.length < 2) {
    challengeBanner.className = 'challenge-banner active';
    const target = frozenBoxplot;
    const outliers = [...target.mildOutliers, ...target.extremeOutliers];
    const outlierNote = outliers.length > 0
      ? ` (with ${outliers.length} outlier${outliers.length > 1 ? 's' : ''})`
      : '';
    challengeBanner.innerHTML =
      `<strong>Challenge:</strong> Build a dataset that matches the target boxplot${outlierNote}. ` +
      `Click the number line to add points.`;
    return;
  }

  const live = computeBoxplotStats(values);
  const checks = [
    { name: 'Min/Whisker Low', match: live.whiskerLo === frozenBoxplot.whiskerLo },
    { name: 'Q1', match: live.q1 === frozenBoxplot.q1 },
    { name: 'Median', match: live.median === frozenBoxplot.median },
    { name: 'Q3', match: live.q3 === frozenBoxplot.q3 },
    { name: 'Max/Whisker High', match: live.whiskerHi === frozenBoxplot.whiskerHi },
  ];

  // Check outliers: same set of values
  const targetOutliers = [...frozenBoxplot.mildOutliers, ...frozenBoxplot.extremeOutliers].sort((a, b) => a - b);
  const liveOutliers = [...live.mildOutliers, ...live.extremeOutliers].sort((a, b) => a - b);
  const outliersMatch = targetOutliers.length === liveOutliers.length &&
    targetOutliers.every((v, i) => v === liveOutliers[i]);

  if (targetOutliers.length > 0) {
    checks.push({ name: `Outlier${targetOutliers.length > 1 ? 's' : ''}`, match: outliersMatch });
  }

  const allMatch = checks.every(c => c.match);

  if (allMatch) {
    challengeBanner.className = 'challenge-banner matched';
    challengeBanner.innerHTML =
      `<strong>Match!</strong> Your data produces the target boxplot. ` +
      `Can you build a <em>different</em> dataset with the same boxplot? Click <strong>New Challenge</strong> for another.`;
    announce('Match! Your data produces the target boxplot.');
  } else {
    const detail = checks
      .map(c => `<span class="${c.match ? 'yes' : 'no'}">${c.match ? '\u2713' : '\u2717'} ${c.name}</span>`)
      .join(' &nbsp; ');
    challengeBanner.className = 'challenge-banner active';
    challengeBanner.innerHTML =
      `<strong>Challenge:</strong> Match the target boxplot.` +
      `<div class="match-detail">${detail}</div>`;
  }
}

