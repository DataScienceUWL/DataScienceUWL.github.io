// @ts-check
/**
 * Power Lab — fuller simulation of repeated z-tests.
 *
 * Draws studies from H1: μ = δ (or H0: μ = 0 when δ = 0), runs a one-sample
 * known-σ z-test, and shows: the empirical reject-rate converging to the
 * analytic power, a hit/miss/false-alarm strip, and a "dance of the p-values"
 * of recent studies. Mirrors distribution/power/ (the theory view).
 */

import { createRng } from '../../js/prng.js';
import { setJStat } from '../../js/distributions.js';
import { analyticPower, criticalValues, simulateStudy, isReject, pValue } from '../../js/power-sim.js';
import { announce, initKeyboardShortcuts, initPlayPause } from '../../js/page-utils.js';

const DOT_CAP = 600;
const DANCE_K = 30;

// ─── DOM ───
const sliderDelta = /** @type {HTMLInputElement} */ (document.getElementById('slider-delta'));
const inputDelta = /** @type {HTMLInputElement} */ (document.getElementById('input-delta'));
const sliderSigma = /** @type {HTMLInputElement} */ (document.getElementById('slider-sigma'));
const inputSigma = /** @type {HTMLInputElement} */ (document.getElementById('input-sigma'));
const sliderN = /** @type {HTMLInputElement} */ (document.getElementById('slider-n'));
const inputN = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));
const sliderAlpha = /** @type {HTMLInputElement} */ (document.getElementById('slider-alpha'));
const inputAlpha = /** @type {HTMLInputElement} */ (document.getElementById('input-alpha'));
const tailRadios = /** @type {NodeListOf<HTMLInputElement>} */ (document.querySelectorAll('input[name="tail"]'));
const readout = /** @type {HTMLElement} */ (document.getElementById('power-readout'));
const dotStrip = /** @type {HTMLElement} */ (document.getElementById('dot-strip'));
const stripNote = /** @type {HTMLElement} */ (document.getElementById('strip-note'));
const danceSvg = /** @type {SVGSVGElement} */ (/** @type {unknown} */ (document.getElementById('dance-svg')));
const resultDiv = /** @type {HTMLElement} */ (document.getElementById('result-summary'));
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('.gen-btn'));
const theoryLink = /** @type {HTMLAnchorElement} */ (document.getElementById('theory-link'));

// ─── State ───
let seedStr = '';
/** @type {() => number} */
let rng = () => Math.random();
let counts = { hit: 0, miss: 0, alarm: 0, correct: 0 };
let total = 0;
let critLow = -Infinity, critHigh = Infinity;
/** @type {{p:number, sig:boolean}[]} */
let recentP = [];

const NS = 'http://www.w3.org/2000/svg';

function getParams() {
  return {
    delta: parseFloat(inputDelta.value) || 0,
    sigma: Math.max(0.01, parseFloat(inputSigma.value) || 1),
    n: Math.max(2, Math.round(parseFloat(inputN.value) || 30)),
    alpha: Math.min(0.5, Math.max(0.0001, parseFloat(inputAlpha.value) || 0.05)),
  };
}
/** @returns {'left'|'right'|'both'} */
function getTail() {
  for (const r of tailRadios) if (r.checked) return /** @type {any} */ (r.value);
  return 'right';
}

// ─── URL params ───
const params = new URLSearchParams(location.search);
function applyUrlParams() {
  const set = (input, slider, key, isInt = false) => {
    if (!params.has(key)) return;
    let v = parseFloat(params.get(key) || '');
    if (!isFinite(v)) return;
    if (isInt) v = Math.round(v);
    input.value = slider.value = String(v);
  };
  set(inputDelta, sliderDelta, 'delta');
  set(inputSigma, sliderSigma, 'sigma');
  set(inputN, sliderN, 'n', true);
  set(inputAlpha, sliderAlpha, 'alpha');
  const tail = params.get('tail');
  if (tail) for (const r of tailRadios) r.checked = r.value === tail;
  const seed = params.get('seed');
  if (seed) seedStr = seed.replace(/[^\w-]/g, '').slice(0, 100);
}

