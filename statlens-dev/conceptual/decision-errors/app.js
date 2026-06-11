// @ts-check
/**
 * Decision Errors — simulation of repeated one-proportion studies.
 *
 * Each study draws n Bernoulli(pTrue) trials and runs a one-sided z-test of
 * H0: p = 0.50 ("the treatment does nothing") vs Ha: p > 0.50. The student sets
 * whether H0 or Ha is actually true (and, under Ha, the true success rate), the
 * sample size, and α. Each study is a dot: detected the effect (hit), missed it
 * (Type II), or — when H0 is true — a false alarm (Type I). The detection rate
 * is the test's power; the false-alarm rate hovers near α.
 *
 * Activity-ready: waits for window.__activityParamsReady so ?activity= JSON
 * default params land before the URL is read (REQ-020 pattern).
 */

import { createRng } from '../../js/prng.js';
import { setJStat } from '../../js/distributions.js';
import { zCritical, proportionStudy, isRejectZ } from '../../js/power-sim.js';
import { announce, initKeyboardShortcuts, initPlayPause } from '../../js/page-utils.js';

const P0 = 0.5;
/** @type {'right'} */
const TAIL = 'right';
const DOT_CAP = 600;

// ─── DOM ───
const truthRadios = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="truth"]'));
const trueRate = /** @type {HTMLInputElement} */ (document.getElementById('true-rate'));
const trueRateVal = /** @type {HTMLElement} */ (document.getElementById('true-rate-val'));
const trueRateWrap = /** @type {HTMLElement} */ (document.getElementById('true-rate-wrap'));
const nSelect = /** @type {HTMLSelectElement} */ (document.getElementById('sample-size'));
const alphaSelect = /** @type {HTMLSelectElement} */ (document.getElementById('alpha-select'));
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
let zLow = -Infinity, zHigh = Infinity;

function truthHasEffect() {
  for (const r of truthRadios) if (r.checked) return r.value === 'effect';
  return true;
}
const getN = () => parseInt(nSelect.value, 10) || 30;
const getAlpha = () => parseFloat(alphaSelect.value) || 0.05;
const getTrueRate = () => parseInt(trueRate.value, 10) / 100;

// ─── URL params (read AFTER activity defaults are injected) ───
function applyUrlParams() {
  const params = new URLSearchParams(location.search);
  const t = params.get('truth');
  if (t === 'none' || t === 'effect') for (const r of truthRadios) r.checked = r.value === t;
  const pt = params.get('ptrue');
  if (pt != null) {
    const v = Math.round(parseFloat(pt));
    if (isFinite(v) && v >= 50 && v <= 95) trueRate.value = String(v);
  }
  const n = params.get('n');
  if (n && [...nSelect.options].some(o => o.value === n)) nSelect.value = n;
  const a = params.get('alpha');
  if (a && [...alphaSelect.options].some(o => o.value === a)) alphaSelect.value = a;
  const seed = params.get('seed');
  if (seed) seedStr = seed.replace(/[^\w-]/g, '').slice(0, 100);
}

// ─── Simulation ───
function reset() {
  counts = { hit: 0, miss: 0, alarm: 0, correct: 0 };
  total = 0;
  rng = seedStr ? createRng(seedStr) : createRng(Math.random().toString(36).slice(2));
  const cv = zCritical(getAlpha(), TAIL);
  zLow = cv.zLow; zHigh = cv.zHigh;
  trueRateVal.textContent = `${trueRate.value}%`;
  trueRateWrap.hidden = !truthHasEffect();
  dotStrip.innerHTML = '';
  resetBtn.hidden = true;
  render(true);
}

