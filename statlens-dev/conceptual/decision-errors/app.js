// @ts-check
/**
 * Decision Errors — simple simulation of repeated studies.
 *
 * Each study draws a sample of size n from a world that either has a real effect
 * (μ = δ) or no effect (μ = 0), runs a one-sided z-test at α = 0.05, and is
 * shown as a dot: detected (hit), missed (Type II), or — when there is no
 * effect — a false alarm (Type I). The detection rate is the test's power; the
 * false-alarm rate hovers near α. Companion to the fuller Power Lab.
 */

import { createRng } from '../../js/prng.js';
import { setJStat } from '../../js/distributions.js';
import { criticalValues, simulateStudy, isReject } from '../../js/power-sim.js';
import { announce, initKeyboardShortcuts, initPlayPause } from '../../js/page-utils.js';

// Fixed for the simple view — the dials live on the Power Lab page.
const SIGMA = 1;
const ALPHA = 0.05;
/** @type {'right'} */
const TAIL = 'right';
const DOT_CAP = 600; // max dots rendered (counts still tally beyond this)

// ─── DOM ───
const truthRadios = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="truth"]'));
const effectSelect = /** @type {HTMLSelectElement} */ (document.getElementById('effect-size'));
const effectWrap = document.getElementById('effect-size-wrap');
const nSelect = /** @type {HTMLSelectElement} */ (document.getElementById('sample-size'));
const scoreboard = /** @type {HTMLElement} */ (document.getElementById('scoreboard'));
const dotStrip = /** @type {HTMLElement} */ (document.getElementById('dot-strip'));
const stripNote = /** @type {HTMLElement} */ (document.getElementById('strip-note'));
const resultDiv = /** @type {HTMLElement} */ (document.getElementById('result-summary'));
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.gen-btn'));

// ─── State ───
let seedStr = '';
/** @type {() => number} */
let rng = () => Math.random();
let counts = { hit: 0, miss: 0, alarm: 0, correct: 0 };
let total = 0;
let critLow = -Infinity;
let critHigh = Infinity;

const EFFECT_WORD = { '0.2': 'small', '0.5': 'medium', '0.8': 'large' };

function truthHasEffect() {
  for (const r of truthRadios) if (r.checked) return r.value === 'effect';
  return true;
}
const getDelta = () => parseFloat(effectSelect.value) || 0.5;
const getN = () => parseInt(nSelect.value, 10) || 30;

// ─── URL params ───
const params = new URLSearchParams(location.search);
function applyUrlParams() {
  const t = params.get('truth');
  if (t === 'none' || t === 'effect') {
    for (const r of truthRadios) r.checked = r.value === t;
  }
  const e = params.get('effect');
  if (e && EFFECT_WORD[e]) effectSelect.value = e;
  const n = params.get('n');
  if (n && [...nSelect.options].some(o => o.value === n)) nSelect.value = n;
  const seed = params.get('seed');
  if (seed) seedStr = seed.replace(/[^\w-]/g, '').slice(0, 100);
}

// ─── Simulation ───
function reset() {
  counts = { hit: 0, miss: 0, alarm: 0, correct: 0 };
  total = 0;
  rng = seedStr ? createRng(seedStr) : createRng(Math.random().toString(36).slice(2));
  const cv = criticalValues(ALPHA, getN(), SIGMA, TAIL);
  critLow = cv.critLow;
  critHigh = cv.critHigh;
  dotStrip.innerHTML = '';
  if (effectWrap) effectWrap.hidden = !truthHasEffect();
  resetBtn.hidden = true;
  render(true);
}

/** @param {number} count */
function runStudies(count) {
  const hasEffect = truthHasEffect();
  const trueMu = hasEffect ? getDelta() : 0;
  const n = getN();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const { xbar } = simulateStudy(rng, trueMu, SIGMA, n);
    const reject = isReject(xbar, critLow, critHigh, TAIL);
    /** @type {'hit'|'miss'|'alarm'|'correct'} */
    let kind;
    if (hasEffect) kind = reject ? 'hit' : 'miss';
    else kind = reject ? 'alarm' : 'correct';
    counts[kind]++;
    total++;
    if (dotStrip.childElementCount < DOT_CAP) {
      const dot = document.createElement('span');
      dot.className = `study-dot ${kind}`;
      if (kind === 'alarm') dot.textContent = '✗';
      dot.setAttribute('aria-hidden', 'true');
      frag.appendChild(dot);
    }
  }
  dotStrip.appendChild(frag);
  resetBtn.hidden = false;
  render(false);
  announce(`Ran ${count} ${count === 1 ? 'study' : 'studies'}. Total ${total}.`);
}

