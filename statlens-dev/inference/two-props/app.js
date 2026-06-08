// @ts-check
/**
 * Two-Proportion z-Test and Confidence Interval — StatLens
 * Supports dataset loading, paste/file input, and manual summary entry.
 */

import * as jstat from 'jstat';
import { setJStat, pdfNormal } from '../../js/distributions.js';
import { twoPropZ } from '../../js/inference.js';
import { drawCurve, computeDomain, addInferenceAnnotations } from '../../js/curve.js';
import { formatStat } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';
import { announce, initTabs, initDataPanel, initKeyboardShortcuts, initHypToggle, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../js/page-utils.js';

/** Render LaTeX to HTML string via KaTeX. */
const tex = (/** @type {string} */ latex, display = false) =>
  katex.renderToString(latex, { throwOnError: false, displayMode: display });

setJStat(jstat);

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM references ──────────────────────────────────────────────────
const inputLabel1 = /** @type {HTMLInputElement} */ (document.getElementById('input-label1'));
const inputX1 = /** @type {HTMLInputElement} */ (document.getElementById('input-x1'));
const inputN1 = /** @type {HTMLInputElement} */ (document.getElementById('input-n1'));
const inputLabel2 = /** @type {HTMLInputElement} */ (document.getElementById('input-label2'));
const inputX2 = /** @type {HTMLInputElement} */ (document.getElementById('input-x2'));
const inputN2 = /** @type {HTMLInputElement} */ (document.getElementById('input-n2'));
const inputAlt = initHypToggle('input-alternative', () => {
  if (resultsPanel.querySelector('.results-table')) compute();
});
const inputConfLevel = /** @type {HTMLInputElement} */ (document.getElementById('input-conf-level'));
const computeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('compute-btn'));
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));
const resultBanner = /** @type {HTMLElement} */ (document.getElementById('result-summary'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const dataPreview = document.getElementById('data-preview');
const dataSummary = document.getElementById('data-summary');
const groupVarSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('group-var-select'));
const outcomeVarSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('outcome-var-select'));
const variableSelectors = document.getElementById('variable-selectors');
const successSelector = document.getElementById('success-selector');
const successOutcome = /** @type {HTMLSelectElement|null} */ (document.getElementById('success-outcome'));
const loadSummaryBtn = document.getElementById('load-summary');
const inputP0 = /** @type {HTMLInputElement} */ (document.getElementById('input-p0'));
const nullDisplay = document.getElementById('null-display');

function syncNullDisplay() {
  if (nullDisplay) nullDisplay.textContent = inputP0.value || '0';
}
inputP0.addEventListener('input', syncNullDisplay);
syncNullDisplay();
inputP0.addEventListener('input', () => {
  if (resultsPanel.querySelector('.results-table')) compute();
});

initTabs({ hintTarget: resultsPanel, hintAction: 'click Compute' });
initKeyboardShortcuts();

// ── State ───────────────────────────────────────────────────────────
/** @type {Array<Record<string, string>>} Raw rows from loaded data */
let rawRows = [];
/** @type {string[]} Categorical variable names */
let catVarNames = [];
/** Current group variable name */
let groupVar = '';
/** Current outcome variable name */
let outcomeVar = '';
/** Current success outcome value */
let successValue = '';
/** Group 1 label */
let label1 = 'Group 1';
/** Group 2 label */
let label2 = 'Group 2';
/** Group 1 successes */
let currentX1 = 0;
/** Group 1 sample size */
let currentN1 = 0;
/** Group 2 successes */
let currentX2 = 0;
/** Group 2 sample size */
let currentN2 = 0;
/** Whether data was loaded from a dataset/paste/file (vs. summary) */
let fromRawData = false;