/** @param {number} count */
function runStudies(count) {
  const hasEffect = truthHasEffect();
  const pTrue = hasEffect ? getTrueRate() : P0;
  const n = getN();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const { z } = proportionStudy(rng, pTrue, n, P0);
    const reject = isRejectZ(z, zLow, zHigh, TAIL);
    /** @type {'hit'|'miss'|'alarm'|'correct'} */
    let kind;
    if (hasEffect) kind = reject ? 'hit' : 'miss';
    else kind = reject ? 'alarm' : 'correct';
    counts[kind]++; total++;
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
const pct = (x) => total ? (100 * x / total).toFixed(1) : '0.0';

/** @param {boolean} empty */
function render(empty) {
  const hasEffect = truthHasEffect();

  if (hasEffect) {
    scoreboard.innerHTML = `
      <div class="score-box">
        <div class="score-head"><span class="swatch hit"></span> Correctly rejected H₀ (detected)</div>
        <div class="score-value">${counts.hit}</div>
        <div class="score-sub">${pct(counts.hit)}% of studies — this is the power</div>
      </div>
      <div class="score-box">
        <div class="score-head"><span class="swatch miss"></span> Type II error (missed it)</div>
        <div class="score-value">${counts.miss}</div>
        <div class="score-sub">${pct(counts.miss)}% failed to reject a false H₀</div>
      </div>`;
  } else {
    scoreboard.innerHTML = `
      <div class="score-box">
        <div class="score-head"><span class="swatch alarm"></span> Type I error (false alarm)</div>
        <div class="score-value">${counts.alarm}</div>
        <div class="score-sub">${pct(counts.alarm)}% rejected a true H₀</div>
      </div>
      <div class="score-box">
        <div class="score-head"><span class="swatch correct"></span> Correctly retained H₀</div>
        <div class="score-value">${counts.correct}</div>
        <div class="score-sub">${pct(counts.correct)}% of studies</div>
      </div>`;
  }

  dotStrip.setAttribute('aria-label', empty ? 'No studies run yet.'
    : (hasEffect
        ? `${total} studies: ${counts.hit} detected the effect, ${counts.miss} missed it (Type II).`
        : `${total} studies: ${counts.alarm} false alarms (Type I), ${counts.correct} correctly retained H₀.`));
  stripNote.textContent = total > DOT_CAP ? `Showing the first ${DOT_CAP} of ${total} studies.` : '';

  if (empty || total === 0) {
    resultDiv.innerHTML = '<p class="placeholder">Choose what\'s true and click <strong>+100</strong> to run studies.</p>';
    return;
  }
  const n = getN(), a = (getAlpha() * 100).toFixed(0);
  if (hasEffect) {
    resultDiv.innerHTML =
      `<p>The treatment truly works <strong>${trueRate.value}%</strong> of the time. Across <span class="big">${total}</span> studies (n&nbsp;=&nbsp;${n}, α&nbsp;=&nbsp;${getAlpha()}), ` +
      `<span class="big">${pct(counts.hit)}%</span> correctly rejected H₀ — the test's <strong>power</strong> — and <span class="big">${pct(counts.miss)}%</span> made a <strong>Type II error</strong> (missed a real effect). ` +
      `Raise the true success rate or n and power climbs; shrink them and more real effects slip through.</p>`;
  } else {
    resultDiv.innerHTML =
      `<p>The treatment truly <strong>does nothing</strong> (p = 0.50), yet <span class="big">${pct(counts.alarm)}%</span> of these <span class="big">${total}</span> studies still rejected H₀ — ` +
      `<strong>Type I errors</strong> (false alarms). This rate stays near <strong>α = ${a}%</strong> no matter how large n is. Lower α to make false alarms rarer (but watch Type II errors rise once there's a real effect).</p>`;
  }
}

// ─── Wiring ───
for (const btn of genBtns) btn.addEventListener('click', () => runStudies(parseInt(btn.dataset.count || '1', 10)));
resetBtn.addEventListener('click', reset);
for (const r of truthRadios) r.addEventListener('change', reset);
trueRate.addEventListener('input', () => { trueRateVal.textContent = `${trueRate.value}%`; reset(); });
nSelect.addEventListener('change', reset);
alphaSelect.addEventListener('change', reset);

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// jStat powers the critical-value math; wait for activity params, then start.
import('jstat').then(async (jstat) => {
  setJStat(/** @type {any} */ (jstat).default || jstat);
  if (typeof window !== 'undefined' && window.__activityParamsReady) {
    try { await window.__activityParamsReady; } catch { /* ignore */ }
  }
  applyUrlParams();
  reset();
});