// ─── Rendering ───
function pct(x) { return total ? (100 * x / total).toFixed(1) : '0.0'; }

/** @param {boolean} empty */
function render(empty) {
  const hasEffect = truthHasEffect();

  // Scoreboard
  if (hasEffect) {
    scoreboard.innerHTML = `
      <div class="score-box">
        <div class="score-head"><span class="swatch hit"></span> Detected the effect</div>
        <div class="score-value">${counts.hit}</div>
        <div class="score-sub">${pct(counts.hit)}% of studies — this is the test's power</div>
      </div>
      <div class="score-box">
        <div class="score-head"><span class="swatch miss"></span> Missed it (Type II error)</div>
        <div class="score-value">${counts.miss}</div>
        <div class="score-sub">${pct(counts.miss)}% missed a real effect</div>
      </div>`;
  } else {
    scoreboard.innerHTML = `
      <div class="score-box">
        <div class="score-head"><span class="swatch alarm"></span> False alarm (Type I error)</div>
        <div class="score-value">${counts.alarm}</div>
        <div class="score-sub">${pct(counts.alarm)}% &ldquo;found&rdquo; an effect that isn't there</div>
      </div>
      <div class="score-box">
        <div class="score-head"><span class="swatch correct"></span> Correctly found nothing</div>
        <div class="score-value">${counts.correct}</div>
        <div class="score-sub">${pct(counts.correct)}% of studies</div>
      </div>`;
  }

  // Dot strip aria + overflow note
  const shown = Math.min(total, DOT_CAP);
  dotStrip.setAttribute('aria-label', empty
    ? 'No studies run yet.'
    : (hasEffect
        ? `${total} studies: ${counts.hit} detected the effect, ${counts.miss} missed it.`
        : `${total} studies: ${counts.alarm} false alarms, ${counts.correct} correctly found nothing.`));
  stripNote.textContent = total > DOT_CAP ? `Showing the first ${DOT_CAP} of ${total} studies.` : '';

  // Interpretation
  if (empty || total === 0) {
    resultDiv.innerHTML = '<p class="placeholder">Choose a setup and click <strong>+100</strong> to run studies.</p>';
    return;
  }
  const n = getN();
  if (hasEffect) {
    const word = EFFECT_WORD[effectSelect.value] || 'medium';
    resultDiv.innerHTML =
      `<p>Across <span class="big">${total}</span> studies of a <strong>${word}</strong> real effect with <strong>n&nbsp;=&nbsp;${n}</strong>, ` +
      `<span class="big">${pct(counts.hit)}%</span> detected it and <span class="big">${pct(counts.miss)}%</span> missed it (Type II errors). ` +
      `That detection rate is the test's <strong>power</strong>. Try a larger effect or a bigger sample and watch power climb; shrink them and more real effects slip through.</p>`;
  } else {
    resultDiv.innerHTML =
      `<p>There is <strong>no real effect</strong>, yet <span class="big">${pct(counts.alarm)}%</span> of these <span class="big">${total}</span> studies still flagged one — ` +
      `<strong>false alarms</strong> (Type I errors). This rate stays near <strong>5%</strong> (the significance level α), no matter how large the sample. ` +
      `Switch to <em>Real effect</em> to see the other kind of mistake.</p>`;
  }
}

// ─── Wiring ───
for (const btn of genBtns) {
  btn.addEventListener('click', () => runStudies(parseInt(btn.dataset.count || '1', 10)));
}
resetBtn.addEventListener('click', reset);
for (const r of truthRadios) r.addEventListener('change', reset);
effectSelect.addEventListener('change', reset);
nSelect.addEventListener('change', reset);

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// jStat powers the critical-value math; load it, then start.
import('jstat').then((jstat) => {
  setJStat(/** @type {any} */ (jstat).default || jstat);
  applyUrlParams();
  reset();
});