/** @type {import('../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

// ── Data loading ────────────────────────────────────────────────────

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  // Two-proportion z requires a 2x2 design (randomization_prop). chisq-typed
  // datasets are multi-level contingency tables and would silently run on only
  // the first two levels — exclude them; they belong to the chi-square tool (REQ-024).
  datasetFilter: (/** @type {any} */ ds) => ds.type === 'randomization_prop',
  onDataset: (ds) => {
    const ctx = findContext(ds, 'two-props');
    currentContext = ctx;
    if (ctx && ctx.nullValue != null) {
      inputP0.value = String(ctx.nullValue);
      syncNullDisplay();
    }
    const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
    if (catVars.length < 2) {
      announce('This dataset needs at least two categorical variables (group + outcome).');
      return;
    }
    catVarNames = catVars.map(/** @param {any} v */ v => v.name);
    rawRows = ds.rows.map(/** @param {any} r */ r => {
      /** @type {Record<string, string>} */
      const obj = {};
      for (const col of catVarNames) obj[col] = String(r[col]);
      return obj;
    });

    setupVariableSelectors(catVarNames, ds.name);
  },
  onText: (parsed, sourceName) => {
    currentContext = null;
    const catIndices = parsed.types
      .map((t, i) => t === 'categorical' ? i : -1)
      .filter(i => i >= 0);
    if (catIndices.length < 2) {
      announce('Need at least two categorical columns (group + outcome).');
      return;
    }
    catVarNames = catIndices.map(i => parsed.headers[i]);
    rawRows = parsed.data.map(row => {
      /** @type {Record<string, string>} */
      const obj = {};
      for (const col of catVarNames) obj[col] = String(row[col]);
      return obj;
    });

    setupVariableSelectors(catVarNames, sourceName);
  },
  onClear: () => {
    rawRows = [];
    catVarNames = [];
    currentX1 = 0; currentN1 = 0;
    currentX2 = 0; currentN2 = 0;
    fromRawData = false;
    currentContext = null;
    if (dataPreview) dataPreview.hidden = true;
    if (variableSelectors) variableSelectors.hidden = true;
    if (successSelector) successSelector.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'click Compute')}</p>`;
    resultBanner.innerHTML = '';
    announce('Data cleared.');
  },
});

/**
 * Populate group and outcome variable selectors.
 * @param {string[]} varNames
 * @param {string} sourceName
 */
function setupVariableSelectors(varNames, sourceName) {
  if (!groupVarSelect || !outcomeVarSelect || !variableSelectors) return;

  groupVarSelect.innerHTML = '';
  outcomeVarSelect.innerHTML = '';
  for (const name of varNames) {
    const opt1 = document.createElement('option');
    opt1.value = name; opt1.textContent = name;
    groupVarSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = name; opt2.textContent = name;
    outcomeVarSelect.appendChild(opt2);
  }

  // Default: first as group, second as outcome
  groupVar = varNames[0];
  outcomeVar = varNames.length > 1 ? varNames[1] : varNames[0];
  groupVarSelect.value = groupVar;
  outcomeVarSelect.value = outcomeVar;
  variableSelectors.hidden = false;

  groupVarSelect.onchange = () => { groupVar = groupVarSelect.value; showSuccessSelector(sourceName); };
  outcomeVarSelect.onchange = () => { outcomeVar = outcomeVarSelect.value; showSuccessSelector(sourceName); };

  showSuccessSelector(sourceName);
}

/**
 * Show the success outcome selector for the outcome variable.
 * @param {string} sourceName
 */
function showSuccessSelector(sourceName) {
  if (!successOutcome || !successSelector) return;

  const outcomes = [...new Set(rawRows.map(r => r[outcomeVar]))];
  successOutcome.innerHTML = '';
  for (const val of outcomes) {
    const opt = document.createElement('option');
    opt.value = val; opt.textContent = val;
    successOutcome.appendChild(opt);
  }
  successSelector.hidden = false;
  successValue = outcomes[0];

  countFromData(sourceName);
  successOutcome.onchange = () => { successValue = successOutcome.value; countFromData(sourceName); };
}

/**
 * Count successes per group from the raw data.
 * @param {string} sourceName
 */
function countFromData(sourceName) {
  const groups = [...new Set(rawRows.map(r => r[groupVar]))];
  if (groups.length < 2) {
    announce('The grouping variable needs at least 2 groups.');
    return;
  }

  label1 = groups[0];
  label2 = groups[1];
  const g1Rows = rawRows.filter(r => r[groupVar] === label1);
  const g2Rows = rawRows.filter(r => r[groupVar] === label2);
  currentN1 = g1Rows.length;
  currentN2 = g2Rows.length;
  currentX1 = g1Rows.filter(r => r[outcomeVar] === successValue).length;
  currentX2 = g2Rows.filter(r => r[outcomeVar] === successValue).length;
  fromRawData = true;

  if (dataSummary) {
    const p1 = currentN1 > 0 ? formatStat(currentX1 / currentN1, 0, 'proportion') : '—';
    const p2 = currentN2 > 0 ? formatStat(currentX2 / currentN2, 0, 'proportion') : '—';
    dataSummary.textContent =
      `${sourceName}: ${label1} ${currentX1}/${currentN1} (p\u0302=${p1}), ${label2} ${currentX2}/${currentN2} (p\u0302=${p2}). Success = "${successValue}"`;
  }
  announce(`${label1}: ${currentX1}/${currentN1}, ${label2}: ${currentX2}/${currentN2}.`);
}

// ── Summary input ───────────────────────────────────────────────────

if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    const x1 = Math.round(Number(inputX1.value));
    const n1 = Math.round(Number(inputN1.value));
    const x2 = Math.round(Number(inputX2.value));
    const n2 = Math.round(Number(inputN2.value));

    if (!Number.isFinite(n1) || n1 < 1) { announce('n\u2081 must be at least 1.'); return; }
    if (!Number.isFinite(n2) || n2 < 1) { announce('n\u2082 must be at least 1.'); return; }
    if (!Number.isFinite(x1) || x1 < 0 || x1 > n1) { announce('Successes for Group 1 must be between 0 and n\u2081.'); return; }
    if (!Number.isFinite(x2) || x2 < 0 || x2 > n2) { announce('Successes for Group 2 must be between 0 and n\u2082.'); return; }

    currentX1 = x1; currentN1 = n1;
    currentX2 = x2; currentN2 = n2;
    label1 = inputLabel1.value.trim() || 'Group 1';
    label2 = inputLabel2.value.trim() || 'Group 2';
    fromRawData = false;

    if (dataSummary) {
      dataSummary.textContent =
        `Summary: ${label1} ${currentX1}/${currentN1}, ${label2} ${currentX2}/${currentN2}`;
    }
    dataPanel.triggerPostLoad();
    announce(`Loaded summary: ${label1} ${x1}/${n1}, ${label2} ${x2}/${n2}.`);
  });
}

// ── Event listeners ─────────────────────────────────────────────────
computeBtn.addEventListener('click', compute);

for (const el of [inputConfLevel]) {
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); compute(); }
  });
}

// Note: alternative change handler is wired via initHypToggle callback above

// ── Main computation ────────────────────────────────────────────────

function compute() {
  if (currentN1 < 1 || currentN2 < 1) {
    announce('Load data or enter summary statistics first.');
    return;
  }

  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.getValue());
  const confLevel = Number(inputConfLevel.value);

  if (!Number.isFinite(confLevel) || confLevel <= 0 || confLevel >= 1) {
    announce('Confidence level must be between 0 and 1 (exclusive).');
    return;
  }

  // ── Conditions checkpoint ──
  const pHat1 = currentX1 / currentN1;
  const pHat2 = currentX2 / currentN2;
  if (conditionsCheckpoint) {
    const dsId = dataPanel.currentDatasetId;
    const randLink = dsId
      ? buildSimLink('simulate/randomization-diff-props/', { dataset: dsId })
      : buildSimLink('simulate/randomization-diff-props/');
    const counts = [
      `n\u2081p\u0302\u2081 = ${formatStat(currentN1 * pHat1, 0, 'stat')}`,
      `n\u2081(1\u2212p\u0302\u2081) = ${formatStat(currentN1 * (1 - pHat1), 0, 'stat')}`,
      `n\u2082p\u0302\u2082 = ${formatStat(currentN2 * pHat2, 0, 'stat')}`,
      `n\u2082(1\u2212p\u0302\u2082) = ${formatStat(currentN2 * (1 - pHat2), 0, 'stat')}`,
    ].join(', ');
    conditionsCheckpoint.innerHTML = `
      <p><strong>Before interpreting:</strong> Have you checked the conditions for the two-proportion z-test?
      Verify each group has \u2265 5 successes and \u2265 5 failures: ${counts}.</p>
      <p>Alternative: <a href="${randLink}">Randomization Test</a> (no conditions required).</p>`;
    conditionsCheckpoint.hidden = false;
  }

  // ── Run test ──
  const nullDiff = Number(inputP0.value) || 0;
  const result = twoPropZ(currentX1, currentN1, currentX2, currentN2, { alternative, confLevel, nullDiff });

  // ── Display results ──
  displayResults(result, label1, label2);

  // ── Draw chart ──
  drawChart(result);

  // ── Screen reader announcement ──
  const pStr = formatStat(result.pValue, 0, 'pvalue');
  announce(`z = ${formatStat(result.zStat, 0, 'correlation')}, ${pStr}. ${(confLevel * 100).toFixed(0)}% CI for p\u2081 \u2212 p\u2082: (${formatStat(result.ciLower, 0, 'proportion')}, ${formatStat(result.ciUpper, 0, 'proportion')}).`);
}

// ── Display results ─────────────────────────────────────────────────

/**
 * Render results in the sidebar panel.
 * @param {import('../../js/inference.js').TwoPropResult} r
 * @param {string} lbl1
 * @param {string} lbl2
 */
function displayResults(r, lbl1, lbl2) {
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: currentN1 + currentN2 });
  const altSymbol = r.alternative === 'two-sided' ? '\u2260'
    : r.alternative === 'less' ? '<' : '>';
  const altWord = r.alternative === 'two-sided' ? 'different from'
    : r.alternative === 'less' ? 'less than' : 'greater than';

  let pInterpretation;
  if (r.pValue < 0.001) {
    pInterpretation = 'very strong evidence against H\u2080';
  } else if (r.pValue < 0.01) {
    pInterpretation = 'strong evidence against H\u2080';
  } else if (r.pValue < 0.05) {
    pInterpretation = 'moderate evidence against H\u2080';
  } else if (r.pValue < 0.10) {
    pInterpretation = 'weak evidence against H\u2080';
  } else {
    pInterpretation = 'little to no evidence against H\u2080';
  }

  const confPct = (r.confLevel * 100).toFixed(0);
  const seCount = Math.abs(r.zStat);
  const seDirection = r.zStat > 0 ? 'above' : r.zStat < 0 ? 'below' : 'at';

  // z* for CI
  const zStar = r.se > 0 ? ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3) : '—';

  const V = '\\textcolor{#569BBD}';
  const S = '\\textcolor{#7B2D8E}';
  const P = '\\textcolor{#2e7d32}';

  const testFormula = tex(`\\begin{aligned}
    z &= \\frac{\\hat{p}_1 - \\hat{p}_2}{\\sqrt{\\hat{p}(1-\\hat{p})\\left(\\frac{1}{n_1} + \\frac{1}{n_2}\\right)}} \\\\[10pt]
    &= \\frac{${V}{${formatStat(r.pHat1, 0, 'proportion')}} - ${V}{${formatStat(r.pHat2, 0, 'proportion')}}}{${V}{${formatStat(r.sePooled, 0, 'proportion')}}} \\\\[10pt]
    &= ${S}{${formatStat(r.zStat, 0, 'correlation')}}
  \\end{aligned}`, true);

  const ciFormula = tex(`\\begin{aligned}
    &(\\hat{p}_1 - \\hat{p}_2) \\pm z^* \\cdot SE \\\\[8pt]
    &${V}{${formatStat(r.diff, 0, 'proportion')}} \\pm ${V}{${zStar}} \\cdot ${V}{${formatStat(r.se, 0, 'proportion')}} \\\\[8pt]
    &= ${P}{(${formatStat(r.ciLower, 0, 'proportion')},\\; ${formatStat(r.ciUpper, 0, 'proportion')})}
  \\end{aligned}`, true);

  resultsPanel.innerHTML = `
    <h3>Sample Summary</h3>
    <table class="results-table" aria-label="Sample summary">
      <thead>
        <tr><th></th><th scope="col">${escapeHTML(lbl1)}</th><th scope="col">${escapeHTML(lbl2)}</th></tr>
      </thead>
      <tbody>
        <tr><th scope="row">Successes</th><td>${Math.round(r.pHat1 * r.n1)}</td><td>${Math.round(r.pHat2 * r.n2)}</td></tr>
        <tr><th scope="row">${tex('n')}</th><td>${r.n1}</td><td>${r.n2}</td></tr>
        <tr><th scope="row">${tex('\\hat{p}')}</th><td>${formatStat(r.pHat1, 0, 'proportion')}</td><td>${formatStat(r.pHat2, 0, 'proportion')}</td></tr>
      </tbody>
    </table>

    <div class="formula-display">
      <h3>Test Statistic</h3>
      ${testFormula}
      <p class="formula-detail">${tex(`\\text{Pooled } \\hat{p} = ${V}{${formatStat(r.pooledP, 0, 'proportion')}}`)}</p>
      <p class="formula-detail">${tex(`\\text{p-value} = ${P}{${formatStat(r.pValue, 0, 'pvalue')}}`)}</p>
    </div>

    <div class="formula-display formula-ci">
      <h3>${confPct}% CI for ${tex('p_1 - p_2')}</h3>
      ${ciFormula}
    </div>

    <div class="interpretation">
      <p>${tex('\\hat{p}_1 - \\hat{p}_2')} = ${formatStat(r.diff, 0, 'proportion')} is ${formatStat(seCount, 0, 'correlation')} SEs ${seDirection} ${formatStat(Number(inputP0.value) || 0, 0, 'proportion')}.</p>
      ${(() => {
        const alpha = 1 - r.confLevel;
        const c = generateConclusions({
          pValue: r.pValue, alpha, alternative: r.alternative,
          testType: 'two-props', statName: 'z',
          statValue: formatStat(r.zStat, 0, 'correlation'),
          context: { parameter: currentContext?.parameter, nullValue: Number(inputP0.value) || 0, claim: currentContext?.claim },
        });
        let html = `<p><strong>Formal conclusion:</strong> ${c.formal}</p>`;
        if (c.practical) html += `<p><strong>Practical conclusion:</strong> ${c.practical}</p>`;
        return html;
      })()}
      <p>${confPct}% CI: (${formatStat(r.ciLower, 0, 'proportion')}, ${formatStat(r.ciUpper, 0, 'proportion')}).</p>
    </div>
  `;

  resultBanner.innerHTML =
    `z = ${formatStat(r.zStat, 0, 'correlation')}, ${formatStat(r.pValue, 0, 'pvalue')} &nbsp;|&nbsp; ${confPct}% CI: (${formatStat(r.ciLower, 0, 'proportion')}, ${formatStat(r.ciUpper, 0, 'proportion')})`;
}

// ── Chart ───────────────────────────────────────────────────────────

/**
 * Draw the standard normal curve with z-statistic marked and p-value shaded.
 * @param {import('../../js/inference.js').TwoPropResult} r
 */
function drawChart(r) {
  chartContainer.innerHTML = '';

  const domain = computeDomain('normal', { mu: 0, sigma: 1 });
  const pdfFn = (/** @type {number} */ x) => pdfNormal(x, 0, 1);

  /** @type {'left'|'right'|'both'|undefined} */
  let tail;
  /** @type {number|undefined} */
  let critValue;
  /** @type {number|undefined} */
  let critLow;
  /** @type {number|undefined} */
  let critHigh;

  if (r.alternative === 'less') {
    tail = 'left';
    critValue = r.zStat;
  } else if (r.alternative === 'greater') {
    tail = 'right';
    critValue = r.zStat;
  } else {
    tail = 'both';
    critLow = -Math.abs(r.zStat);
    critHigh = Math.abs(r.zStat);
  }

  const chart = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 'z',
    yLabel: 'Density',
    titleText: 'Standard Normal Distribution (z-test)',
    descText: `Standard normal curve with z = ${r.zStat.toFixed(3)} marked and p-value region shaded.`,
    id: 'z-curve',
    tail,
    critValue,
    critLow,
    critHigh,
  });

  if (chart && isFinite(r.zStat)) {
    addInferenceAnnotations(chart, {
      statValue: Math.abs(r.zStat),
      statLabel: 'z',
      pValue: r.pValue,
      pdfFn,
      tail,
      statValueNeg: tail === 'both' ? -Math.abs(r.zStat) : undefined,
    });
  }

}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * @param {string} str
 * @returns {string}
 */
function escapeHTML(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
