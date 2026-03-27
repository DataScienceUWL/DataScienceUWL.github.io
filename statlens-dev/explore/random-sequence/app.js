// @ts-check
/**
 * "Stump the Chump" — human vs random sequence comparison.
 *
 * Students type a "random-looking" sequence of H/T, then compare it to
 * a truly random sequence. Highlights the key difference: humans avoid
 * long runs and alternate too frequently.
 *
 * URL params:
 *   ?n=30  — target sequence length (default 40, min 20, max 100)
 */

import { createRng } from '../../js/prng.js';

// ── Config from URL ──────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const TARGET_LEN = Math.max(20, Math.min(100, parseInt(params.get('n') ?? '40', 10) || 40));
const MIN_LEN = 20;

// ── DOM refs ─────────────────────────────────────────────────────────
const seqInput = /** @type {HTMLInputElement} */ (document.getElementById('seq-input'));
const charCount = /** @type {HTMLElement} */ (document.getElementById('char-count'));
const targetLenEl = /** @type {HTMLElement} */ (document.getElementById('target-len'));
const minLenEl = /** @type {HTMLElement} */ (document.getElementById('min-len'));
const btnCompare = /** @type {HTMLButtonElement} */ (document.getElementById('btn-compare'));
const btnReset = /** @type {HTMLButtonElement} */ (document.getElementById('btn-reset'));
const btnResetBottom = /** @type {HTMLButtonElement} */ (document.getElementById('btn-reset-bottom'));
const btnAddH = /** @type {HTMLButtonElement} */ (document.getElementById('btn-add-h'));
const btnAddT = /** @type {HTMLButtonElement} */ (document.getElementById('btn-add-t'));
const btnBackspace = /** @type {HTMLButtonElement} */ (document.getElementById('btn-backspace'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results'));
const displayHuman = /** @type {HTMLElement} */ (document.getElementById('display-human'));
const displayRandom = /** @type {HTMLElement} */ (document.getElementById('display-random'));
const statsBody = /** @type {HTMLElement} */ (document.getElementById('stats-body'));
const chartHuman = /** @type {HTMLElement} */ (document.getElementById('chart-human'));
const chartRandom = /** @type {HTMLElement} */ (document.getElementById('chart-random'));
const interpretation = /** @type {HTMLElement} */ (document.getElementById('interpretation'));
const announceEl = document.getElementById('sr-announce');

// ── Init ─────────────────────────────────────────────────────────────
targetLenEl.textContent = String(TARGET_LEN);
minLenEl.textContent = String(MIN_LEN);

seqInput.addEventListener('input', onInputChange);
seqInput.addEventListener('keydown', onInputKeydown);
btnCompare.addEventListener('click', compare);
btnReset.addEventListener('click', reset);
btnResetBottom.addEventListener('click', reset);
btnAddH.addEventListener('click', () => appendChar('H'));
btnAddT.addEventListener('click', () => appendChar('T'));
btnBackspace.addEventListener('click', deleteLastChar);

// ── Input handling ───────────────────────────────────────────────────
function onInputChange() {
  // Filter to only H and T
  const raw = seqInput.value.toUpperCase();
  const filtered = raw.replace(/[^HT]/g, '');
  if (filtered !== raw) {
    const pos = seqInput.selectionStart ?? filtered.length;
    seqInput.value = filtered;
    const newPos = Math.min(pos, filtered.length);
    seqInput.setSelectionRange(newPos, newPos);
  }

  const len = filtered.length;
  charCount.textContent = String(len);

  // Enable compare when we have enough
  btnCompare.disabled = len < MIN_LEN;

  // Update quick-entry button states
  const atMax = len >= TARGET_LEN;
  btnAddH.disabled = atMax;
  btnAddT.disabled = atMax;
}

/** @param {KeyboardEvent} e */
function onInputKeydown(e) {
  if (e.key === 'Enter' && !btnCompare.disabled) {
    e.preventDefault();
    compare();
  }
}

/** @param {string} ch */
function appendChar(ch) {
  if (seqInput.value.length >= TARGET_LEN) return;
  seqInput.value += ch;
  onInputChange();
  seqInput.focus();
}

function deleteLastChar() {
  if (seqInput.value.length === 0) return;
  seqInput.value = seqInput.value.slice(0, -1);
  onInputChange();
  seqInput.focus();
}

// ── Generate random sequence ─────────────────────────────────────────
/** @param {number} len */
function generateRandomSequence(len) {
  const rng = createRng(Date.now().toString());
  let seq = '';
  for (let i = 0; i < len; i++) {
    seq += rng() < 0.5 ? 'H' : 'T';
  }
  return seq;
}

// ── Sequence analysis ────────────────────────────────────────────────
/**
 * @param {string} seq — string of H and T
 * @returns {{ runs: number[], longestRun: number, numRuns: number,
 *             avgRunLength: number, alternationRate: number,
 *             propH: number, runLengthDist: Map<number, number> }}
 */
function analyzeSequence(seq) {
  if (seq.length === 0) {
    return { runs: [], longestRun: 0, numRuns: 0, avgRunLength: 0,
             alternationRate: 0, propH: 0, runLengthDist: new Map() };
  }

  /** @type {number[]} */
  const runs = [];
  let currentRun = 1;

  for (let i = 1; i < seq.length; i++) {
    if (seq[i] === seq[i - 1]) {
      currentRun++;
    } else {
      runs.push(currentRun);
      currentRun = 1;
    }
  }
  runs.push(currentRun); // final run

  const longestRun = Math.max(...runs);
  const numRuns = runs.length;
  const avgRunLength = seq.length / numRuns;

  // Alternation rate: fraction of transitions that are switches
  let switches = 0;
  for (let i = 1; i < seq.length; i++) {
    if (seq[i] !== seq[i - 1]) switches++;
  }
  const alternationRate = switches / (seq.length - 1);

  // Proportion of heads
  let hCount = 0;
  for (const ch of seq) { if (ch === 'H') hCount++; }
  const propH = hCount / seq.length;

  // Run-length distribution
  /** @type {Map<number, number>} */
  const runLengthDist = new Map();
  for (const r of runs) {
    runLengthDist.set(r, (runLengthDist.get(r) ?? 0) + 1);
  }

  return { runs, longestRun, numRuns, avgRunLength, alternationRate, propH, runLengthDist };
}

/**
 * Get run boundaries for highlighting in the display.
 * @param {string} seq
 * @returns {Array<{start: number, end: number, char: string, length: number}>}
 */
function getRunSpans(seq) {
  /** @type {Array<{start: number, end: number, char: string, length: number}>} */
  const spans = [];
  if (seq.length === 0) return spans;

  let start = 0;
  for (let i = 1; i <= seq.length; i++) {
    if (i === seq.length || seq[i] !== seq[i - 1]) {
      spans.push({
        start,
        end: i,
        char: seq[start],
        length: i - start
      });
      start = i;
    }
  }
  return spans;
}

// ── Compare ──────────────────────────────────────────────────────────
function compare() {
  const humanSeq = seqInput.value.toUpperCase().replace(/[^HT]/g, '');
  if (humanSeq.length < MIN_LEN) return;

  const randomSeq = generateRandomSequence(humanSeq.length);
  const humanStats = analyzeSequence(humanSeq);
  const randomStats = analyzeSequence(randomSeq);

  // Disable input
  seqInput.disabled = true;
  btnCompare.hidden = true;
  btnReset.hidden = false;
  btnAddH.disabled = true;
  btnAddT.disabled = true;
  btnBackspace.disabled = true;

  // Render sequences with run highlighting
  renderSequence(displayHuman, humanSeq, humanStats.longestRun);
  renderSequence(displayRandom, randomSeq, randomStats.longestRun);

  // Expected values for n flips
  const n = humanSeq.length;
  const expectedLongestRun = Math.log2(n).toFixed(1);
  const expectedNumRuns = ((n + 1) / 2).toFixed(1);
  const expectedAvgRun = (n / ((n + 1) / 2)).toFixed(2);

  // Build stats table
  statsBody.innerHTML = '';
  addStatRow('Length', String(n), String(n), String(n), false);
  addStatRow('Proportion H', humanStats.propH.toFixed(2), randomStats.propH.toFixed(2), '0.50', false);
  addStatRow('Longest run', String(humanStats.longestRun), String(randomStats.longestRun), expectedLongestRun,
    humanStats.longestRun < randomStats.longestRun);
  addStatRow('Number of runs', String(humanStats.numRuns), String(randomStats.numRuns), expectedNumRuns,
    humanStats.numRuns > randomStats.numRuns);
  addStatRow('Avg. run length', humanStats.avgRunLength.toFixed(2), randomStats.avgRunLength.toFixed(2), expectedAvgRun,
    humanStats.avgRunLength < randomStats.avgRunLength);
  addStatRow('Alternation rate', (humanStats.alternationRate * 100).toFixed(0) + '%',
    (randomStats.alternationRate * 100).toFixed(0) + '%', '50%',
    humanStats.alternationRate > randomStats.alternationRate + 0.05);

  // Run-length distribution charts
  const maxRunLen = Math.max(humanStats.longestRun, randomStats.longestRun);
  renderRunChart(chartHuman, humanStats.runLengthDist, maxRunLen, '#569BBD');
  renderRunChart(chartRandom, randomStats.runLengthDist, maxRunLen, '#F05133');

  // Interpretation
  renderInterpretation(humanStats, randomStats, n);

  // Show results
  resultsPanel.hidden = false;
  resultsPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  announce(`Comparison complete. Your longest run: ${humanStats.longestRun}. ` +
    `Computer's longest run: ${randomStats.longestRun}. ` +
    `Your alternation rate: ${(humanStats.alternationRate * 100).toFixed(0)}%.`);
}

// ── Render sequence with run highlighting ────────────────────────────
/**
 * @param {HTMLElement} container
 * @param {string} seq
 * @param {number} longestRun
 */
function renderSequence(container, seq, longestRun) {
  container.innerHTML = '';
  const spans = getRunSpans(seq);
  const longThreshold = 4;

  for (const span of spans) {
    const el = document.createElement('span');
    const isH = span.char === 'H';
    el.className = 'run ' + (isH ? 'run-h' : 'run-t');
    if (span.length >= longThreshold) {
      el.classList.add('run-long');
    }
    el.textContent = seq.slice(span.start, span.end);
    el.title = `Run of ${span.length} ${isH ? 'heads' : 'tails'}`;
    container.appendChild(el);
  }
}

// ── Stats table row ──────────────────────────────────────────────────
/**
 * @param {string} label
 * @param {string} humanVal
 * @param {string} randomVal
 * @param {string} expectedVal
 * @param {boolean} highlightHuman
 */
function addStatRow(label, humanVal, randomVal, expectedVal, highlightHuman) {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="label-col">${label}</td>
    <td class="${highlightHuman ? 'highlight-cell' : ''}">${humanVal}</td>
    <td>${randomVal}</td>
    <td>${expectedVal}</td>
  `;
  statsBody.appendChild(tr);
}

// ── Run-length distribution bar chart ────────────────────────────────
/**
 * @param {HTMLElement} container
 * @param {Map<number, number>} dist
 * @param {number} maxRunLen
 * @param {string} color
 */
function renderRunChart(container, dist, maxRunLen, color) {
  container.innerHTML = '';
  const maxCount = Math.max(1, ...dist.values());

  for (let len = 1; len <= maxRunLen; len++) {
    const count = dist.get(len) ?? 0;
    const group = document.createElement('div');
    group.className = 'run-bar-group';

    const bar = document.createElement('div');
    bar.className = 'run-bar';
    const heightPct = maxCount > 0 ? (count / maxCount) * 100 : 0;
    bar.style.height = heightPct + '%';
    bar.style.background = count > 0 ? color : '#e9ecef';
    bar.title = `Run length ${len}: ${count} run${count !== 1 ? 's' : ''}`;

    const label = document.createElement('div');
    label.className = 'run-bar-label';
    label.textContent = String(len);

    group.appendChild(bar);
    group.appendChild(label);
    container.appendChild(group);
  }
}

// ── Interpretation ───────────────────────────────────────────────────
/**
 * @param {ReturnType<typeof analyzeSequence>} human
 * @param {ReturnType<typeof analyzeSequence>} random
 * @param {number} n
 */
function renderInterpretation(human, random, n) {
  const humanAlt = (human.alternationRate * 100).toFixed(0);

  let verdict = '';
  let details = '';

  const expectedLongest = Math.log2(n);
  const tooManyAlternations = human.alternationRate > 0.58;
  const runsToShort = human.longestRun < expectedLongest * 0.7;

  if (tooManyAlternations && runsToShort) {
    verdict = 'Your sequence looks human-generated!';
    details = `<p>Two classic giveaways: your alternation rate was <strong>${humanAlt}%</strong>
      (real coins alternate about 50% of the time), and your longest run was only
      <strong>${human.longestRun}</strong>. With ${n} flips, we'd typically expect a longest
      run of around <strong>${expectedLongest.toFixed(0)}&ndash;${Math.ceil(expectedLongest + 1)}</strong>.</p>`;
  } else if (tooManyAlternations) {
    verdict = 'Your sequence alternates too much!';
    details = `<p>Your alternation rate was <strong>${humanAlt}%</strong> &mdash; humans tend to switch
      between H and T more than a real coin does. A fair coin alternates about 50% of the time.</p>`;
  } else if (runsToShort) {
    verdict = 'Your runs are too short!';
    details = `<p>Your longest run was only <strong>${human.longestRun}</strong>.
      With ${n} flips, you'd typically expect a longest run of around
      <strong>${expectedLongest.toFixed(0)}&ndash;${Math.ceil(expectedLongest + 1)}</strong>.
      Humans tend to break up streaks too early because long runs "don't look random."</p>`;
  } else {
    verdict = 'Not bad &mdash; your sequence fooled us!';
    details = `<p>Your alternation rate (${humanAlt}%) and longest run (${human.longestRun})
      are both in the ballpark of what we'd expect from a real coin. Most people can't
      pull that off!</p>`;
  }

  interpretation.innerHTML = `
    <h3>${verdict}</h3>
    ${details}
    <div class="callout">
      <strong>Why does this matter?</strong> When researchers need to tell whether data is
      truly random &mdash; like testing whether someone really has psychic ability &mdash; they look at
      patterns exactly like these. Real randomness is <em>clumpier</em> than most people
      expect. Streaks and clusters are a natural part of random processes, not evidence that
      something unusual is happening.
    </div>
  `;
}

// ── Reset ────────────────────────────────────────────────────────────
function reset() {
  seqInput.value = '';
  seqInput.disabled = false;
  charCount.textContent = '0';
  btnCompare.disabled = true;
  btnCompare.hidden = false;
  btnReset.hidden = true;
  btnAddH.disabled = false;
  btnAddT.disabled = false;
  btnBackspace.disabled = false;
  resultsPanel.hidden = true;
  seqInput.focus();
}

// ── Helpers ──────────────────────────────────────────────────────────
/** @param {string} msg */
function announce(msg) {
  if (announceEl) announceEl.textContent = msg;
}
