// @ts-check
/**
 * Guess the Correlation — drag-and-drop matching game.
 */

import * as d3Selection from 'd3-selection';
import * as d3Scale from 'd3-scale';
import * as d3Array from 'd3-array';
import { initHelp } from '../../js/page-utils.js';

initHelp();

// ── DOM references ──────────────────────────────────────────
const announceEl = /** @type {HTMLElement} */ (document.getElementById('sr-announce'));

function announce(msg) {
  if (announceEl) announceEl.textContent = msg;
}

// ═══════════════════════════════════════════════════════════════
// Data generation
// ═══════════════════════════════════════════════════════════════

/** Box-Muller standard normal. */
function randNormal() {
  let u, v, s;
  do { u = Math.random() * 2 - 1; v = Math.random() * 2 - 1; s = u * u + v * v; }
  while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

/** @param {number[]} arr */
function mean(arr) { let s = 0; for (const v of arr) s += v; return s / arr.length; }

/**
 * Generate bivariate data with target correlation (Cholesky).
 * @param {number} n
 * @param {number} targetR
 * @returns {{ x: number[], y: number[], actualR: number }}
 */
function generateData(n, targetR) {
  const z1 = [], z2 = [];
  for (let i = 0; i < n; i++) { z1.push(randNormal()); z2.push(randNormal()); }

  const rc = Math.max(-0.999, Math.min(0.999, targetR));
  const x = z1.slice();
  const y = z1.map((v, i) => rc * v + Math.sqrt(1 - rc * rc) * z2[i]);

  const mx = mean(x), my = mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const actualR = num / Math.sqrt(dx2 * dy2);
  return { x, y, actualR };
}

/**
 * Pick 4 distinct target r values that are well-separated.
 * @returns {number[]}
 */
function pickFourTargets() {
  const bands = [
    [-0.95, -0.60], [-0.55, -0.15], [0.15, 0.55], [0.60, 0.95],
  ];
  // Shuffle the bands
  for (let i = bands.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bands[i], bands[j]] = [bands[j], bands[i]];
  }
  return bands.map(([lo, hi]) => lo + Math.random() * (hi - lo));
}

// ── Draw scatterplot ────────────────────────────────────────
/**
 * @param {HTMLElement} container
 * @param {number[]} x
 * @param {number[]} y
 * @param {{ showR?: boolean, showLine?: boolean, actualR?: number, size?: number }} [opts]
 */
