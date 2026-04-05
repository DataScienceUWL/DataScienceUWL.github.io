// @ts-check
/**
 * "Are You Psychic?" coin-guessing tool.
 * Students predict coin flips, then see how their result compares to chance.
 *
 * URL params:
 *   ?n=12     — number of trials (default 16)
 *   ?context=milne — use Joy Milne framing instead of generic psychic
 */

import { initHelp, computeHighlights } from '../../js/page-utils.js';
import { createRng } from '../../js/prng.js';
import { renderSimChart, resolveChartType } from '../../js/chart-defaults.js';
import { computeBins } from '../../js/histogram.js';

initHelp();

// ── Config from URL ──────────────────────────────────────────────────
const params = new URLSearchParams(location.search);
const NUM_TRIALS = Math.max(4, Math.min(50, parseInt(params.get('n') ?? '16', 10) || 16));

// ── DOM refs ─────────────────────────────────────────────────────────
const coin = /** @type {HTMLElement} */ (document.getElementById('coin'));
const btnHeads = /** @type {HTMLButtonElement} */ (document.getElementById('btn-heads'));
const btnTails = /** @type {HTMLButtonElement} */ (document.getElementById('btn-tails'));
const btnFinish = /** @type {HTMLButtonElement} */ (document.getElementById('btn-finish'));
const finishRow = /** @type {HTMLElement} */ (document.getElementById('finish-row'));
const tracker = /** @type {HTMLElement} */ (document.getElementById('tracker'));
const summary = /** @type {HTMLElement} */ (document.getElementById('summary'));
const trialNumEl = /** @type {HTMLElement} */ (document.getElementById('trial-num'));
const trialTotalEl = /** @type {HTMLElement} */ (document.getElementById('trial-total'));
const progressEl = /** @type {HTMLElement} */ (document.getElementById('progress'));
const announceEl = document.getElementById('sr-announce');

// ── State ────────────────────────────────────────────────────────────
/** @type {Array<{guess: string, outcome: string, correct: boolean}>} */
const trials = [];
let currentTrial = 0;
let isAnimating = false;

// ── Init ─────────────────────────────────────────────────────────────
trialTotalEl.textContent = String(NUM_TRIALS);
buildTrackerDots();

btnHeads.addEventListener('click', () => handleGuess('heads'));
btnTails.addEventListener('click', () => handleGuess('tails'));
btnFinish.addEventListener('click', finishRemaining);

// Keyboard shortcuts: H for heads, T for tails
document.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === 'h') { e.preventDefault(); handleGuess('heads'); }
  else if (key === 't') { e.preventDefault(); handleGuess('tails'); }
});

// ── Build tracker dots ───────────────────────────────────────────────
function buildTrackerDots() {
  tracker.innerHTML = '';
  for (let i = 0; i < NUM_TRIALS; i++) {
    const dot = document.createElement('div');
    dot.className = 'trial-dot pending';
    dot.setAttribute('role', 'listitem');
    dot.setAttribute('aria-label', `Trial ${i + 1}: pending`);
    dot.textContent = String(i + 1);
    tracker.appendChild(dot);
  }
}

// ── Core guess handler ───────────────────────────────────────────────
/**
 * @param {string} guess - 'heads' or 'tails'
 */
function handleGuess(guess) {
  if (isAnimating || currentTrial >= NUM_TRIALS) return;

  isAnimating = true;
  setButtonsDisabled(true);

  const outcome = Math.random() < 0.5 ? 'heads' : 'tails';
  const correct = guess === outcome;

  // Animate coin flip
  animateCoinFlip(outcome, () => {
    // Record trial
    trials.push({ guess, outcome, correct });
    updateTrackerDot(currentTrial, correct);
    currentTrial++;

    // Update progress
    if (currentTrial < NUM_TRIALS) {
      trialNumEl.textContent = String(currentTrial + 1);
    }

    // Show "finish remaining" after 2 trials
    if (currentTrial >= 2 && currentTrial < NUM_TRIALS) {
      finishRow.hidden = false;
    }

    announce(
      `Trial ${currentTrial}: you guessed ${guess}, coin was ${outcome} — ${correct ? 'correct' : 'incorrect'}. ` +
      `Score: ${getCorrectCount()} of ${currentTrial}.`
    );

    isAnimating = false;

    if (currentTrial >= NUM_TRIALS) {
      showSummary();
    } else {
      setButtonsDisabled(false);
    }
  });
}

