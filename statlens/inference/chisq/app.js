// @ts-check
/**
 * Chi-Square Test of Independence page controller.
 * Supports dataset loading, paste/file input, and manual contingency table entry.
 * Computes the chi-square test, displays observed/expected tables, and draws
 * a chi-square distribution curve with right-tail shading.
 */

import { setJStat, pdfChisq, chisqInv } from '../../js/distributions.js';
import { chisqTest } from '../../js/inference.js';
import { drawCurve, computeDomain, addInferenceAnnotations } from '../../js/curve.js';
import { formatStat } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';
import { announce, initTabs, initDataPanel, initKeyboardShortcuts, buildSimLink, setPageTitle } from '../../js/page-utils.js';

/** Render LaTeX to HTML string via KaTeX. */
const tex = (/** @type {string} */ latex, display = false) =>
  katex.renderToString(latex, { throwOnError: false, displayMode: display });

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── Initialize jStat ────────────────────────────────────────────────
const jstatMod = await import('jstat');
setJStat(jstatMod.default || jstatMod);

// ── DOM references ──────────────────────────────────────────────────
const inputRows = /** @type {HTMLInputElement} */ (document.getElementById('input-rows'));
const inputCols = /** @type {HTMLInputElement} */ (document.getElementById('input-cols'));
const tableInputContainer = /** @type {HTMLElement} */ (document.getElementById('table-input-container'));
const loadTableBtn = /** @type {HTMLButtonElement} */ (document.getElementById('load-table'));
const clearTableBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear-table'));
const computeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('compute-btn'));
const controlsSection = /** @type {HTMLElement} */ (document.getElementById('controls'));

const chartSection = /** @type {HTMLElement} */ (document.getElementById('chart'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));
const resultsSection = /** @type {HTMLElement} */ (document.getElementById('results'));
const interpretationDiv = /** @type {HTMLElement} */ (document.getElementById('interpretation'));

const resChisq = /** @type {HTMLElement} */ (document.getElementById('res-chisq'));
const resDf = /** @type {HTMLElement} */ (document.getElementById('res-df'));
const resP = /** @type {HTMLElement} */ (document.getElementById('res-p'));

const observedContainer = /** @type {HTMLElement} */ (document.getElementById('observed-table-container'));
const expectedContainer = /** @type {HTMLElement} */ (document.getElementById('expected-table-container'));

const dataPreview = document.getElementById('data-preview');
const dataSummary = document.getElementById('data-summary');
const variableSelectors = document.getElementById('variable-selectors');
const rowVarSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('row-var-select'));
const colVarSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('col-var-select'));

initTabs();
initKeyboardShortcuts();

// ── State ───────────────────────────────────────────────────────────
/** @type {number[][] | null} Current observed table (from data or manual entry) */
let currentObserved = null;
/** @type {string[]} */
let currentRowLabels = [];
/** @type {string[]} */
let currentColLabels = [];

/** @type {Array<Record<string, string>>} Raw rows from loaded data */
let rawRows = [];
/** @type {string[]} Categorical variable names */
let catVarNames = [];
let rowVar = '';
let colVar = '';

/** @type {import('../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

// ── Keyboard help dialog ────────────────────────────────────────────
const helpDialog = /** @type {HTMLDialogElement|null} */ (
  document.getElementById('keyboard-help'));
if (helpDialog) {
  const closeBtn = helpDialog.querySelector('button');
  if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '?') helpDialog.showModal();
  });
}

// ── Data loading (datasets, paste, file) ────────────────────────────

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: (/** @type {any} */ ds) => ds.type === 'randomization_prop' || ds.type === 'chisq',
  onDataset: (ds) => {
    const ctx = findContext(ds, 'chisq');
    currentContext = ctx;

    const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
    if (catVars.length < 2) {
      announce('This dataset needs at least two categorical variables.');
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
      announce('Need at least two categorical columns.');
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
    currentObserved = null;
    currentRowLabels = [];
    currentColLabels = [];
    currentContext = null;
    if (dataPreview) dataPreview.hidden = true;
    if (variableSelectors) variableSelectors.hidden = true;
    controlsSection.hidden = true;
    chartSection.hidden = true;
    resultsSection.hidden = true;
    conditionsCheckpoint.hidden = true;
    interpretationDiv.hidden = true;
    chartContainer.innerHTML = '';
    observedContainer.innerHTML = '';
    expectedContainer.innerHTML = '';
    announce('Data cleared.');
  },
});

/**
 * Populate row and column variable selectors.
 * @param {string[]} varNames
 * @param {string} sourceName
 */
