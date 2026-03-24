// @ts-check
/**
 * Interactive Randomization Test Activity — Dual Mode
 *
 * Discovery mode: progressive disclosure with gated questions.
 * Presentation mode: all steps visible with presenter notes.
 *
 * Walks students through the randomization test procedure
 * using a card-shuffle metaphor.
 */

import { drawHistogram, snappedPropThresholds } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { renderSimPills } from '../../js/chart-utils.js';
import { resolveChartType, createChartToggle } from '../../js/chart-defaults.js';
import { initHelp, animateDropToChart } from '../../js/page-utils.js';
import { createRng, shuffle as prngShuffle } from '../../js/prng.js';
import { animateCardShuffle } from '../../js/card-shuffle-anim.js';
import { getActivityMode } from '../../js/settings.js';
import { formatStat } from '../../js/stats.js';

// ─── Dataset Definitions ───────────────────────────────────────────

const DATASETS = {
  sex_discrimination: {
    file: '../../data/sex_discrimination.json',
    explanatory: 'sex',
    response: 'decision',
    group1Label: 'Male',
    group2Label: 'Female',
    group1Value: 'male',
    group2Value: 'female',
    successLabel: 'Promoted',
    successValue: 'promoted',
    failureLabel: 'Not promoted',
    description: 'In 1972, 48 male bank supervisors each reviewed a personnel file and decided whether to promote the candidate. The files were identical except that half were randomly labeled "male" and half "female."',
    nullHyp: 'Sex has no effect on promotion decisions. Any difference is due to chance.',
    altHyp: 'Female candidates are less likely to be promoted (discrimination).',
    direction: 'right',
    // Gate questions (dataset-specific)
    gate1Q: 'Which group had a higher promotion rate?',
    gate1Choices: [
      { text: 'Male (87.5%)', correct: true },
      { text: 'Female (58.3%)', correct: false },
      { text: 'About the same', correct: false },
    ],
    gate1Explain: 'Males were promoted at 87.5% vs 58.3% for females — a 29.2 percentage point difference.',
    gate2Q: 'If sex truly had no effect on promotions, what would that mean about these 48 files?',
    gate2Choices: [
      { text: 'No one would be promoted', correct: false },
      { text: 'Exactly 50% in each group would be promoted', correct: false },
      { text: '35 people would have been promoted regardless of their gender', correct: true },
      { text: 'We would need more data to tell', correct: false },
    ],
    gate2Explain: 'Under the null hypothesis, the outcomes are fixed — the same 35 promotions would have happened. Only the group labels are random.',
  },
  opportunity_cost: {
    file: '../../data/opportunity_cost.json',
    explanatory: 'group',
    response: 'decision',
    group1Label: 'Treatment',
    group2Label: 'Control',
    group1Value: 'treatment',
    group2Value: 'control',
    successLabel: 'Not buy video',
    successValue: 'not buy video',
    failureLabel: 'Buy video',
    description: '150 students were asked about buying a video. Half were reminded they could save the money for other purchases (treatment). Does the reminder reduce buying?',
    nullHyp: 'The reminder has no effect on purchase decisions.',
    altHyp: 'The reminder reduces the chance of purchase (treatment group buys less).',
    direction: 'right',
    gate1Q: 'Which group was less likely to buy the video?',
    gate1Choices: [
      { text: 'Treatment (received the reminder)', correct: true },
      { text: 'Control (no reminder)', correct: false },
      { text: 'About the same', correct: false },
    ],
    gate1Explain: 'The treatment group (with the reminder) chose not to buy more often than the control group.',
    gate2Q: 'If the reminder truly had no effect, what would be true?',
    gate2Choices: [
      { text: 'Nobody would buy the video', correct: false },
      { text: 'The same people would have made the same decisions regardless of which group they were in', correct: true },
      { text: 'Exactly half would buy in each group', correct: false },
      { text: 'The experiment would need to be repeated', correct: false },
    ],
    gate2Explain: 'Under the null hypothesis, the outcomes are fixed — the reminder didn\'t change anyone\'s mind. The group labels are the only random part.',
  },
  cpr: {
    file: '../../data/cpr.json',
    explanatory: 'group',
    response: 'outcome',
    group1Label: 'Treatment',
    group2Label: 'Control',
    group1Value: 'treatment',
    group2Value: 'control',
    successLabel: 'Survived',
    successValue: 'survived',
    failureLabel: 'Died',
    description: '90 patients who received CPR were randomly assigned to receive a blood thinner (treatment) or not (control). Did the blood thinner improve survival?',
    nullHyp: 'The blood thinner has no effect on survival after CPR.',
    altHyp: 'The blood thinner improves survival rates.',
    direction: 'right',
    gate1Q: 'Which group had a higher survival rate?',
    gate1Choices: [
      { text: 'Treatment (blood thinner)', correct: true },
      { text: 'Control (no blood thinner)', correct: false },
      { text: 'About the same', correct: false },
    ],
    gate1Explain: 'The treatment group had a higher survival rate, but is the difference large enough to rule out chance?',
    gate2Q: 'If the blood thinner truly had no effect, what would that mean?',
    gate2Choices: [
      { text: 'Everyone would survive', correct: false },
      { text: 'The same patients would have survived or died regardless of whether they received the blood thinner', correct: true },
      { text: 'Exactly half would survive in each group', correct: false },
      { text: 'We couldn\'t do a randomization test', correct: false },
    ],
    gate2Explain: 'Under the null hypothesis, the outcomes are fixed — the same patients would have survived either way. The treatment assignment is the only random part.',
  },
};