// ── Coin flip animation ──────────────────────────────────────────────
/**
 * @param {string} outcome - 'heads' or 'tails'
 * @param {() => void} onDone
 */
function animateCoinFlip(outcome, onDone) {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Set the final rotation as a CSS variable for the animation endpoint
  const finalRot = outcome === 'tails' ? '1620deg' : '1800deg';
  // 1800deg = 5 full rotations (lands on heads face)
  // 1620deg = 4.5 rotations (lands on tails face = 180deg offset)
  coin.style.setProperty('--final-rotation', finalRot);

  if (reducedMotion || currentTrial >= 3) {
    // After the first few flips, quick snap with a bounce pulse for feedback
    coin.classList.remove('show-heads', 'show-tails', 'flipping');
    if (currentTrial >= 3 && !reducedMotion) {
      // Shrink briefly then snap to result — always visible even if same face
      coin.style.transition = 'none';
      coin.style.transform = (outcome === 'tails' ? 'rotateY(180deg)' : 'rotateY(0deg)') + ' scale(0.85)';
      void coin.offsetHeight;
      coin.style.transition = 'transform 0.15s ease-out';
      coin.style.transform = (outcome === 'tails' ? 'rotateY(180deg)' : 'rotateY(0deg)') + ' scale(1)';
      coin.classList.add(outcome === 'tails' ? 'show-tails' : 'show-heads');
      setTimeout(() => { coin.style.transition = ''; coin.style.transform = ''; onDone(); }, 160);
    } else {
      coin.classList.add(outcome === 'tails' ? 'show-tails' : 'show-heads');
      onDone();
    }
    return;
  }

  // Full flip animation for first few trials
  coin.classList.remove('show-heads', 'show-tails', 'flipping');
  void coin.offsetHeight;
  coin.classList.add('flipping');

  const onEnd = () => {
    coin.removeEventListener('animationend', onEnd);
    coin.classList.remove('flipping');
    coin.classList.add(outcome === 'tails' ? 'show-tails' : 'show-heads');
    onDone();
  };
  coin.addEventListener('animationend', onEnd);
}

// ── Finish remaining trials (batch) ──────────────────────────────────
function finishRemaining() {
  if (isAnimating || currentTrial >= NUM_TRIALS) return;

  setButtonsDisabled(true);
  finishRow.hidden = true;
  isAnimating = true;

  const remaining = NUM_TRIALS - currentTrial;
  const batchTrials = [];

  // Generate all remaining outcomes and random guesses
  for (let i = 0; i < remaining; i++) {
    const guess = Math.random() < 0.5 ? 'heads' : 'tails';
    const outcome = Math.random() < 0.5 ? 'heads' : 'tails';
    batchTrials.push({ guess, outcome, correct: guess === outcome });
  }

  // Animate them quickly in sequence
  let i = 0;
  const BATCH_DELAY = 120; // ms between each batch trial

  function nextBatch() {
    if (i >= batchTrials.length) {
      isAnimating = false;
      showSummary();
      return;
    }

    const t = batchTrials[i];
    trials.push(t);
    updateTrackerDot(currentTrial, t.correct);
    currentTrial++;

    if (currentTrial < NUM_TRIALS) {
      trialNumEl.textContent = String(currentTrial + 1);
    }

    i++;
    setTimeout(nextBatch, BATCH_DELAY);
  }

  // Quick coin spin for visual feedback, then batch through
  const firstOutcome = batchTrials[0].outcome;
  animateCoinFlip(firstOutcome, () => {
    // First batch trial already animated
    trials.push(batchTrials[0]);
    updateTrackerDot(currentTrial, batchTrials[0].correct);
    currentTrial++;
    i = 1; // Skip first, already done

    if (batchTrials.length === 1) {
      isAnimating = false;
      showSummary();
      return;
    }

    // Rapid-fire the rest
    setTimeout(nextBatch, BATCH_DELAY);
  });
}

// ── Update tracker dot ───────────────────────────────────────────────
/**
 * @param {number} index
 * @param {boolean} correct
 */
