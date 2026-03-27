// @ts-check
/**
 * "Are You Psychic?" coin-guessing tool.
 * Students predict coin flips, then see how their result compares to chance.
 *
 * URL params:
 *   ?n=12     — number of trials (default 16)
 *   ?context=milne — use Joy Milne framing instead of generic psychic
 */

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

  if (reducedMotion) {
    // Skip animation, just show result
    coin.classList.remove('show-heads', 'show-tails');
    coin.classList.add(outcome === 'tails' ? 'show-tails' : 'show-heads');
    onDone();
    return;
  }

  // Start flip animation
  coin.classList.remove('show-heads', 'show-tails', 'flipping');
  // Force reflow so re-adding the class triggers the animation
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

  // Interpretation
  let interp = '';
  const expected = NUM_TRIALS / 2;
  if (correct <= expected + 1 && correct >= expected - 1) {
    interp = `You got ${correct} right out of ${NUM_TRIALS} — almost exactly what we'd expect from random guessing (${expected}). No psychic powers detected!`;
  } else if (correct > expected + 1) {
    interp = `You got ${correct} right out of ${NUM_TRIALS} — that's better than the ${expected} we'd expect from guessing. But is it <em>enough</em> better to rule out luck? Let's find out with a simulation.`;
  } else {
    interp = `You got ${correct} right out of ${NUM_TRIALS} — that's below the ${expected} we'd expect from guessing. Looks like you might be anti-psychic! Let's see how unusual this is.`;
  }

  // Build the simulation link — pre-load the one-proportion randomization page
  const simUrl = `../../simulate/randomization-one-prop/?data=${correct},${NUM_TRIALS - correct}&labels=Correct,Incorrect&success=Correct&null=0.5&direction=greater`;

  summary.innerHTML = `
    <h3>Results</h3>
    <div class="summary-score">${correct} / ${NUM_TRIALS} correct (${pct}%)</div>
    <p class="summary-interp">${interp}</p>
    <a class="sim-link-btn" href="${simUrl}">
      Test with simulation &rarr;
    </a>
    <br>
    <button class="restart-btn" id="btn-restart">Try again</button>
  `;
  summary.hidden = false;

  /** @type {HTMLButtonElement|null} */
  const restartBtn = summary.querySelector('#btn-restart');
  if (restartBtn) restartBtn.addEventListener('click', restart);

  announce(`Complete! You got ${correct} out of ${NUM_TRIALS} correct.`);
}

// ── Restart ──────────────────────────────────────────────────────────
function restart() {
  trials.length = 0;
  currentTrial = 0;
  isAnimating = false;

  trialNumEl.textContent = '1';
  summary.hidden = true;
  finishRow.hidden = true;
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