const TOTAL_STEPS = 5;

// ─── State ─────────────────────────────────────────────────────────

/** @type {any[]} */
let rawData = [];
let config = DATASETS.sex_discrimination;
/** @type {number[]} */
let nullDiffs = [];
let observedDiff = 0;

/** Discrete step size for proportion differences (1/n1 + 1/n2 when total successes fixed). */
let discreteStep = 0;
let prng = createRng('randomization');
let predictionLocked = false;
let currentStep = 1;  // discovery mode: which step is active
let hasShuffledOnce = false; // track if step 3 shuffle happened
const mode = getActivityMode();

/** @type {'auto'|'dotplot'|'histogram'} */
let chartType = 'auto';

/** Index of last added stat for dotplot highlight animation (-1 = none). */
let lastStatIndex = -1;

/** Indices of batch-added stats for dotplot highlight. @type {Set<number>|null} */
let batchHighlightIndices = null;

/** @type {((type: string) => void)|null} */
let setToggleSelected = null;

// ─── DOM References ────────────────────────────────────────────────

const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const stepCards = /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll('.step-card'));

// ─── Initialization ────────────────────────────────────────────────

initHelp();

// Chart type toggle (dotplot / histogram)
// createChartToggle inserts before its first arg in the parent, so pass the chart div
const nullDistChart = document.getElementById('null-dist-chart');
if (nullDistChart) {
  const toggle = createChartToggle(nullDistChart, {
    types: [['dotplot', 'Dotplot'], ['histogram', 'Histogram']],
    initial: 'dotplot',
    onChange: (type) => {
      chartType = /** @type {'auto'|'dotplot'|'histogram'} */ (type);
      updateChart();
    },
  });
  setToggleSelected = toggle.setSelected;
}

datasetSelect.addEventListener('change', () => {
  loadDataset(datasetSelect.value);
});

// Keyboard navigation for presentation mode
if (mode === 'present') {
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      focusNextStep(1);
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      focusNextStep(-1);
    }
  });
}

loadDataset('sex_discrimination');

// ─── Dataset Loading ───────────────────────────────────────────────

async function loadDataset(id) {
  config = DATASETS[id];
  if (!config) return;

  try {
    const resp = await fetch(config.file);
    const json = await resp.json();
    rawData = json.rows || json;
  } catch {
    rawData = [];
    return;
  }

  // Reset state
  nullDiffs = [];
  predictionLocked = false;
  hasShuffledOnce = false;
  currentStep = 1;
  prng = createRng('randomization-' + id);

  // Compute observed data
  const { group1, group2 } = splitGroups(rawData);
  const p1 = countSuccess(group1) / group1.length;
  const p2 = countSuccess(group2) / group2.length;
  observedDiff = +(p1 - p2).toFixed(6);

  // Discrete step: when total successes are fixed and one moves from group1 to group2,
  // the difference changes by 1/n1 + 1/n2
  discreteStep = 1 / group1.length + 1 / group2.length;

  renderStep1(group1, group2);
  renderStep2();
  renderStep3();
  renderStep4();
  renderStep5();

  if (mode === 'discover') {
    updateStepVisibility();
    updateProgress();
  }

  announce(`Loaded ${config.group1Label} vs ${config.group2Label} dataset`);
}