function setupVariableSelectors(varNames, sourceName) {
  if (!rowVarSelect || !colVarSelect || !variableSelectors) return;

  rowVarSelect.innerHTML = '';
  colVarSelect.innerHTML = '';
  for (const name of varNames) {
    const opt1 = document.createElement('option');
    opt1.value = name; opt1.textContent = name;
    rowVarSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = name; opt2.textContent = name;
    colVarSelect.appendChild(opt2);
  }

  rowVar = varNames[0];
  colVar = varNames.length > 1 ? varNames[1] : varNames[0];
  rowVarSelect.value = rowVar;
  colVarSelect.value = colVar;
  variableSelectors.hidden = false;

  rowVarSelect.onchange = () => { rowVar = rowVarSelect.value; buildFromRawData(sourceName); };
  colVarSelect.onchange = () => { colVar = colVarSelect.value; buildFromRawData(sourceName); };

  buildFromRawData(sourceName);
}

/**
 * Build contingency table from raw data using selected row/col variables.
 * @param {string} sourceName
 */
function buildFromRawData(sourceName) {
  if (rowVar === colVar) {
    announce('Row and column variables must be different.');
    return;
  }

  // Compute contingency table
  const rowCats = /** @type {string[]} */ ([]);
  const colCats = /** @type {string[]} */ ([]);
  /** @type {Map<string, Map<string, number>>} */
  const table = new Map();

  for (const r of rawRows) {
    const rv = r[rowVar];
    const cv = r[colVar];
    if (!rowCats.includes(rv)) rowCats.push(rv);
    if (!colCats.includes(cv)) colCats.push(cv);
    if (!table.has(rv)) table.set(rv, new Map());
    const rowMap = /** @type {Map<string, number>} */ (table.get(rv));
    rowMap.set(cv, (rowMap.get(cv) ?? 0) + 1);
  }

  // Convert to 2D array
  currentRowLabels = rowCats;
  currentColLabels = colCats;
  currentObserved = rowCats.map(rv =>
    colCats.map(cv => table.get(rv)?.get(cv) ?? 0)
  );

  if (dataSummary) {
    dataSummary.textContent =
      `${sourceName}: ${rowVar} (${rowCats.length} levels) × ${colVar} (${colCats.length} levels), n = ${rawRows.length}`;
  }
  controlsSection.hidden = false;
  announce(`Contingency table: ${rowCats.length} × ${colCats.length}, n = ${rawRows.length}.`);
}

// ── Editable table (Enter Table tab) ────────────────────────────────

let nRows = 2;
let nCols = 2;

