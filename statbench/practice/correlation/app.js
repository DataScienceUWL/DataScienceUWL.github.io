// @ts-check
/**
 * Guess the Correlation — interactive game.
 * Generates scatterplots with known correlation, students guess r.
 */

import * as d3Selection from 'd3-selection';
import * as d3Scale from 'd3-scale';
import * as d3Array from 'd3-array';
import * as d3Axis from 'd3-axis';

// ── DOM references ──────────────────────────────────────────────
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
const announceEl = /** @type {HTMLElement} */ (document.getElementById('sr-announce'));

// ── State ───────────────────────────────────────────────────────
let trueR = 0;
let round = 0;
let totalError = 0;
let totalScore = 0;
let streak = 0;
let bestStreak = 0;
let submitted = false;

// ── Announce for screen readers ─────────────────────────────────
function announce(msg) {
  if (announceEl) announceEl.textContent = msg;
}

// ── Difficulty ──────────────────────────────────────────────────
function getSampleSize() {
  const checked = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="difficulty"]:checked')
  );
  const val = checked?.value || 'medium';
  return val === 'easy' ? 50 : val === 'hard' ? 15 : 30;
}

// ── Generate bivariate data with target correlation ─────────────
/**
 * Generate n points with approximately the target correlation.
 * Uses the Cholesky decomposition approach:
 *   x = z1
 *   y = r * z1 + sqrt(1 - r^2) * z2
 * where z1, z2 are independent standard normals.
 *
 * @param {number} n - sample size
 * @param {number} targetR - target correlation (-1 to 1)
 * @returns {{ x: number[], y: number[], actualR: number }}
 */
function generateData(n, targetR) {
  const z1 = [], z2 = [];
  for (let i = 0; i < n; i++) {
    z1.push(randNormal());
    z2.push(randNormal());
  }

  const rClamped = Math.max(-0.999, Math.min(0.999, targetR));
  const x = z1.slice();
  const y = z1.map((v, i) => rClamped * v + Math.sqrt(1 - rClamped * rClamped) * z2[i]);

  // Compute actual sample r
  const mx = mean(x), my = mean(y);
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  const actualR = num / Math.sqrt(dx2 * dy2);

  return { x, y, actualR };
}

/** Box-Muller transform for standard normal random variates. */
function randNormal() {
  let u, v, s;
  do {
    u = Math.random() * 2 - 1;
    v = Math.random() * 2 - 1;
    s = u * u + v * v;
  } while (s >= 1 || s === 0);
  return u * Math.sqrt(-2 * Math.log(s) / s);
}