function updateTrackerDot(index, correct) {
  const dots = tracker.querySelectorAll('.trial-dot');
  const dot = dots[index];
  if (!dot) return;

  dot.classList.remove('pending');
  dot.classList.add(correct ? 'correct' : 'incorrect');
  dot.textContent = correct ? '\u2713' : '\u2717';
  dot.setAttribute('aria-label',
    `Trial ${index + 1}: ${correct ? 'correct' : 'incorrect'}`);
}

// ── Summary ──────────────────────────────────────────────────────────
function showSummary() {
  setButtonsDisabled(true);
  finishRow.hidden = true;
  progressEl.textContent = 'Complete!';

  const correct = getCorrectCount();
  const pct = Math.round(100 * correct / NUM_TRIALS);
  const expected = NUM_TRIALS / 2;

  let interp = '';
  if (correct <= expected + 1 && correct >= expected - 1) {
    interp = `You got ${correct} right out of ${NUM_TRIALS} — almost exactly what we'd expect from random guessing (${expected}). No psychic powers detected!`;
  } else if (correct > expected + 1) {
    interp = `You got ${correct} right out of ${NUM_TRIALS} — that's better than the ${expected} we'd expect from guessing. But is it <em>enough</em> better to rule out luck?`;
  } else {
    interp = `You got ${correct} right out of ${NUM_TRIALS} — that's below the ${expected} we'd expect from guessing. Interesting! But is that unusual?`;
  }

  summary.innerHTML = `
    <h3>Results</h3>
    <div class="summary-score">${correct} / ${NUM_TRIALS} correct (${pct}%)</div>
    <p class="summary-interp">${interp}</p>
  `;
  summary.hidden = false;

  // Set up the simulation section
  playerScore = correct;
  simScores = [];
  prevSimLength = 0;
  simRng = createRng(Date.now().toString());
  initSimSection();

  announce(`Complete! You got ${correct} out of ${NUM_TRIALS} correct.`);
}

// ── In-page simulation ──────────────────────────────────────────────

const simSection = /** @type {HTMLElement} */ (document.getElementById('sim-section'));
const simIntroEl = /** @type {HTMLElement} */ (document.getElementById('sim-intro'));
const simDotplot = /** @type {HTMLElement} */ (document.getElementById('sim-dotplot'));
const simCountText = /** @type {HTMLElement} */ (document.getElementById('sim-count-text'));
const simInterpEl = /** @type {HTMLElement} */ (document.getElementById('sim-interp'));
const formalLink = /** @type {HTMLAnchorElement} */ (document.getElementById('formal-link'));
const simBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (document.querySelectorAll('[data-sim-count]'));

let playerScore = 0;
/** @type {number[]} */
let simScores = [];
/** @type {(() => number)|null} */
let simRng = null;

function initSimSection() {
  simSection.hidden = false;
  simIntroEl.textContent = `You got ${playerScore} out of ${NUM_TRIALS} correct. Is that a typical result, or something unusual? Let's find out — press +1 to simulate one random guesser, or +5, +25, +100 to simulate many at once. Each dot on the chart is one simulated guesser's score. Your score is marked with the orange line.`;

  // Build formal link
  const simUrl = `../../simulate/randomization-one-prop/?data=${playerScore},${NUM_TRIALS - playerScore}&labels=Correct,Incorrect&success=Correct&null=0.5&direction=greater`;
  formalLink.href = simUrl;

  renderSimChart_();
  simSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Wire restart button in sim section
  const restartSimBtn = document.getElementById('btn-restart-sim');
  if (restartSimBtn) restartSimBtn.addEventListener('click', restart);
}

for (const btn of simBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.simCount ?? '1', 10);
    runSimulations(count);
  });
}

/** @param {number} count */
function runSimulations(count) {
  if (!simRng) return;

  for (let i = 0; i < count; i++) {
    // Simulate one random guesser: flip NUM_TRIALS coins, count correct
    let correct = 0;
    for (let j = 0; j < NUM_TRIALS; j++) {
      // Guess randomly, outcome random — each has 50% chance of matching
      if (simRng() < 0.5) correct++;
    }
    simScores.push(correct);
  }

  renderSimChart_();
  updateSimText();
  announce(`Simulated ${count} random guesser${count > 1 ? 's' : ''}. Total: ${simScores.length}.`);
}

/** Previous simulation count — for highlight tracking. */
let prevSimLength = 0;

