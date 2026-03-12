// @ts-check
/**
 * Guess the Correlation — interactive game with Slider and Match modes.
 */

import * as d3Selection from 'd3-selection';
import * as d3Scale from 'd3-scale';
import * as d3Array from 'd3-array';

// ── DOM references (shared) ─────────────────────────────────────
const announceEl = /** @type {HTMLElement} */ (document.getElementById('sr-announce'));
const sliderMode = /** @type {HTMLElement} */ (document.getElementById('slider-mode'));
const matchMode = /** @type {HTMLElement} */ (document.getElementById('match-mode'));

function announce(msg) {
  if (announceEl) announceEl.textContent = msg;
}

// ═══════════════════════════════════════════════════════════════
// Data generation (shared)
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

/** Pick a random target r from interesting ranges. */
function pickTargetR() {
  const ranges = [
    [-0.95, -0.70], [-0.70, -0.40], [-0.40, -0.10], [-0.10, 0.10],
    [0.10, 0.40], [0.40, 0.70], [0.70, 0.95],
  ];
  const range = ranges[Math.floor(Math.random() * ranges.length)];
  return range[0] + Math.random() * (range[1] - range[0]);
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

/** Shuffle array in place. */
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ── Draw scatterplot ────────────────────────────────────────────
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
// SLIDER MODE
// ═══════════════════════════════════════════════════════════════

const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const guessSlider = /** @type {HTMLInputElement} */ (document.getElementById('guess-slider'));
const guessDisplay = /** @type {HTMLElement} */ (document.getElementById('guess-display'));
const btnSubmit = /** @type {HTMLButtonElement} */ (document.getElementById('btn-submit'));
const btnNext = /** @type {HTMLButtonElement} */ (document.getElementById('btn-next'));
const feedbackEl = /** @type {HTMLElement} */ (document.getElementById('feedback'));
const roundNum = /** @type {HTMLElement} */ (document.getElementById('round-num'));
const avgErrorEl = /** @type {HTMLElement} */ (document.getElementById('avg-error'));
const bestStreakEl = /** @type {HTMLElement} */ (document.getElementById('best-streak'));
const totalScoreEl = /** @type {HTMLElement} */ (document.getElementById('total-score'));
const historyBar = /** @type {HTMLElement} */ (document.getElementById('history-bar'));

let sliderState = {
  trueR: 0, round: 0, totalError: 0, totalScore: 0, streak: 0, bestStreak: 0,
  submitted: false, currentX: /** @type {number[]} */ ([]), currentY: /** @type {number[]} */ ([]),
};

function getSliderN() {
  const v = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="difficulty"]:checked'))?.value || 'medium';
  return v === 'easy' ? 50 : v === 'hard' ? 15 : 30;
}

function scoreGuess(error) {
  if (error <= 0.05) return { grade: 'excellent', points: 10, label: 'Excellent!' };
  if (error <= 0.10) return { grade: 'good', points: 7, label: 'Good!' };
  if (error <= 0.20) return { grade: 'ok', points: 3, label: 'OK' };
  return { grade: 'miss', points: 0, label: 'Miss' };
}

function sliderNewRound() {
  const s = sliderState;
  s.submitted = false;
  s.round++;

  const data = generateData(getSliderN(), pickTargetR());
  s.currentX = data.x; s.currentY = data.y;
  s.trueR = data.actualR;

  drawScatter(chartContainer, s.currentX, s.currentY);

  guessSlider.value = '0'; guessSlider.disabled = false;
  guessDisplay.textContent = '0.00';
  btnSubmit.style.display = ''; btnSubmit.disabled = false;
  btnNext.style.display = 'none';
  feedbackEl.className = 'feedback hidden'; feedbackEl.textContent = '';
  roundNum.textContent = String(s.round);

  announce(`Round ${s.round}. Look at the scatterplot and guess the correlation.`);
  guessSlider.focus();
}

function sliderSubmit() {
  const s = sliderState;
  if (s.submitted) return;
  s.submitted = true;

  const guess = Number(guessSlider.value) / 100;
  const error = Math.abs(guess - s.trueR);
  const result = scoreGuess(error);

  s.totalError += error;
  s.totalScore += result.points;
  if (error <= 0.10) { s.streak++; if (s.streak > s.bestStreak) s.bestStreak = s.streak; }
  else s.streak = 0;

  avgErrorEl.textContent = (s.totalError / s.round).toFixed(2);
  bestStreakEl.textContent = String(s.bestStreak);
  totalScoreEl.textContent = String(s.totalScore);

  feedbackEl.className = `feedback ${result.grade}`;
  feedbackEl.textContent =
    `${result.label} — You guessed ${guess.toFixed(2)}, actual r = ${s.trueR.toFixed(3)} ` +
    `(off by ${error.toFixed(3)}, +${result.points} pts)`;

  const dot = document.createElement('span');
  dot.className = `history-dot ${result.grade}`;
  dot.title = `Round ${s.round}: guessed ${guess.toFixed(2)}, actual ${s.trueR.toFixed(3)}`;
  dot.setAttribute('aria-label', dot.title);
  historyBar.appendChild(dot);

  drawScatter(chartContainer, s.currentX, s.currentY, { showR: true, showLine: true, actualR: s.trueR });

  guessSlider.disabled = true;
  btnSubmit.style.display = 'none'; btnNext.style.display = '';
  btnNext.focus();

  announce(`${result.label}. You guessed ${guess.toFixed(2)}, actual ${s.trueR.toFixed(3)}.`);
}