// ─── Simulation ───
function reset() {
  counts = { hit: 0, miss: 0, alarm: 0, correct: 0 };
  total = 0;
  recentP = [];
  rng = seedStr ? createRng(seedStr) : createRng(Math.random().toString(36).slice(2));
  const p = getParams();
  const cv = criticalValues(p.alpha, p.n, p.sigma, getTail());
  critLow = cv.critLow; critHigh = cv.critHigh;
  dotStrip.innerHTML = '';
  resetBtn.hidden = true;
  updateTheoryLink();
  render(true);
  renderDance();
}

/** @param {number} count */
function runStudies(count) {
  const p = getParams();
  const tail = getTail();
  const hasEffect = p.delta !== 0;
  const frag = document.createDocumentFragment();
  for (let i = 0; i < count; i++) {
    const { xbar, z } = simulateStudy(rng, p.delta, p.sigma, p.n);
    const reject = isReject(xbar, critLow, critHigh, tail);
    /** @type {'hit'|'miss'|'alarm'|'correct'} */
    let kind;
    if (hasEffect) kind = reject ? 'hit' : 'miss';
    else kind = reject ? 'alarm' : 'correct';
    counts[kind]++; total++;
    recentP.push({ p: pValue(z, tail), sig: reject });
    if (recentP.length > DANCE_K) recentP.shift();
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
  renderDance();
  announce(`Ran ${count} ${count === 1 ? 'study' : 'studies'}. Total ${total}.`);
}

// ─── Rendering ───
const fmtPct = (x) => total ? (100 * x / total).toFixed(1) : '0.0';

/** @param {boolean} empty */
function render(empty) {
  const p = getParams();
  const tail = getTail();
  const hasEffect = p.delta !== 0;
  const theory = analyticPower(p, tail);
  const rejects = counts.hit + counts.alarm;
  const empRate = total ? rejects / total : 0;

  const empLabel = hasEffect ? 'Empirical power' : 'Empirical false-alarm rate';
  const theoryLabel = hasEffect ? 'Theoretical power (1−β)' : 'Significance level α';
  const theoryVal = hasEffect ? theory.power : p.alpha;

  readout.innerHTML = `
    <div class="readout-box">
      <div class="rb-head">${empLabel}</div>
      <div class="rb-value">${(empRate * 100).toFixed(1)}%</div>
      <div class="rb-sub">${rejects} of ${total} studies rejected H₀</div>
    </div>
    <div class="readout-box theory">
      <div class="rb-head">${theoryLabel}</div>
      <div class="rb-value">${(theoryVal * 100).toFixed(1)}%</div>
      <div class="rb-sub">${hasEffect ? `β = ${(theory.beta * 100).toFixed(1)}% (Type II)` : 'the long-run false-positive rate'}</div>
    </div>`;

  const shown = Math.min(total, DOT_CAP);
  dotStrip.setAttribute('aria-label', empty ? 'No studies run yet.'
    : (hasEffect
        ? `${total} studies: ${counts.hit} detected the effect, ${counts.miss} missed it.`
        : `${total} studies: ${counts.alarm} false alarms, ${counts.correct} correctly found nothing.`));
  stripNote.textContent = total > DOT_CAP ? `Showing the first ${DOT_CAP} of ${total} studies.` : '';

  if (empty || total === 0) {
    resultDiv.innerHTML = '<p class="placeholder">Set the parameters and click <strong>+100</strong> to run studies.</p>';
    return;
  }
  if (hasEffect) {
    resultDiv.innerHTML =
      `<p>Across <span class="big">${total}</span> studies, <span class="big">${(empRate * 100).toFixed(1)}%</span> rejected H₀ — ` +
      `the empirical <strong>power</strong>, converging to the theoretical <span class="big">${(theory.power * 100).toFixed(1)}%</span>. ` +
      `The remaining ${(counts.miss / total * 100).toFixed(1)}% missed a real effect (Type II errors, β = ${(theory.beta * 100).toFixed(1)}%). ` +
      `Increase δ or n, or loosen α, and power rises.</p>`;
  } else {
    resultDiv.innerHTML =
      `<p>With δ = 0 there is <strong>no effect</strong>, so every rejection is a <strong>false alarm</strong> (Type I error). ` +
      `<span class="big">${(empRate * 100).toFixed(1)}%</span> of ${total} studies rejected H₀, hovering near α = <span class="big">${(p.alpha * 100).toFixed(1)}%</span> — ` +
      `and it stays there no matter how large n is.</p>`;
  }
}

function renderDance() {
  const W = 600, H = 150, mL = 38, mR = 10, mT = 12, mB = 18;
  const p = getParams();
  const alpha = p.alpha;
  const innerW = W - mL - mR, innerH = H - mT - mB;
  const yOf = (pv) => mT + innerH * (1 - Math.min(1, Math.max(0, pv))); // p=0 bottom, p=1 top
  const xOf = (i) => mL + (DANCE_K <= 1 ? innerW / 2 : innerW * i / (DANCE_K - 1));
  const hasEffect = p.delta !== 0;
  const sigColor = hasEffect ? '#0072B2' : '#D55E00';

  let svg = '';
  // axis frame
  svg += `<line x1="${mL}" y1="${mT}" x2="${mL}" y2="${H - mB}" stroke="#bbb"/>`;
  svg += `<line x1="${mL}" y1="${H - mB}" x2="${W - mR}" y2="${H - mB}" stroke="#bbb"/>`;
  // y ticks 0 / 0.5 / 1
  for (const t of [0, 0.5, 1]) {
    const y = yOf(t);
    svg += `<text x="${mL - 6}" y="${y + 3}" text-anchor="end" font-size="10" fill="#777">${t.toFixed(1)}</text>`;
  }
  svg += `<text x="10" y="${mT + innerH / 2}" text-anchor="middle" font-size="10" fill="#777" transform="rotate(-90 10 ${mT + innerH / 2})">p-value</text>`;
  // alpha line
  const yA = yOf(alpha);
  svg += `<line x1="${mL}" y1="${yA}" x2="${W - mR}" y2="${yA}" stroke="#D55E00" stroke-width="1.3" stroke-dasharray="5,3"/>`;
  svg += `<text x="${W - mR}" y="${yA - 4}" text-anchor="end" font-size="10" fill="#D55E00">α = ${alpha}</text>`;
  // points
  recentP.forEach((d, i) => {
    const cx = xOf(i), cy = yOf(d.p);
    const fill = d.sig ? sigColor : '#9aa6ad';
    svg += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="4" fill="${fill}"/>`;
  });
  danceSvg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  danceSvg.innerHTML = svg;
  const nSig = recentP.filter(d => d.sig).length;
  danceSvg.setAttribute('aria-label',
    recentP.length ? `${nSig} of the last ${recentP.length} studies reached significance (p below α = ${alpha}).`
                   : 'No studies run yet.');
}

function updateTheoryLink() {
  const p = getParams();
  theoryLink.href = `../../distribution/power/?delta=${p.delta}&sigma=${p.sigma}&n=${p.n}&alpha=${p.alpha}&tail=${getTail()}`;
}

// ─── Wiring ───
let resetTimer = 0;
function scheduleReset() { clearTimeout(resetTimer); resetTimer = window.setTimeout(reset, 80); }

/** Slider ↔ number-input sync; any change resets the run. */
function syncPair(slider, input, isInt = false) {
  slider.addEventListener('input', () => { input.value = slider.value; scheduleReset(); });
  input.addEventListener('input', () => {
    let v = parseFloat(input.value);
    if (!isFinite(v)) return;
    if (isInt) v = Math.round(v);
    const lo = parseFloat(slider.min), hi = parseFloat(slider.max);
    slider.value = String(Math.min(hi, Math.max(lo, v)));
    scheduleReset();
  });
}
syncPair(sliderDelta, inputDelta);
syncPair(sliderSigma, inputSigma);
syncPair(sliderN, inputN, true);
syncPair(sliderAlpha, inputAlpha);
for (const r of tailRadios) r.addEventListener('change', reset);

for (const btn of genBtns) btn.addEventListener('click', () => runStudies(parseInt(btn.dataset.count || '1', 10)));
resetBtn.addEventListener('click', reset);

initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

import('jstat').then((jstat) => {
  setJStat(/** @type {any} */ (jstat).default || jstat);
  applyUrlParams();
  reset();
});