// ─── Discovery Mode: Step Management ──────────────────────────────

function updateStepVisibility() {
  for (const card of stepCards) {
    const step = parseInt(card.dataset.step || '0');
    if (step > currentStep) {
      card.classList.add('locked');
    } else {
      card.classList.remove('locked');
    }
  }
}

function updateProgress() {
  const bar = document.getElementById('step-progress');
  if (!bar) return;
  bar.innerHTML = '';
  for (let i = 1; i <= TOTAL_STEPS; i++) {
    const dot = document.createElement('span');
    dot.className = 'step-dot';
    if (i < currentStep) dot.classList.add('completed');
    if (i === currentStep) dot.classList.add('active');
    dot.setAttribute('aria-label', `Step ${i}${i < currentStep ? ' (completed)' : i === currentStep ? ' (current)' : ''}`);
    bar.appendChild(dot);
  }
  const label = document.createElement('span');
  label.textContent = `Step ${currentStep} of ${TOTAL_STEPS}`;
  bar.appendChild(label);
}

function advanceToStep(step) {
  if (step <= currentStep || step > TOTAL_STEPS) return;
  currentStep = step;
  updateStepVisibility();
  updateProgress();
  // Scroll the newly unlocked step into view
  const card = document.querySelector(`[data-step="${step}"]`);
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  announce(`Step ${step} unlocked`);
}

/** Auto-advance after a short delay so students can read the gate feedback. */
function autoAdvance(step) {
  if (mode !== 'discover') return;
  setTimeout(() => advanceToStep(step + 1), 1200);
}