guessSlider.addEventListener('input', () => {
  guessDisplay.textContent = (Number(guessSlider.value) / 100).toFixed(2);
});
btnSubmit.addEventListener('click', sliderSubmit);
btnNext.addEventListener('click', sliderNewRound);

for (const r of document.querySelectorAll('input[name="difficulty"]')) {
  r.addEventListener('change', () => {
    Object.assign(sliderState, { round: 0, totalError: 0, totalScore: 0, streak: 0, bestStreak: 0 });
    avgErrorEl.textContent = '\u2014'; bestStreakEl.textContent = '0'; totalScoreEl.textContent = '0';
    historyBar.innerHTML = '';
    sliderNewRound();
  });
}


// ═══════════════════════════════════════════════════════════════
// MATCH MODE
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
/** @type {number[]} */
let matchRValues = [];
/** @type {Map<number, number>} plotIndex → rValueIndex in matchRValues */
let matchAssignments = new Map();
let matchSelectedPlot = -1;
let matchRound = 0;
let matchCorrectCount = 0;
let matchTotalCount = 0;
let matchRevealed = false;

function getMatchN() {
  const v = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="match-difficulty"]:checked'))?.value || 'medium';
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

  // Render r-value buttons
  rChoices.innerHTML = '';
  rWithIndex.forEach(item => {
    const btn = document.createElement('button');
    btn.className = 'r-choice';
    btn.textContent = item.r.toFixed(2);
    btn.dataset.plotIdx = String(item.origPlotIdx); // which plot this r belongs to
    btn.addEventListener('click', () => selectR(item.origPlotIdx, btn));
    rChoices.appendChild(btn);
  });

  matchFeedback.className = 'feedback hidden';
  matchFeedback.textContent = '';
  matchInstructions.innerHTML = 'Click a scatterplot, then click the matching <em>r</em> value.';
  btnMatchNext.style.display = 'none';
  matchRoundEl.textContent = String(matchRound);

  announce(`Match round ${matchRound}. Four scatterplots labeled A through D. Match each to its correlation.`);
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

  // Record: the student assigned this r (which belongs to correctPlotIdx) to matchSelectedPlot
  matchAssignments.set(matchSelectedPlot, correctPlotIdx);

  btn.classList.add('used', 'selected');

  // Mark plot as assigned
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
    matchInstructions.innerHTML = `${matchAssignments.size}/4 matched. Click another scatterplot.`;
  }
}

function checkMatch() {
  matchRevealed = true;
  let correct = 0;

  // For each plot, check if the r assigned to it actually belongs to that plot
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

for (const r of document.querySelectorAll('input[name="match-difficulty"]')) {
  r.addEventListener('change', () => {
    matchRound = 0; matchCorrectCount = 0; matchTotalCount = 0;
    matchCorrectEl.textContent = '0'; matchTotalEl.textContent = '0';
    matchHistory.innerHTML = '';
    matchNewRound();
  });
}


// ═══════════════════════════════════════════════════════════════
// MODE SWITCHING
// ═══════════════════════════════════════════════════════════════

let sliderStarted = false;
let matchStarted = false;

for (const radio of document.querySelectorAll('input[name="mode"]')) {
  radio.addEventListener('change', () => {
    const mode = /** @type {HTMLInputElement} */ (radio).value;
    sliderMode.style.display = mode === 'slider' ? '' : 'none';
    matchMode.style.display = mode === 'match' ? '' : 'none';

    if (mode === 'slider' && !sliderStarted) {
      sliderStarted = true;
      sliderNewRound();
    }
    if (mode === 'match' && !matchStarted) {
      matchStarted = true;
      matchNewRound();
    }
  });
}

// Keyboard: Enter to submit/next (slider mode only when visible)
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (sliderMode.style.display !== 'none') {
    if (!sliderState.submitted) sliderSubmit();
    else sliderNewRound();
  }
});

// ── Start ───────────────────────────────────────────────────────
sliderStarted = true;
sliderNewRound();