/** @param {number[]} arr */
function mean(arr) {
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

// ── Choose a target r ───────────────────────────────────────────
/**
 * Pick a random target r that's interesting for learning.
 * Avoids very small correlations being overrepresented.
 */
function pickTargetR() {
  // Mix of different ranges to keep it interesting
  const ranges = [
    [-0.95, -0.70],  // strong negative
    [-0.70, -0.40],  // moderate negative
    [-0.40, -0.10],  // weak negative
    [-0.10, 0.10],   // near zero
    [0.10, 0.40],    // weak positive
    [0.40, 0.70],    // moderate positive
    [0.70, 0.95],    // strong positive
  ];
  const range = ranges[Math.floor(Math.random() * ranges.length)];
  return range[0] + Math.random() * (range[1] - range[0]);
}

// ── Draw scatterplot ────────────────────────────────────────────
/**
 * @param {number[]} x
 * @param {number[]} y
 * @param {{ showR?: boolean, showLine?: boolean, actualR?: number }} [opts]
 */
function drawScatter(x, y, opts = {}) {
  chartContainer.innerHTML = '';

  const margin = { top: 20, right: 20, bottom: 20, left: 20 };
  const size = 400;
  const w = size - margin.left - margin.right;
  const h = size - margin.top - margin.bottom;

  const svg = d3Selection.select(chartContainer)
    .append('svg')
    .attr('viewBox', `0 0 ${size} ${size}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Add accessible title + desc
  svg.append('title').text('Scatterplot — guess the correlation');
  svg.append('desc').text(
    opts.showR
      ? `Scatterplot with correlation r = ${opts.actualR?.toFixed(3)}`
      : `Scatterplot of ${x.length} points. Guess the correlation coefficient.`
  );

  const g = svg.append('g')
    .attr('transform', `translate(${margin.left},${margin.top})`);

  // Compute symmetric domain so plot is square and unbiased
  const allVals = [...x, ...y];
  const ext = d3Array.extent(allVals);
  const pad = (/** @type {number} */ (ext[1]) - /** @type {number} */ (ext[0])) * 0.12;
  const lo = /** @type {number} */ (ext[0]) - pad;
  const hi = /** @type {number} */ (ext[1]) + pad;

  const xScale = d3Scale.scaleLinear().domain([lo, hi]).range([0, w]);
  const yScale = d3Scale.scaleLinear().domain([lo, hi]).range([h, 0]);

  // Light grid
  g.append('rect')
    .attr('width', w).attr('height', h)
    .attr('fill', '#fafbfc').attr('stroke', '#e0e0e0');

  // Points
  const dotColor = opts.showR ? '#999' : 'var(--ims-blue, #569BBD)';
  for (let i = 0; i < x.length; i++) {
    g.append('circle')
      .attr('cx', xScale(x[i]))
      .attr('cy', yScale(y[i]))
      .attr('r', 5)
      .attr('fill', dotColor)
      .attr('opacity', 0.7)
      .attr('stroke', 'white')
      .attr('stroke-width', 0.5);
  }

  // Show regression line after reveal
  if (opts.showLine) {
    const mx = mean(x), my_ = mean(y);
    let num = 0, denom = 0;
    for (let i = 0; i < x.length; i++) {
      num += (x[i] - mx) * (y[i] - my_);
      denom += (x[i] - mx) * (x[i] - mx);
    }
    const slope = denom === 0 ? 0 : num / denom;
    const intercept = my_ - slope * mx;

    const x0 = lo, x1 = hi;
    const y0 = intercept + slope * x0;
    const y1 = intercept + slope * x1;

    g.append('line')
      .attr('x1', xScale(x0)).attr('y1', yScale(y0))
      .attr('x2', xScale(x1)).attr('y2', yScale(y1))
      .attr('stroke', '#F05133')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 3')
      .attr('opacity', 0.8);
  }

  // Show r value after reveal
  if (opts.showR && opts.actualR != null) {
    g.append('text')
      .attr('x', w - 8).attr('y', 20)
      .attr('text-anchor', 'end')
      .attr('font-size', '16px')
      .attr('font-weight', '700')
      .attr('fill', '#F05133')
      .text(`r = ${opts.actualR.toFixed(3)}`);
  }
}

// No axes intentionally — axes can give away slope/scale cues that
// let students compute r from the regression line rather than
// building visual intuition.

// ── Scoring ─────────────────────────────────────────────────────
/**
 * @param {number} error - absolute error |guess - actual|
 * @returns {{ grade: string, points: number, label: string }}
 */
function scoreGuess(error) {
  if (error <= 0.05) return { grade: 'excellent', points: 10, label: 'Excellent!' };
  if (error <= 0.10) return { grade: 'good', points: 7, label: 'Good!' };
  if (error <= 0.20) return { grade: 'ok', points: 3, label: 'OK' };
  return { grade: 'miss', points: 0, label: 'Miss' };
}

// ── Game flow ───────────────────────────────────────────────────
let currentX = /** @type {number[]} */ ([]);
let currentY = /** @type {number[]} */ ([]);

function newRound() {
  submitted = false;
  round++;
  trueR = pickTargetR();

  const n = getSampleSize();
  const data = generateData(n, trueR);
  currentX = data.x;
  currentY = data.y;
  trueR = data.actualR; // use the actual sample r, not the target

  drawScatter(currentX, currentY);

  // Reset controls
  guessSlider.value = '0';
  guessSlider.disabled = false;
  guessDisplay.textContent = '0.00';
  btnSubmit.style.display = '';
  btnSubmit.disabled = false;
  btnNext.style.display = 'none';
  feedbackEl.className = 'feedback hidden';
  feedbackEl.textContent = '';

  roundNum.textContent = String(round);

  announce(`Round ${round}. Look at the scatterplot and guess the correlation.`);
  guessSlider.focus();
}

function submitGuess() {
  if (submitted) return;
  submitted = true;

  const guess = Number(guessSlider.value) / 100;
  const error = Math.abs(guess - trueR);
  const result = scoreGuess(error);

  totalError += error;
  totalScore += result.points;

  // Streak
  if (error <= 0.10) {
    streak++;
    if (streak > bestStreak) bestStreak = streak;
  } else {
    streak = 0;
  }

  // Update display
  avgErrorEl.textContent = (totalError / round).toFixed(2);
  bestStreakEl.textContent = String(bestStreak);
  totalScoreEl.textContent = String(totalScore);

  // Feedback
  feedbackEl.className = `feedback ${result.grade}`;
  feedbackEl.textContent =
    `${result.label} — You guessed ${guess.toFixed(2)}, actual r = ${trueR.toFixed(3)} ` +
    `(off by ${error.toFixed(3)}, +${result.points} pts)`;

  // History dot
  const dot = document.createElement('span');
  dot.className = `history-dot ${result.grade}`;
  dot.title = `Round ${round}: guessed ${guess.toFixed(2)}, actual ${trueR.toFixed(3)}`;
  dot.setAttribute('aria-label', dot.title);
  historyBar.appendChild(dot);

  // Reveal on chart
  drawScatter(currentX, currentY, { showR: true, showLine: true, actualR: trueR });

  // Switch buttons
  guessSlider.disabled = true;
  btnSubmit.style.display = 'none';
  btnNext.style.display = '';
  btnNext.focus();

  announce(
    `${result.label}. You guessed ${guess.toFixed(2)}. ` +
    `The actual correlation was ${trueR.toFixed(3)}. ` +
    `Off by ${error.toFixed(3)}. Plus ${result.points} points.`
  );
}

// ── Event listeners ─────────────────────────────────────────────

guessSlider.addEventListener('input', () => {
  const val = Number(guessSlider.value) / 100;
  guessDisplay.textContent = val.toFixed(2);
});

btnSubmit.addEventListener('click', submitGuess);
btnNext.addEventListener('click', newRound);

// Keyboard: Enter to submit/next
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    if (!submitted) submitGuess();
    else newRound();
  }
});

// Difficulty change resets game
for (const radio of document.querySelectorAll('input[name="difficulty"]')) {
  radio.addEventListener('change', () => {
    // Reset scores
    round = 0;
    totalError = 0;
    totalScore = 0;
    streak = 0;
    bestStreak = 0;
    avgErrorEl.textContent = '\u2014';
    bestStreakEl.textContent = '0';
    totalScoreEl.textContent = '0';
    historyBar.innerHTML = '';
    newRound();
  });
}

// ── Start ───────────────────────────────────────────────────────
newRound();