function buildInputTable() {
  nRows = Math.max(2, Math.min(10, parseInt(inputRows.value, 10) || 2));
  nCols = Math.max(2, Math.min(10, parseInt(inputCols.value, 10) || 2));

  const rowLabels = Array.from({ length: nRows }, (_, i) => `Row ${i + 1}`);
  const colLabels = Array.from({ length: nCols }, (_, j) => `Col ${j + 1}`);

  let html = '<table class="input-table" aria-label="Editable contingency table">';
  html += '<thead><tr>';
  html += '<td class="corner-cell"></td>';
  for (let j = 0; j < nCols; j++) {
    html += `<th scope="col"><input type="text" id="col-label-${j}" value="${colLabels[j]}" aria-label="Column ${j + 1} label"></th>`;
  }
  html += '</tr></thead>';

  html += '<tbody>';
  for (let i = 0; i < nRows; i++) {
    html += '<tr>';
    html += `<th scope="row"><input type="text" id="row-label-${i}" value="${rowLabels[i]}" aria-label="Row ${i + 1} label"></th>`;
    for (let j = 0; j < nCols; j++) {
      html += `<td><input type="number" id="cell-${i}-${j}" value="0" min="0" step="1" aria-label="Count for ${rowLabels[i]}, ${colLabels[j]}"></td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';

  tableInputContainer.innerHTML = html;
}

inputRows.addEventListener('change', buildInputTable);
inputCols.addEventListener('change', buildInputTable);
buildInputTable();

/**
 * Read the contingency table from the editable input.
 * @returns {{ observed: number[][], rowLabels: string[], colLabels: string[] } | null}
 */
function readTable() {
  const rowLabels = [];
  const colLabels = [];
  const observed = [];

  for (let i = 0; i < nRows; i++) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(`row-label-${i}`));
    rowLabels.push(el.value.trim() || `Row ${i + 1}`);
  }
  for (let j = 0; j < nCols; j++) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(`col-label-${j}`));
    colLabels.push(el.value.trim() || `Col ${j + 1}`);
  }

  for (let i = 0; i < nRows; i++) {
    const row = [];
    for (let j = 0; j < nCols; j++) {
      const el = /** @type {HTMLInputElement} */ (document.getElementById(`cell-${i}-${j}`));
      const val = parseInt(el.value, 10);
      if (isNaN(val) || val < 0) {
        announce(`Invalid count in ${rowLabels[i]}, ${colLabels[j]}. Counts must be non-negative integers.`);
        el.focus();
        return null;
      }
      row.push(val);
    }
    observed.push(row);
  }

  const total = observed.flat().reduce((a, b) => a + b, 0);
  if (total === 0) {
    announce('All counts are zero. Enter at least some non-zero counts.');
    return null;
  }

  return { observed, rowLabels, colLabels };
}

// Load table button
loadTableBtn.addEventListener('click', () => {
  const data = readTable();
  if (!data) return;
  currentObserved = data.observed;
  currentRowLabels = data.rowLabels;
  currentColLabels = data.colLabels;

  const total = data.observed.flat().reduce((a, b) => a + b, 0);
  if (dataSummary) {
    dataSummary.textContent =
      `Manual table: ${data.rowLabels.length} × ${data.colLabels.length}, n = ${total}`;
  }
  dataPanel.triggerPostLoad();
  controlsSection.hidden = false;
  announce(`Table loaded: ${data.rowLabels.length} × ${data.colLabels.length}, n = ${total}.`);
});

// Allow Enter in count inputs to trigger load
tableInputContainer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'number') {
    e.preventDefault();
    loadTableBtn.click();
  }
});

// Clear table button
clearTableBtn.addEventListener('click', () => {
  buildInputTable();
  announce('Table cleared.');
});

// ── Compute ─────────────────────────────────────────────────────────

computeBtn.addEventListener('click', () => {
  if (!currentObserved || currentObserved.length === 0) {
    announce('Load data or enter a contingency table first.');
    return;
  }
  showResults(currentObserved, currentRowLabels, currentColLabels);
});

// ── Core: compute and display ───────────────────────────────────────

/**
 * Run the chi-square test and display all results.
 * @param {number[][]} observed
 * @param {string[]} rowLabels
 * @param {string[]} colLabels
 */
function showResults(observed, rowLabels, colLabels) {
  const result = chisqTest(observed, rowLabels, colLabels);
  const totalN = observed.flat().reduce((a, b) => a + b, 0);
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: totalN });

  chartSection.hidden = false;
  resultsSection.hidden = false;
  interpretationDiv.hidden = false;

  resChisq.textContent = result.chiSq.toFixed(4);
  resDf.textContent = String(result.df);
  resP.textContent = formatStat(result.pValue, 0, 'pvalue');

  // Check for low expected counts
  let lowExpected = false;
  for (const row of result.expected) {
    for (const val of row) {
      if (val < 5) { lowExpected = true; break; }
    }
    if (lowExpected) break;
  }

  // Conditions checkpoint
  if (conditionsCheckpoint) {
    const dsId = dataPanel.currentDatasetId;
    const randLink = dsId
      ? buildSimLink('simulate/randomization-chisq/', { dataset: dsId })
      : buildSimLink('simulate/randomization-chisq/');
    const condNote = lowExpected
      ? ' Note: one or more expected counts are below 5.'
      : '';
    conditionsCheckpoint.innerHTML = `
      <p><strong>Before interpreting:</strong> Have you checked the conditions for the chi-square test?
      Verify that all expected counts are \u2265 5.${condNote}</p>
      <p>Alternative: <a href="${randLink}">Simulation-Based Chi-Square Test</a> (no conditions required).</p>`;
    conditionsCheckpoint.hidden = false;
  }

  // Render formula display
  const formulaEl = document.getElementById('formula-container');
  if (formulaEl) {
    const nR = rowLabels.length;
    const nC = colLabels.length;
    const S = '\\textcolor{#7B2D8E}';
    const P = '\\textcolor{#2e7d32}';

    const chiFormula = tex(`\\chi^2 = \\sum \\frac{(O - E)^2}{E}`, true);

    formulaEl.innerHTML = `
      <div class="formula-display">
        <h3>Test Statistic</h3>
        ${chiFormula}
        <p class="formula-detail">${tex(`\\text{df} = (${nR} - 1)(${nC} - 1) = ${P}{${result.df}}`)}</p>
        <p class="formula-detail">${tex(`\\chi^2 = ${S}{${result.chiSq.toFixed(4)}}`)}</p>
        <p class="formula-detail">${tex(`\\text{p-value} = ${P}{${formatStat(result.pValue, 0, 'pvalue')}}`)}</p>
      </div>
    `;
    formulaEl.hidden = false;
  }

  renderResultTable(observedContainer, result.observed, rowLabels, colLabels,
    'Observed counts', false);
  renderResultTable(expectedContainer, result.expected, rowLabels, colLabels,
    'Expected counts', true);

  drawChart(result);
  writeInterpretation(result);

  announce(
    `Chi-square = ${result.chiSq.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, 0, 'pvalue')}.`
  );
}

// ── Render result tables ────────────────────────────────────────────

/**
 * @param {HTMLElement} container
 * @param {number[][]} data
 * @param {string[]} rowLabels
 * @param {string[]} colLabels
 * @param {string} ariaLabel
 * @param {boolean} highlightLow
 */
function renderResultTable(container, data, rowLabels, colLabels, ariaLabel, highlightLow) {
  const numRows = data.length;
  const numCols = data[0].length;
  const isExpected = highlightLow;

  const rowTotals = data.map(row => row.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: numCols }, (_, j) =>
    data.reduce((sum, row) => sum + row[j], 0));
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

  let html = `<table class="result-table" aria-label="${ariaLabel}">`;
  html += '<thead><tr><th></th>';
  for (let j = 0; j < numCols; j++) {
    html += `<th scope="col">${colLabels[j]}</th>`;
  }
  html += '<th scope="col" class="total-cell">Total</th>';
  html += '</tr></thead>';

  html += '<tbody>';
  for (let i = 0; i < numRows; i++) {
    html += `<tr><th scope="row">${rowLabels[i]}</th>`;
    for (let j = 0; j < numCols; j++) {
      const val = data[i][j];
      const formatted = isExpected ? val.toFixed(2) : String(val);
      const cls = (highlightLow && val < 5) ? ' class="low-expected"' : '';
      html += `<td${cls}>${formatted}</td>`;
    }
    const rowTotal = rowTotals[i];
    html += `<td class="total-cell">${isExpected ? rowTotal.toFixed(2) : String(rowTotal)}</td>`;
    html += '</tr>';
  }

  html += '<tr class="total-row"><th scope="row" class="total-cell">Total</th>';
  for (let j = 0; j < numCols; j++) {
    const ct = colTotals[j];
    html += `<td class="total-cell">${isExpected ? ct.toFixed(2) : String(ct)}</td>`;
  }
  html += `<td class="total-cell">${isExpected ? grandTotal.toFixed(2) : String(grandTotal)}</td>`;
  html += '</tr></tbody></table>';

  container.innerHTML = html;
}

// ── Draw chi-square curve ───────────────────────────────────────────

/**
 * @param {import('../../js/inference.js').ChisqResult} result
 */
function drawChart(result) {
  chartContainer.innerHTML = '';

  const { chiSq, df } = result;
  const pdfFn = (/** @type {number} */ x) => pdfChisq(x, df);
  const invCdf = (/** @type {number} */ p) => chisqInv(p, df);

  let domain = computeDomain('chisq', { df, invCdf });
  if (chiSq > domain[1]) {
    domain = [0, chiSq * 1.15];
  }

  const titleText = `Chi-square distribution (df = ${df})`;
  const descText = `Chi-square curve with df = ${df}, right-tail shaded at test statistic ${chiSq.toFixed(3)}`;

  const chart = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: '\u03C7\u00B2',
    yLabel: 'Density',
    titleText,
    descText,
    id: 'chisq-test-chart',
    tail: 'right',
    critValue: chiSq,
  });

  addInferenceAnnotations(chart, {
    statValue: chiSq,
    statLabel: '\u03C7\u00B2',
    pValue: result.pValue,
    pdfFn,
    tail: 'right',
  });

}

// ── Interpretation ──────────────────────────────────────────────────

/**
 * @param {import('../../js/inference.js').ChisqResult} result
 */
function writeInterpretation(result) {
  const { chiSq, df, pValue, rowLabels, colLabels } = result;

  const pPct = pValue < 0.0001
    ? 'less than 0.01%'
    : (pValue * 100).toFixed(2) + '%';

  const conclusions = generateConclusions({
    pValue, alpha: 0.05, alternative: 'greater',
    testType: 'chisq',
    statName: '\u03C7\u00B2',
    statValue: chiSq.toFixed(3),
    context: {
      parameter: currentContext?.parameter,
      claim: currentContext?.claim,
    },
  });

  interpretationDiv.innerHTML = `
    <p><strong>Hypotheses:</strong>
      ${tex('H_0')}: The row variable and column variable are independent.
      ${tex('H_a')}: There is an association between the row and column variables.</p>
    <p>The chi-square test statistic is ${tex(`\\chi^2 = ${chiSq.toFixed(4)}`)} with
      df = ${df} (${rowLabels.length} rows \u2212 1) \u00D7 (${colLabels.length} columns \u2212 1).</p>
    <p>If the variables were truly independent, we would see a test statistic this large
      or larger about ${pPct} of the time (p = ${formatStat(pValue, 0, 'pvalue')}).</p>
    <p><strong>Formal conclusion:</strong> ${conclusions.formal}</p>
    ${conclusions.practical ? `<p><strong>Practical conclusion:</strong> ${conclusions.practical}</p>` : ''}
  `;
}