function renderSimChart_() {
  if (!simDotplot) return;

  const total = simScores.length;
  if (total === 0) {
    simDotplot.innerHTML = '<p style="text-align:center;color:#aaa;padding:2rem 0;">Click a button above to simulate random guessers</p>';
    return;
  }

  /** @type {[number, number]} */
  const domain = [-0.5, NUM_TRIALS + 0.5];
  const chartType = resolveChartType(total, 'auto');

  // Compute highlights for the newest batch
  const count = total - prevSimLength;
  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    simScores, prevSimLength, count, computeBins, { domain });

  renderSimChart(simDotplot, simScores, {
    chartType,
    id: 'psychic-sim',
    xLabel: 'Number correct out of ' + NUM_TRIALS,
    titleText: 'Simulated Random Guessers',
    observedStat: playerScore,
    direction: 'right',
    domain,
    highlightIndex: count === 1 ? hlIndex : -1,
    highlightIndices: count > 1 ? hlIndices : undefined,
    prevBinCounts: count > 1 ? prevBinCounts : undefined,
    numBins: NUM_TRIALS + 1,
  });

  prevSimLength = total;
}

function updateSimText() {
  const total = simScores.length;
  if (total === 0) {
    simCountText.textContent = '';
    simInterpEl.innerHTML = '';
    return;
  }

  const asGoodOrBetter = simScores.filter(s => s >= playerScore).length;
  const pct = (asGoodOrBetter / total * 100).toFixed(1);

  simCountText.innerHTML = `<strong>${asGoodOrBetter}</strong> of <strong>${total}</strong> random guessers scored ${playerScore} or higher (${pct}%)`;

  if (total >= 25) {
    const proportion = asGoodOrBetter / total;
    let interp = '';
    if (proportion > 0.25) {
      interp = `<strong>Your result is not unusual.</strong> Plenty of random guessers scored as well as you did. This is exactly what we'd expect — getting ${playerScore} right out of ${NUM_TRIALS} is well within the range of normal luck.`;
    } else if (proportion > 0.05) {
      interp = `<strong>Your result is a little unusual</strong>, but not dramatically so. Some random guessers still matched your score. We'd probably want more evidence before claiming anything beyond luck.`;
    } else if (proportion > 0) {
      interp = `<strong>Your result is quite unusual!</strong> Very few random guessers scored this well. If someone claimed to have psychic ability, a result like this would be the kind of evidence we'd want to see.`;
    } else {
      interp = `<strong>Your result is extremely unusual!</strong> None of the ${total} simulated random guessers scored this well. That's strong evidence that something beyond pure guessing is going on.`;
    }
    interp += ` <em>This is exactly the logic behind a hypothesis test — simulate what "just guessing" looks like, then see if the real result is surprising.</em>`;
    simInterpEl.innerHTML = interp;
  } else {
    simInterpEl.innerHTML = `<em>Run more simulations (at least 25) to see a clearer pattern.</em>`;
  }
}

// ── Restart ──────────────────────────────────────────────────────────
function restart() {
  trials.length = 0;
  currentTrial = 0;
  isAnimating = false;

  trialNumEl.textContent = '1';
  summary.hidden = true;
  simSection.hidden = true;
  finishRow.hidden = true;
  simScores = [];
  simRng = null;
  prevSimLength = 0;
  progressEl.innerHTML = `Trial <span id="trial-num">1</span> of <span id="trial-total">${NUM_TRIALS}</span>`;

  // Re-grab the span refs since innerHTML replaced them
  const newTrialNum = document.getElementById('trial-num');
  const newTrialTotal = document.getElementById('trial-total');
  if (newTrialNum) newTrialNum.textContent = '1';
  if (newTrialTotal) newTrialTotal.textContent = String(NUM_TRIALS);

  coin.classList.remove('show-heads', 'show-tails', 'flipping');
  buildTrackerDots();
  setButtonsDisabled(false);
}

// ── Helpers ──────────────────────────────────────────────────────────
function getCorrectCount() {
  return trials.filter(t => t.correct).length;
}

/** @param {boolean} disabled */
function setButtonsDisabled(disabled) {
  btnHeads.disabled = disabled;
  btnTails.disabled = disabled;
  btnFinish.disabled = disabled;
}

/** @param {string} msg */
function announce(msg) {
  if (announceEl) announceEl.textContent = msg;
}