function drawScatter(container, x, y, opts = {}) {
  container.querySelectorAll('svg').forEach(s => s.remove());

  const size = opts.size || 400;
  const margin = { top: 15, right: 15, bottom: 15, left: 15 };
  const w = size - margin.left - margin.right;
  const h = size - margin.top - margin.bottom;

  const svg = d3Selection.select(container)
    .append('svg')
    .attr('viewBox', `0 0 ${size} ${size}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  svg.append('title').text(
    opts.showR
      ? `Scatterplot with r = ${opts.actualR?.toFixed(3)}`
      : `Scatterplot of ${x.length} points`
  );

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  const allVals = [...x, ...y];
  const ext = d3Array.extent(allVals);
  const pad = (/** @type {number} */ (ext[1]) - /** @type {number} */ (ext[0])) * 0.12;
  const lo = /** @type {number} */ (ext[0]) - pad;
  const hi = /** @type {number} */ (ext[1]) + pad;

  const xScale = d3Scale.scaleLinear().domain([lo, hi]).range([0, w]);
  const yScale = d3Scale.scaleLinear().domain([lo, hi]).range([h, 0]);

  g.append('rect').attr('width', w).attr('height', h)
    .attr('fill', '#fafbfc').attr('stroke', '#e0e0e0');

  const dotColor = opts.showR ? '#999' : '#569BBD';
  const dotR = size < 300 ? 3.5 : 5;
  for (let i = 0; i < x.length; i++) {
    g.append('circle')
      .attr('cx', xScale(x[i])).attr('cy', yScale(y[i]))
      .attr('r', dotR).attr('fill', dotColor).attr('opacity', 0.7)
      .attr('stroke', 'white').attr('stroke-width', 0.5);
  }

  if (opts.showLine) {
    const mx = mean(x), my_ = mean(y);
    let num = 0, denom = 0;
    for (let i = 0; i < x.length; i++) {
      num += (x[i] - mx) * (y[i] - my_);
      denom += (x[i] - mx) * (x[i] - mx);
    }
    const slope = denom === 0 ? 0 : num / denom;
    const intercept = my_ - slope * mx;
    g.append('line')
      .attr('x1', xScale(lo)).attr('y1', yScale(intercept + slope * lo))
      .attr('x2', xScale(hi)).attr('y2', yScale(intercept + slope * hi))
      .attr('stroke', '#F05133').attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 3').attr('opacity', 0.8);
  }

  if (opts.showR && opts.actualR != null) {
    g.append('text')
      .attr('x', w - 8).attr('y', 20)
      .attr('text-anchor', 'end')
      .attr('font-size', size < 300 ? '13px' : '16px')
      .attr('font-weight', '700').attr('fill', '#F05133')
      .text(`r = ${opts.actualR.toFixed(3)}`);
  }
}


// ═══════════════════════════════════════════════════════════════
// MATCH GAME
// ═══════════════════════════════════════════════════════════════

const matchGrid = /** @type {HTMLElement} */ (document.getElementById('match-grid'));
const rChoices = /** @type {HTMLElement} */ (document.getElementById('r-choices'));
const matchFeedback = /** @type {HTMLElement} */ (document.getElementById('match-feedback'));
const matchInstructions = /** @type {HTMLElement} */ (document.getElementById('match-instructions'));
const btnMatchNext = /** @type {HTMLButtonElement} */ (document.getElementById('btn-match-next'));
const matchRoundEl = /** @type {HTMLElement} */ (document.getElementById('match-round'));
const matchCorrectEl = /** @type {HTMLElement} */ (document.getElementById('match-correct'));
const matchTotalEl = /** @type {HTMLElement} */ (document.getElementById('match-total'));
const matchHistory = /** @type {HTMLElement} */ (document.getElementById('match-history'));

/** @type {{ x: number[], y: number[], actualR: number, label: string }[]} */
let matchPlots = [];
/** @type {Map<number, number>} plotIndex → correctPlotIdx */
let matchAssignments = new Map();
let matchSelectedPlot = -1;
let matchRound = 0;
let matchCorrectCount = 0;
let matchTotalCount = 0;
let matchRevealed = false;

function getMatchN() {
  const v = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="difficulty"]:checked'))?.value || 'medium';
  return v === 'easy' ? 50 : v === 'hard' ? 15 : 30;
}

function matchNewRound() {
  matchRound++;
  matchRevealed = false;
  matchAssignments.clear();
  matchSelectedPlot = -1;

  const n = getMatchN();
  const targets = pickFourTargets();
  const labels = ['A', 'B', 'C', 'D'];

  matchPlots = targets.map((t, i) => {
    const data = generateData(n, t);
    return { ...data, label: labels[i] };
  });

  // The correct r for plot i is matchPlots[i].actualR
  // We present the r values in shuffled order
  const rWithIndex = matchPlots.map((p, i) => ({ r: p.actualR, origPlotIdx: i }));
  // Shuffle for display
  for (let i = rWithIndex.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [rWithIndex[i], rWithIndex[j]] = [rWithIndex[j], rWithIndex[i]];
  }

  // Render plots
  matchGrid.innerHTML = '';
  matchPlots.forEach((plot, idx) => {
    const div = document.createElement('div');
    div.className = 'match-plot';
    div.tabIndex = 0;
    div.setAttribute('role', 'button');
    div.setAttribute('aria-label', `Scatterplot ${plot.label}`);
    div.dataset.idx = String(idx);

    const labelSpan = document.createElement('span');
    labelSpan.className = 'plot-label';
    labelSpan.textContent = plot.label;
    div.appendChild(labelSpan);

    drawScatter(div, plot.x, plot.y, { size: 250 });
    matchGrid.appendChild(div);

    div.addEventListener('click', () => selectPlot(idx));
    div.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPlot(idx); }
    });
  });

  // Render r-value buttons (draggable + clickable)
  rChoices.innerHTML = '';
  rWithIndex.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'r-choice';
    btn.textContent = item.r.toFixed(2);
    btn.dataset.plotIdx = String(item.origPlotIdx);
    btn.draggable = true;
    btn.addEventListener('click', () => selectR(item.origPlotIdx, btn));

    // Drag events
    btn.addEventListener('dragstart', (e) => {
      if (matchRevealed || btn.classList.contains('used')) { e.preventDefault(); return; }
      btn.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', String(item.origPlotIdx));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
      matchSelectedPlot = -1;
      matchGrid.querySelectorAll('.match-plot').forEach(el => el.classList.remove('selected'));
    });
    btn.addEventListener('dragend', () => btn.classList.remove('dragging'));

    rChoices.appendChild(btn);
  });

  // Drop targets on plots
  matchGrid.querySelectorAll('.match-plot').forEach(plotDiv => {
    plotDiv.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e instanceof DragEvent && e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    plotDiv.addEventListener('dragenter', (e) => {
      e.preventDefault();
      const idx = Number(/** @type {HTMLElement} */ (plotDiv).dataset.idx);
      if (!matchRevealed && !matchAssignments.has(idx)) {
        plotDiv.classList.add('drag-over');
      }
    });
    plotDiv.addEventListener('dragleave', () => plotDiv.classList.remove('drag-over'));
    plotDiv.addEventListener('drop', (e) => {
      e.preventDefault();
      plotDiv.classList.remove('drag-over');
      const plotIdx = Number(/** @type {HTMLElement} */ (plotDiv).dataset.idx);
      if (matchRevealed || matchAssignments.has(plotIdx)) return;
      const correctPlotIdx = Number(/** @type {DragEvent} */ (e).dataTransfer?.getData('text/plain'));
      if (!isFinite(correctPlotIdx)) return;
      const btn = /** @type {HTMLButtonElement|null} */ (
        rChoices.querySelector(`[data-plot-idx="${correctPlotIdx}"]`));
      if (!btn || btn.classList.contains('used')) return;
      matchSelectedPlot = plotIdx;
      selectR(correctPlotIdx, btn);
    });
  });

  matchFeedback.className = 'feedback hidden';
  matchFeedback.textContent = '';
  matchInstructions.innerHTML = 'Drag an <em>r</em> value onto its scatterplot, or click to match.';
  btnMatchNext.style.display = 'none';
  matchRoundEl.textContent = String(matchRound);

  announce(`Round ${matchRound}. Four scatterplots labeled A through D. Match each to its correlation.`);
}

function selectPlot(idx) {
  if (matchRevealed) return;
  if (matchAssignments.has(idx)) return;

  matchSelectedPlot = idx;

  matchGrid.querySelectorAll('.match-plot').forEach(el => {
    const elIdx = Number(/** @type {HTMLElement} */ (el).dataset.idx);
    el.classList.toggle('selected', elIdx === idx && !matchAssignments.has(elIdx));
  });

  matchInstructions.textContent =
    `Scatterplot ${matchPlots[idx].label} selected. Now click an r value.`;
}

/**
 * @param {number} correctPlotIdx - which plot this r actually belongs to
 * @param {HTMLButtonElement} btn
 */
function selectR(correctPlotIdx, btn) {
  if (matchRevealed) return;
  if (matchSelectedPlot < 0) {
    matchInstructions.textContent = 'Select a scatterplot first, then click an r value.';
    return;
  }
  if (btn.classList.contains('used')) return;

  matchAssignments.set(matchSelectedPlot, correctPlotIdx);

  btn.classList.add('used', 'selected');

  const plotDiv = matchGrid.querySelector(`[data-idx="${matchSelectedPlot}"]`);
  if (plotDiv) {
    plotDiv.classList.remove('selected');
    let tag = plotDiv.querySelector('.assigned-r');
    if (!tag) {
      tag = document.createElement('span');
      tag.className = 'reveal-r assigned-r';
      plotDiv.appendChild(tag);
    }
    /** @type {HTMLElement} */ (tag).textContent = `r = ${matchPlots[correctPlotIdx].actualR.toFixed(2)}`;
    /** @type {HTMLElement} */ (tag).style.color = 'var(--ims-blue)';
  }

  matchSelectedPlot = -1;

  if (matchAssignments.size === 4) {
    checkMatch();
  } else {
    matchInstructions.innerHTML = `${matchAssignments.size}/4 matched. Drag or click another.`;
  }
}

function checkMatch() {
  matchRevealed = true;
  let correct = 0;

  matchAssignments.forEach((assignedCorrectPlotIdx, plotIdx) => {
    const isCorrect = assignedCorrectPlotIdx === plotIdx;
    if (isCorrect) correct++;

    const plotDiv = matchGrid.querySelector(`[data-idx="${plotIdx}"]`);
    if (plotDiv) {
      plotDiv.classList.add(isCorrect ? 'correct-reveal' : 'wrong-reveal');
      const tag = plotDiv.querySelector('.assigned-r');
      if (tag && !isCorrect) {
        /** @type {HTMLElement} */ (tag).textContent =
          `${matchPlots[assignedCorrectPlotIdx].actualR.toFixed(2)} → actual: ${matchPlots[plotIdx].actualR.toFixed(2)}`;
        /** @type {HTMLElement} */ (tag).style.color = '#c62828';
      } else if (tag) {
        /** @type {HTMLElement} */ (tag).style.color = '#2e7d32';
      }
    }
  });

  // Show regression lines on all plots
  matchPlots.forEach((plot, idx) => {
    const plotDiv = /** @type {HTMLElement|null} */ (matchGrid.querySelector(`[data-idx="${idx}"]`));
    if (plotDiv) {
      drawScatter(plotDiv, plot.x, plot.y, { showR: true, showLine: true, actualR: plot.actualR, size: 250 });
      const labelSpan = document.createElement('span');
      labelSpan.className = 'plot-label';
      labelSpan.textContent = plot.label;
      plotDiv.prepend(labelSpan);
    }
  });

  matchCorrectCount += correct;
  matchTotalCount += 4;
  matchCorrectEl.textContent = String(matchCorrectCount);
  matchTotalEl.textContent = String(matchTotalCount);

  const dot = document.createElement('span');
  const dotGrade = correct === 4 ? 'correct' : correct >= 3 ? 'good' : correct >= 2 ? 'ok' : 'wrong';
  dot.className = `history-dot ${dotGrade}`;
  dot.title = `Round ${matchRound}: ${correct}/4`;
  dot.setAttribute('aria-label', dot.title);
  matchHistory.appendChild(dot);

  const fbGrade = correct === 4 ? 'correct' : correct >= 3 ? 'good' : correct >= 2 ? 'ok' : 'miss';
  matchFeedback.className = `feedback ${fbGrade}`;
  matchFeedback.textContent = `${correct}/4 correct!`;
  matchInstructions.textContent = '';

  btnMatchNext.style.display = '';
  btnMatchNext.focus();

  announce(`${correct} out of 4 correct.`);
}

btnMatchNext.addEventListener('click', matchNewRound);

for (const r of document.querySelectorAll('input[name="difficulty"]')) {
  r.addEventListener('change', () => {
    matchRound = 0; matchCorrectCount = 0; matchTotalCount = 0;
    matchCorrectEl.textContent = '0'; matchTotalEl.textContent = '0';
    matchHistory.innerHTML = '';
    matchNewRound();
  });
}


// ── Touch drag support (mobile) ──────────────────────────────

/** @type {HTMLElement|null} */
let touchClone = null;
/** @type {HTMLButtonElement|null} */
let touchSourceBtn = null;

rChoices.addEventListener('touchstart', (e) => {
  const btn = /** @type {HTMLButtonElement|null} */ (/** @type {HTMLElement} */ (e.target).closest('.r-choice'));
  if (!btn || matchRevealed || btn.classList.contains('used')) return;

  e.preventDefault();
  touchSourceBtn = btn;

  touchClone = /** @type {HTMLElement} */ (btn.cloneNode(true));
  touchClone.style.cssText = 'position:fixed;pointer-events:none;z-index:1000;opacity:0.85;transform:scale(1.1);box-shadow:0 4px 16px rgba(0,0,0,0.2);';
  const touch = e.touches[0];
  touchClone.style.left = `${touch.clientX - 40}px`;
  touchClone.style.top = `${touch.clientY - 25}px`;
  document.body.appendChild(touchClone);
  btn.classList.add('dragging');

  matchSelectedPlot = -1;
  matchGrid.querySelectorAll('.match-plot').forEach(el => el.classList.remove('selected'));
}, { passive: false });

rChoices.addEventListener('touchmove', (e) => {
  if (!touchClone) return;
  e.preventDefault();
  const touch = e.touches[0];
  touchClone.style.left = `${touch.clientX - 40}px`;
  touchClone.style.top = `${touch.clientY - 25}px`;

  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const plotDiv = el?.closest('.match-plot');
  matchGrid.querySelectorAll('.match-plot').forEach(p => p.classList.remove('drag-over'));
  if (plotDiv) {
    const idx = Number(/** @type {HTMLElement} */ (plotDiv).dataset.idx);
    if (!matchAssignments.has(idx)) plotDiv.classList.add('drag-over');
  }
}, { passive: false });

rChoices.addEventListener('touchend', (e) => {
  if (!touchClone || !touchSourceBtn) return;

  touchClone.remove();
  touchClone = null;
  touchSourceBtn.classList.remove('dragging');
  matchGrid.querySelectorAll('.match-plot').forEach(p => p.classList.remove('drag-over'));

  const touch = e.changedTouches[0];
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  const plotDiv = el?.closest('.match-plot');

  if (plotDiv) {
    const plotIdx = Number(/** @type {HTMLElement} */ (plotDiv).dataset.idx);
    const correctPlotIdx = Number(touchSourceBtn.dataset.plotIdx);
    if (!matchAssignments.has(plotIdx) && !touchSourceBtn.classList.contains('used')) {
      matchSelectedPlot = plotIdx;
      selectR(correctPlotIdx, touchSourceBtn);
    }
  }

  touchSourceBtn = null;
});

// ── Start ───────────────────────────────────────────────────
matchNewRound();