// Presentation mode: arrow key step focus
let focusedStepIndex = 0;
function focusNextStep(dir) {
  focusedStepIndex = Math.max(0, Math.min(stepCards.length - 1, focusedStepIndex + dir));
  stepCards[focusedStepIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── Gate Questions ───────────────────────────────────────────────

/**
 * Build a multiple-choice gate question.
 * @param {number} gateNum - Gate number (1-4)
 * @param {string} question - Question text
 * @param {Array<{text: string, correct: boolean}>} choices
 * @param {string} explanation - Shown after correct answer
 * @param {() => void} onPass - Called when the student gets it right
 */
function buildGate(gateNum, question, choices, explanation, onPass) {
  const qEl = document.getElementById(`gate${gateNum}-question`);
  const choicesEl = document.getElementById(`gate${gateNum}-choices`);
  const feedbackEl = document.getElementById(`gate${gateNum}-feedback`);
  const gateEl = document.getElementById(`gate-${gateNum}`);
  if (!qEl || !choicesEl || !feedbackEl || !gateEl) return;

  qEl.textContent = question;
  choicesEl.innerHTML = '';
  feedbackEl.hidden = true;
  gateEl.hidden = false;

  let answered = false;

  for (const choice of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'gate-choice';
    btn.textContent = choice.text;
    btn.addEventListener('click', () => {
      if (answered) return;
      // Mark all as disabled
      for (const b of choicesEl.querySelectorAll('.gate-choice')) {
        b.classList.add('disabled');
      }
      if (choice.correct) {
        answered = true;
        btn.classList.add('correct');
        feedbackEl.className = 'gate-feedback success';
        feedbackEl.textContent = explanation;
        feedbackEl.hidden = false;
        onPass();
      } else {
        btn.classList.add('incorrect');
        feedbackEl.className = 'gate-feedback retry';
        feedbackEl.textContent = 'Not quite. Think about what "no effect" would mean and try again.';
        feedbackEl.hidden = false;
        // Allow retry after brief pause
        setTimeout(() => {
          btn.classList.remove('incorrect');
          for (const b of choicesEl.querySelectorAll('.gate-choice')) {
            b.classList.remove('disabled');
          }
        }, 1200);
      }
    });
    choicesEl.appendChild(btn);
  }
}

// ─── Data Helpers ──────────────────────────────────────────────────

function splitGroups(data) {
  const group1 = data.filter(r => r[config.explanatory] === config.group1Value);
  const group2 = data.filter(r => r[config.explanatory] === config.group2Value);
  return { group1, group2 };
}

function countSuccess(rows) {
  return rows.filter(r => r[config.response] === config.successValue).length;
}

function shuffle(arr) {
  return prngShuffle(arr, prng);
}

function simulateOne() {
  const outcomes = rawData.map(r => r[config.response]);
  shuffle(outcomes);
  const { group1 } = splitGroups(rawData);
  const n1 = group1.length;
  const n2 = rawData.length - n1;
  const shuffledSuccesses1 = outcomes.slice(0, n1).filter(v => v === config.successValue).length;
  const shuffledSuccesses2 = outcomes.slice(n1).filter(v => v === config.successValue).length;
  const p1 = shuffledSuccesses1 / n1;
  const p2 = shuffledSuccesses2 / n2;
  return +(p1 - p2).toFixed(6);
}

// ─── Rendering ─────────────────────────────────────────────────────

function renderCards(container, rows) {
  container.innerHTML = '';
  const group1Rows = rows.filter(r => r[config.explanatory] === config.group1Value);
  const group2Rows = rows.filter(r => r[config.explanatory] === config.group2Value);

  function makeGroup(label, groupRows) {
    const grp = document.createElement('div');
    grp.className = 'card-group';
    const h = document.createElement('h3');
    h.textContent = label;
    grp.appendChild(h);
    const cardsDiv = document.createElement('div');
    cardsDiv.className = 'cards';
    for (const row of groupRows) {
      const card = document.createElement('div');
      card.className = 'card ' + (row[config.response] === config.successValue ? 'promoted' : 'not-promoted');
      card.setAttribute('aria-label', row[config.response]);
      cardsDiv.appendChild(card);
    }
    grp.appendChild(cardsDiv);
    return grp;
  }

  container.appendChild(makeGroup(config.group1Label, group1Rows));
  container.appendChild(makeGroup(config.group2Label, group2Rows));

  const legend = document.createElement('div');
  legend.className = 'card-legend';
  legend.innerHTML =
    `<span><span class="swatch success" aria-hidden="true"></span> ${config.successLabel}</span>` +
    `<span><span class="swatch failure" aria-hidden="true"></span> ${config.failureLabel}</span>`;
  container.appendChild(legend);
}

function fillTable(prefix, group1, group2) {
  const s1 = countSuccess(group1);
  const f1 = group1.length - s1;
  const s2 = countSuccess(group2);
  const f2 = group2.length - s2;

  el(prefix + '-col1').textContent = config.group1Label;
  el(prefix + '-col2').textContent = config.group2Label;
  el(prefix + '-row1').textContent = config.successLabel;
  el(prefix + '-row2').textContent = config.failureLabel;
  el(prefix + '-a').textContent = String(s1);
  el(prefix + '-b').textContent = String(s2);
  el(prefix + '-c').textContent = String(f1);
  el(prefix + '-d').textContent = String(f2);
  el(prefix + '-t1').textContent = String(s1 + s2);
  el(prefix + '-t2').textContent = String(f1 + f2);
  el(prefix + '-tc1').textContent = String(group1.length);
  el(prefix + '-tc2').textContent = String(group2.length);
  el(prefix + '-tt').textContent = String(group1.length + group2.length);
}

// Step 1: Show original data
function renderStep1(group1, group2) {
  el('step1-description').textContent = config.description;
  renderCards(el('observed-cards'), rawData);
  fillTable('obs', group1, group2);

  const p1 = (countSuccess(group1) / group1.length * 100).toFixed(1);
  const p2 = (countSuccess(group2) / group2.length * 100).toFixed(1);
  const diff = (observedDiff * 100).toFixed(1);
  el('step1-difference').innerHTML =
    `<strong>Observed difference:</strong> ${p1}% − ${p2}% = <strong>${diff} percentage points</strong> ` +
    `(${config.group1Label} − ${config.group2Label})`;

  // Discovery: build gate 1
  if (mode === 'discover') {
    buildGate(1, config.gate1Q, config.gate1Choices, config.gate1Explain, () => {
      autoAdvance(1);
    });
  }
}

// Step 2: Hypotheses
function renderStep2() {
  el('step2-hypotheses').innerHTML =
    `<strong>H₀ (Null):</strong> ${config.nullHyp}<br>` +
    `<strong>Hₐ (Alternative):</strong> ${config.altHyp}`;

  // Discovery: build gate 2
  if (mode === 'discover') {
    buildGate(2, config.gate2Q, config.gate2Choices, config.gate2Explain, () => {
      autoAdvance(2);
    });
  }
}

// Step 3: Single shuffle
function renderStep3() {
  const shuffledCards = el('shuffled-cards');
  const shuffledTable = el('shuffled-table');
  const shuffleResult = el('shuffle-result');
  // Show the original card layout so the first "Shuffle once" animates FROM original TO shuffled
  renderCards(shuffledCards, rawData);
  // Add a subtle label indicating this is the original (unshuffled) arrangement
  const origLabel = document.createElement('p');
  origLabel.className = 'original-label';
  origLabel.style.cssText = 'color: var(--muted); font-size: 0.85rem; text-align: center; margin-top: 0.25rem;';
  origLabel.textContent = '(Original data — click "Shuffle once" to randomize)';
  shuffledCards.appendChild(origLabel);

  // Show the original table values (will be overwritten on first shuffle)
  const group1 = rawData.filter(r => r[config.explanatory] === config.group1Value);
  const group2 = rawData.filter(r => r[config.explanatory] === config.group2Value);
  fillTable('shuf', group1, group2);
  shuffledTable.hidden = false;
  shuffleResult.hidden = true;
  predictionLocked = false;
  hasShuffledOnce = false;

  const predInput = /** @type {HTMLInputElement} */ (el('prediction-input'));
  predInput.value = '';
  el('prediction-feedback').className = 'prediction-feedback hidden';
  /** @type {HTMLButtonElement} */ (el('predict-btn')).disabled = false;

  // Hide gate 3 until shuffle happens
  const gate3 = document.getElementById('gate-3');
  if (gate3) gate3.hidden = true;

  el('predict-btn').onclick = () => {
    predictionLocked = true;
    /** @type {HTMLButtonElement} */ (el('predict-btn')).disabled = true;
    const pred = parseFloat(predInput.value);
    if (isNaN(pred)) {
      el('prediction-feedback').textContent = 'Enter a number first!';
      el('prediction-feedback').className = 'prediction-feedback off';
      predictionLocked = false;
      /** @type {HTMLButtonElement} */ (el('predict-btn')).disabled = false;
      return;
    }
    el('prediction-feedback').textContent = `Prediction locked: ${pred.toFixed(2)}. Now shuffle!`;
    el('prediction-feedback').className = 'prediction-feedback close';
  };

  el('shuffle-one').onclick = () => {
    const outcomes = rawData.map(r => r[config.response]);
    shuffle(outcomes);

    const shuffledRows = rawData.map((r, i) => ({
      ...r,
      [config.response]: outcomes[i],
    }));

    const shuffledGroup1 = shuffledRows.filter(r => r[config.explanatory] === config.group1Value);
    const shuffledGroup2 = shuffledRows.filter(r => r[config.explanatory] === config.group2Value);

    const sp1 = countSuccess(shuffledGroup1) / shuffledGroup1.length;
    const sp2 = countSuccess(shuffledGroup2) / shuffledGroup2.length;
    const diff = sp1 - sp2;

    // Update result text immediately (don't wait for animation)
    shuffleResult.hidden = false;
    shuffleResult.innerHTML =
      `<strong>Simulated difference:</strong> ${(sp1 * 100).toFixed(1)}% − ${(sp2 * 100).toFixed(1)}% = ` +
      `<strong>${(diff * 100).toFixed(1)} percentage points</strong> (from chance alone)`;

    /** Update DOM with shuffled cards and table (called by animation or directly). */
    const applyShuffledDOM = () => {
      renderCards(shuffledCards, shuffledRows);
      fillTable('shuf', shuffledGroup1, shuffledGroup2);
      shuffledTable.hidden = false;
    };

    // Animate if cards are already visible; otherwise just render
    const hasCards = shuffledCards.querySelector('.card') != null;
    if (hasCards) {
      animateCardShuffle(shuffledCards, applyShuffledDOM);
    } else {
      applyShuffledDOM();
    }

    // Compare with prediction
    if (predictionLocked) {
      const pred = parseFloat(predInput.value);
      const actualDiff = Math.abs(pred - diff);
      if (actualDiff < 0.05) {
        el('prediction-feedback').textContent = `Your prediction (${pred.toFixed(2)}) was close to the simulated difference (${diff.toFixed(3)})!`;
        el('prediction-feedback').className = 'prediction-feedback correct';
      } else if (actualDiff < 0.15) {
        el('prediction-feedback').textContent = `Your prediction (${pred.toFixed(2)}) was in the right ballpark. Simulated: ${diff.toFixed(3)}.`;
        el('prediction-feedback').className = 'prediction-feedback close';
      } else {
        el('prediction-feedback').textContent = `Your prediction (${pred.toFixed(2)}) was off. Simulated: ${diff.toFixed(3)}. Under H₀, differences are typically close to 0.`;
        el('prediction-feedback').className = 'prediction-feedback off';
      }
    }

    // Discovery: show gate 3 after first shuffle, update question text on every shuffle
    const obsDiffPct = (observedDiff * 100).toFixed(1);
    const simDiffPct = (diff * 100).toFixed(1);
    if (mode === 'discover' && !hasShuffledOnce) {
      hasShuffledOnce = true;
      buildGate(3,
        `This shuffle produced a difference of ${simDiffPct} pp. The observed difference was ${obsDiffPct} pp. What does this one shuffle suggest?`,
        [
          { text: `The observed difference (${obsDiffPct} pp) seems unusually large compared to this shuffle`, correct: Math.abs(diff) < Math.abs(observedDiff) * 0.7 },
          { text: 'One shuffle isn\'t enough to tell — we need to repeat many times', correct: true },
          { text: 'The null hypothesis must be true', correct: false },
        ],
        'Exactly right. One shuffle gives us one data point. We need many shuffles to see the full picture of what\'s typical under the null hypothesis.',
        () => { autoAdvance(3); }
      );
    } else if (mode === 'discover') {
      // Update the question text with the latest shuffle result
      const qEl = document.getElementById('gate3-question');
      if (qEl) {
        qEl.textContent = `This shuffle produced a difference of ${simDiffPct} pp. The observed difference was ${obsDiffPct} pp. What does this one shuffle suggest?`;
      }
    }

    announce(`Shuffled: difference = ${(diff * 100).toFixed(1)} percentage points`);
  };

  el('shuffle-reset').onclick = () => renderStep3();
}

// Step 4: Many shuffles
function renderStep4() {
  nullDiffs = [];
  updateChart();
  updateSimStats();

  // Hide gate 4 until enough shuffles
  const gate4 = document.getElementById('gate-4');
  if (gate4) gate4.hidden = true;

  el('gen-1').onclick = () => addShuffles(1);
  el('gen-10').onclick = () => addShuffles(10);
  el('gen-100').onclick = () => addShuffles(100);
  el('gen-1000').onclick = () => addShuffles(1000);
  el('gen-reset').onclick = () => {
    nullDiffs = [];
    prng = createRng('randomization-' + datasetSelect.value);
    if (gate4) gate4.hidden = true;
    const lastSimEl = document.getElementById('last-sim-value');
    if (lastSimEl) lastSimEl.hidden = true;
    updateChart();
    updateSimStats();
    renderStep5();
  };
}

function addShuffles(n) {
  const startIdx = nullDiffs.length;
  for (let i = 0; i < n; i++) {
    nullDiffs.push(simulateOne());
  }
  // Track highlights for dotplot animation
  if (n === 1) {
    lastStatIndex = nullDiffs.length - 1;
    batchHighlightIndices = null;
  } else {
    lastStatIndex = -1;
    batchHighlightIndices = new Set();
    for (let i = startIdx; i < nullDiffs.length; i++) {
      batchHighlightIndices.add(i);
    }
  }

  // +1 drop animation: show the value, render chart, then animate
  const lastSimEl = document.getElementById('last-sim-value');
  const chartContainer = el('null-dist-chart');
  if (n === 1 && lastSimEl) {
    const val = nullDiffs[nullDiffs.length - 1];
    lastSimEl.textContent = (val * 100).toFixed(1) + ' pp';
    lastSimEl.hidden = false;
    updateChart();
    // Short delay for DOM to settle, then animate
    setTimeout(() => {
      animateDropToChart(lastSimEl, chartContainer);
    }, 30);
  } else {
    if (lastSimEl) lastSimEl.hidden = true;
    updateChart();
  }

  updateSimStats();
  renderStep5();

  // Discovery: show gate 4 once we have ≥100 shuffles
  if (mode === 'discover' && nullDiffs.length >= 100) {
    const gate4 = document.getElementById('gate-4');
    if (gate4 && gate4.hidden) {
      const extremeCount = nullDiffs.filter(isExtremeFn()).length;
      const pValue = (extremeCount / nullDiffs.length).toFixed(3);
      const obsPct = (observedDiff * 100).toFixed(1);

      buildGate(4,
        `You've run ${nullDiffs.length} simulations. The observed difference was ${obsPct} pp. Look at the histogram — where does the red line fall?`,
        [
          { text: 'The observed difference is in the middle of the distribution — it looks typical', correct: parseFloat(pValue) > 0.15 },
          { text: 'The observed difference is in the tail — very few simulations were this extreme', correct: parseFloat(pValue) <= 0.15 },
          { text: 'I can\'t tell from the histogram', correct: false },
        ],
        `The p-value is approximately ${pValue}. ${parseFloat(pValue) < 0.05
          ? 'The observed difference falls far in the tail — it would be very unlikely under the null hypothesis.'
          : 'The observed difference is not far from what we\'d expect by chance alone.'}`,
        () => { autoAdvance(4); }
      );
    }
  }
}

/** @returns {(v: number) => boolean} */
function isExtremeFn() {
  return config.direction === 'both'
    ? (v) => Math.abs(v) >= Math.abs(observedDiff)
    : config.direction === 'right'
      ? (v) => v >= observedDiff
      : (v) => v <= observedDiff;
}

function updateChart() {
  const container = el('null-dist-chart');
  container.innerHTML = '';

  if (nullDiffs.length === 0) {
    container.innerHTML = '<p style="color: var(--muted); font-size: 0.9rem; text-align: center; padding: 2rem;">Click the buttons above to generate simulated differences.</p>';
    return;
  }

  const xLabel = `Simulated difference in proportions (${config.group1Label} − ${config.group2Label})`;
  const isExtreme = isExtremeFn();
  const activeChart = resolveChartType(nullDiffs.length, chartType);

  // Sync toggle UI to reflect resolved chart type
  if (setToggleSelected) setToggleSelected(activeChart);

  /** @type {import('../../js/chart-utils.js').ChartFrame|undefined} */
  let chartFrame;
  /** @type {any} */
  let chartXScale;

  // Compute domain from data + observed stat, padded by half a step
  const allVals = [...nullDiffs, observedDiff];
  const lo = Math.min(...allVals) - discreteStep;
  const hi = Math.max(...allVals) + discreteStep;
  /** @type {[number, number]} */
  const domain = [lo, hi];

  if (activeChart === 'dotplot') {
    const highlightIndex = lastStatIndex >= 0 ? lastStatIndex : -1;
    const r = drawDotplot(container, nullDiffs, {
      id: 'null-dist',
      xLabel,
      titleText: '',
      isExtreme,
      observedStat: observedDiff,
      animate: false,
      highlightIndex,
      highlightIndices: batchHighlightIndices ?? undefined,
      domain,
      binWidth: discreteStep,
    });
    chartFrame = r.frame;
    chartXScale = r.xScale;
  } else {
    // Snap histogram bin edges to the discrete grid
    const thresholds = snappedPropThresholds(
      Math.round(1 / discreteStep),  // effective "sample size" for grid
      domain,
      nullDiffs.length,
    );
    const r = drawHistogram(container, nullDiffs, {
      xLabel,
      titleText: '',
      id: 'null-dist',
      isTail: isExtreme,
      observedStat: observedDiff,
      animate: false,
      domain,
      thresholds,
    });
    chartFrame = r.frame;
    chartXScale = r.xScale;
  }

  // Add p-value pills (shared from chart-utils.js)
  if (chartFrame && chartXScale) {
    const extremeCount = nullDiffs.filter(isExtreme).length;
    const pValue = extremeCount / nullDiffs.length;
    renderSimPills(chartFrame, chartXScale, {
      mode: 'randomization',
      pValue,
      observedStat: observedDiff,
      direction: config.direction,
    });
  }

  // Clear highlight tracking after render
  lastStatIndex = -1;
  batchHighlightIndices = null;
}

function updateSimStats() {
  const count = nullDiffs.length;
  if (count === 0) {
    el('sim-stats').textContent = 'Shuffles: 0';
    return;
  }

  const isExtreme = isExtremeFn();
  const extremeCount = nullDiffs.filter(isExtreme).length;
  const pValue = extremeCount / count;

  const pFmt = formatStat(pValue, 0, 'pvalue');
  const pDisplay = pFmt.startsWith('p') ? pFmt : `p-value: ${pFmt}`;

  el('sim-stats').innerHTML =
    `Shuffles: <strong>${count}</strong> | ` +
    `Extreme count: <strong>${extremeCount} of ${count}</strong> (right-tail) | ` +
    `<strong>${pDisplay}</strong>`;
}

// Step 5: Conclusion
function renderStep5() {
  const conclusionText = el('conclusion-text');
  const interpretationText = el('interpretation-text');
  const modelDiv = document.getElementById('model-conclusion');
  const revealBtn = document.getElementById('reveal-conclusion');
  const reflectionArea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('student-reflection'));

  if (nullDiffs.length === 0) {
    conclusionText.textContent = 'Run some simulations above to see a conclusion.';
    interpretationText.textContent = '';
    return;
  }

  const isExtreme = isExtremeFn();
  const extremeCount = nullDiffs.filter(isExtreme).length;
  const pValue = extremeCount / nullDiffs.length;
  const pct = (observedDiff * 100).toFixed(1);

  conclusionText.innerHTML =
    `Out of <strong>${nullDiffs.length}</strong> simulations under the null hypothesis, ` +
    `<strong>${extremeCount}</strong> had a difference as extreme as the observed ${pct} percentage points. ` +
    `That gives a p-value of approximately <strong>${pValue.toFixed(3)}</strong>.`;

  let strength, decision;
  if (pValue < 0.01) { strength = 'very strong'; decision = 'reject'; }
  else if (pValue < 0.05) { strength = 'strong'; decision = 'reject'; }
  else if (pValue < 0.10) { strength = 'moderate'; decision = 'might reject'; }
  else { strength = 'little to no'; decision = 'fail to reject'; }

  if (decision === 'reject' || decision === 'might reject') {
    interpretationText.innerHTML =
      `The data provide <strong>${strength}</strong> evidence against the null hypothesis (p ≈ ${pValue.toFixed(3)}). ` +
      `A difference of ${pct} percentage points would be very unusual if the null hypothesis were true, ` +
      `so we ${decision} H₀. The data suggest that ${config.altHyp.charAt(0).toLowerCase() + config.altHyp.slice(1)}`;
  } else {
    interpretationText.innerHTML =
      `The data provide <strong>${strength}</strong> evidence against the null hypothesis (p ≈ ${pValue.toFixed(3)}). ` +
      `A difference of ${pct} percentage points is not unusual under the null hypothesis, ` +
      `so we fail to reject H₀. We do not have convincing evidence that ${config.altHyp.charAt(0).toLowerCase() + config.altHyp.slice(1)}`;
  }

  // Discovery mode: reveal button shows model conclusion
  if (mode === 'discover' && revealBtn && modelDiv) {
    modelDiv.classList.remove('present-only'); // remove so it can be toggled
    modelDiv.hidden = true;
    revealBtn.onclick = () => {
      if (reflectionArea && !reflectionArea.value.trim()) {
        reflectionArea.placeholder = 'Write something first — even a sentence is fine!';
        reflectionArea.focus();
        return;
      }
      modelDiv.hidden = false;
      revealBtn.hidden = true;
    };
  }
}

// ─── Utilities ─────────────────────────────────────────────────────

/** @param {string} id */
function el(id) {
  return /** @type {HTMLElement} */ (document.getElementById(id));
}

function announce(msg) {
  const div = document.getElementById('sr-announce');
  if (div) div.textContent = msg;
}
