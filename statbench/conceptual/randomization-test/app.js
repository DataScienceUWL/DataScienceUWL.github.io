// @ts-check
/**
 * Interactive Randomization Test Activity
 *
 * Walks students through the IMS Ch. 11 randomization test procedure
 * using a card-shuffle metaphor. Students see data as colored cards,
 * shuffle to simulate the null hypothesis, and build a null distribution.
 */

import { drawHistogram } from '../../js/histogram.js';
import { initHelp } from '../../js/page-utils.js';
import { createRng, shuffle as prngShuffle } from '../../js/prng.js';

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
    direction: 'right', // p1 - p2 > 0 is extreme
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
  },
};

// ─── State ─────────────────────────────────────────────────────────

/** @type {any[]} */
let rawData = [];
let config = DATASETS.sex_discrimination;
/** @type {number[]} */
let nullDiffs = [];
let observedDiff = 0;
let prng = createRng('randomization');
let predictionLocked = false;

// ─── DOM References ────────────────────────────────────────────────

const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));

// ─── Initialization ────────────────────────────────────────────────

initHelp();

datasetSelect.addEventListener('change', () => {
  loadDataset(datasetSelect.value);
});

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
  prng = createRng('randomization-' + id);

  // Compute observed data
  const { group1, group2 } = splitGroups(rawData);
  const p1 = countSuccess(group1) / group1.length;
  const p2 = countSuccess(group2) / group2.length;
  observedDiff = +(p1 - p2).toFixed(6);

  renderStep1(group1, group2);
  renderStep2();
  renderStep3();
  renderStep4();
  renderStep5();

  announce(`Loaded ${config.group1Label} vs ${config.group2Label} dataset`);
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

/** Shuffle outcomes array in-place using Fisher-Yates with seeded PRNG */
function shuffle(arr) {
  return prngShuffle(arr, prng);
}

/** Run one randomization: shuffle all outcomes, split into original group sizes, compute diff */
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
}

// Step 2: Hypotheses
function renderStep2() {
  el('step2-hypotheses').innerHTML =
    `<strong>H₀ (Null):</strong> ${config.nullHyp}<br>` +
    `<strong>Hₐ (Alternative):</strong> ${config.altHyp}`;
}

// Step 3: Single shuffle
function renderStep3() {
  const shuffledCards = el('shuffled-cards');
  const shuffledTable = el('shuffled-table');
  const shuffleResult = el('shuffle-result');
  shuffledCards.innerHTML = '<p style="color: var(--muted); font-size: 0.9rem;">Click "Shuffle once" to see a simulated result.</p>';
  shuffledTable.hidden = true;
  shuffleResult.hidden = true;
  predictionLocked = false;
  el('prediction-input').value = '';
  el('prediction-feedback').className = 'prediction-feedback hidden';
  el('predict-btn').disabled = false;

  el('predict-btn').onclick = () => {
    predictionLocked = true;
    el('predict-btn').disabled = true;
    const pred = parseFloat(el('prediction-input').value);
    if (isNaN(pred)) {
      el('prediction-feedback').textContent = 'Enter a number first!';
      el('prediction-feedback').className = 'prediction-feedback off';
      predictionLocked = false;
      el('predict-btn').disabled = false;
      return;
    }
    // Save prediction, will compare after shuffle
    el('prediction-feedback').textContent = `Prediction locked: ${pred.toFixed(2)}. Now shuffle!`;
    el('prediction-feedback').className = 'prediction-feedback close';
  };

  el('shuffle-one').onclick = () => {
    // Create shuffled version
    const outcomes = rawData.map(r => r[config.response]);
    shuffle(outcomes);
    const { group1, group2 } = splitGroups(rawData);
    const n1 = group1.length;

    // Create virtual shuffled rows
    const shuffledRows = rawData.map((r, i) => ({
      ...r,
      [config.response]: outcomes[i],
    }));

    const shuffledGroup1 = shuffledRows.filter(r => r[config.explanatory] === config.group1Value);
    const shuffledGroup2 = shuffledRows.filter(r => r[config.explanatory] === config.group2Value);

    renderCards(shuffledCards, shuffledRows);
    fillTable('shuf', shuffledGroup1, shuffledGroup2);
    shuffledTable.hidden = false;

    const sp1 = countSuccess(shuffledGroup1) / shuffledGroup1.length;
    const sp2 = countSuccess(shuffledGroup2) / shuffledGroup2.length;
    const diff = sp1 - sp2;

    shuffleResult.hidden = false;
    shuffleResult.innerHTML =
      `<strong>Simulated difference:</strong> ${(sp1 * 100).toFixed(1)}% − ${(sp2 * 100).toFixed(1)}% = ` +
      `<strong>${(diff * 100).toFixed(1)} percentage points</strong> (from chance alone)`;

    // Compare with prediction
    if (predictionLocked) {
      const pred = parseFloat(el('prediction-input').value);
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

    announce(`Shuffled: difference = ${(diff * 100).toFixed(1)} percentage points`);
  };

  el('shuffle-reset').onclick = () => renderStep3();
}

// Step 4: Many shuffles
function renderStep4() {
  nullDiffs = [];
  updateHistogram();
  updateSimStats();

  el('gen-1').onclick = () => addShuffles(1);
  el('gen-10').onclick = () => addShuffles(10);
  el('gen-100').onclick = () => addShuffles(100);
  el('gen-1000').onclick = () => addShuffles(1000);
  el('gen-reset').onclick = () => {
    nullDiffs = [];
    prng = createRng('randomization-' + datasetSelect.value);
    updateHistogram();
    updateSimStats();
    renderStep5();
  };
}

function addShuffles(n) {
  for (let i = 0; i < n; i++) {
    nullDiffs.push(simulateOne());
  }
  updateHistogram();
  updateSimStats();
  renderStep5();
}

function updateHistogram() {
  const container = el('null-dist-chart');
  container.innerHTML = '';

  if (nullDiffs.length === 0) {
    container.innerHTML = '<p style="color: var(--muted); font-size: 0.9rem; text-align: center; padding: 2rem;">Click the buttons above to generate simulated differences.</p>';
    return;
  }

  const isExtreme = config.direction === 'both'
    ? (v) => Math.abs(v) >= Math.abs(observedDiff)
    : config.direction === 'right'
      ? (v) => v >= observedDiff
      : (v) => v <= observedDiff;

  drawHistogram(container, nullDiffs, {
    xLabel: `Simulated difference in proportions (${config.group1Label} − ${config.group2Label})`,
    titleText: '',
    id: 'null-dist',
    isTail: isExtreme,
    observedStat: observedDiff,
    animate: false,
  });
}

function updateSimStats() {
  const count = nullDiffs.length;
  if (count === 0) {
    el('sim-stats').textContent = 'Shuffles: 0';
    return;
  }

  const isExtreme = config.direction === 'both'
    ? (v) => Math.abs(v) >= Math.abs(observedDiff)
    : config.direction === 'right'
      ? (v) => v >= observedDiff
      : (v) => v <= observedDiff;

  const extremeCount = nullDiffs.filter(isExtreme).length;
  const pValue = extremeCount / count;

  el('sim-stats').innerHTML =
    `Shuffles: <strong>${count}</strong> | ` +
    `As extreme as observed: <strong>${extremeCount}</strong> | ` +
    `p-value ≈ <strong>${pValue.toFixed(3)}</strong>`;
}

// Step 5: Conclusion
function renderStep5() {
  if (nullDiffs.length === 0) {
    el('conclusion-text').textContent = 'Run some simulations above to see a conclusion.';
    el('interpretation-text').textContent = '';
    return;
  }

  const isExtreme = config.direction === 'both'
    ? (v) => Math.abs(v) >= Math.abs(observedDiff)
    : config.direction === 'right'
      ? (v) => v >= observedDiff
      : (v) => v <= observedDiff;

  const extremeCount = nullDiffs.filter(isExtreme).length;
  const pValue = extremeCount / nullDiffs.length;
  const pct = (observedDiff * 100).toFixed(1);

  el('conclusion-text').innerHTML =
    `Out of <strong>${nullDiffs.length}</strong> simulations under the null hypothesis, ` +
    `<strong>${extremeCount}</strong> had a difference as extreme as the observed ${pct} percentage points. ` +
    `That gives a p-value of approximately <strong>${pValue.toFixed(3)}</strong>.`;

  let strength, decision;
  if (pValue < 0.01) { strength = 'very strong'; decision = 'reject'; }
  else if (pValue < 0.05) { strength = 'strong'; decision = 'reject'; }
  else if (pValue < 0.10) { strength = 'moderate'; decision = 'might reject'; }
  else { strength = 'little to no'; decision = 'fail to reject'; }

  if (decision === 'reject' || decision === 'might reject') {
    el('interpretation-text').innerHTML =
      `The data provide <strong>${strength}</strong> evidence against the null hypothesis (p ≈ ${pValue.toFixed(3)}). ` +
      `A difference of ${pct} percentage points would be very unusual if the null hypothesis were true, ` +
      `so we ${decision} H₀. The data suggest that ${config.altHyp.charAt(0).toLowerCase() + config.altHyp.slice(1)}`;
  } else {
    el('interpretation-text').innerHTML =
      `The data provide <strong>${strength}</strong> evidence against the null hypothesis (p ≈ ${pValue.toFixed(3)}). ` +
      `A difference of ${pct} percentage points is not unusual under the null hypothesis, ` +
      `so we fail to reject H₀. We do not have convincing evidence that ${config.altHyp.charAt(0).toLowerCase() + config.altHyp.slice(1)}`;
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
