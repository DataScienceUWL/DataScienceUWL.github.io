// @ts-check
/**
 * Chi-Square Test of Independence page controller.
 * Reads an editable contingency table, computes the chi-square test,
 * displays observed/expected tables, and draws a chi-square distribution
 * curve with right-tail shading at the test statistic.
 */

import { setJStat, pdfChisq, chisqInv } from '../../js/distributions.js';
import { chisqTest } from '../../js/inference.js';
import { drawCurve, computeDomain } from '../../js/curve.js';
import { formatStat } from '../../js/stats.js';
import { announce } from '../../js/page-utils.js';
import * as d3Selection from 'd3-selection';

// ── Initialize jStat ────────────────────────────────────────────────
const jstatMod = await import('jstat');
setJStat(jstatMod.default || jstatMod);

// ── DOM references ──────────────────────────────────────────────────
const inputRows = /** @type {HTMLInputElement} */ (document.getElementById('input-rows'));
const inputCols = /** @type {HTMLInputElement} */ (document.getElementById('input-cols'));
const tableInputContainer = /** @type {HTMLElement} */ (document.getElementById('table-input-container'));
const computeBtn = /** @type {HTMLButtonElement} */ (document.getElementById('compute-btn'));
const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear-btn'));

const chartSection = /** @type {HTMLElement} */ (document.getElementById('chart'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const warningBanner = /** @type {HTMLElement} */ (document.getElementById('warning-banner'));
const resultsSection = /** @type {HTMLElement} */ (document.getElementById('results'));
const interpretationDiv = /** @type {HTMLElement} */ (document.getElementById('interpretation'));

const resChisq = /** @type {HTMLElement} */ (document.getElementById('res-chisq'));
const resDf = /** @type {HTMLElement} */ (document.getElementById('res-df'));
const resP = /** @type {HTMLElement} */ (document.getElementById('res-p'));

const observedContainer = /** @type {HTMLElement} */ (document.getElementById('observed-table-container'));
const expectedContainer = /** @type {HTMLElement} */ (document.getElementById('expected-table-container'));

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

// ── Build editable table ────────────────────────────────────────────

/** Current table dimensions. */
let nRows = 2;
let nCols = 2;

/**
 * Build the editable contingency table with label inputs and count inputs.
 */
function buildInputTable() {
  nRows = Math.max(2, Math.min(10, parseInt(inputRows.value, 10) || 2));
  nCols = Math.max(2, Math.min(10, parseInt(inputCols.value, 10) || 2));

  // Default labels
  const rowLabels = Array.from({ length: nRows }, (_, i) => `Row ${i + 1}`);
  const colLabels = Array.from({ length: nCols }, (_, j) => `Col ${j + 1}`);

  let html = '<table class="input-table" aria-label="Editable contingency table">';

  // Header row: corner cell + column label inputs
  html += '<thead><tr>';
  html += '<td class="corner-cell"></td>';
  for (let j = 0; j < nCols; j++) {
    html += `<th scope="col"><input type="text" id="col-label-${j}" value="${colLabels[j]}" aria-label="Column ${j + 1} label"></th>`;
  }
  html += '</tr></thead>';

  // Body: row label input + count inputs
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

// Build initial table
buildInputTable();

// ── Read table data ─────────────────────────────────────────────────

/**
 * Read the contingency table from the input elements.
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

  // Check that total > 0
  const total = observed.flat().reduce((a, b) => a + b, 0);
  if (total === 0) {
    announce('All counts are zero. Enter at least some non-zero counts.');
    return null;
  }

  return { observed, rowLabels, colLabels };
}

// ── Compute button ──────────────────────────────────────────────────

computeBtn.addEventListener('click', () => {
  const data = readTable();
  if (!data) return;
  showResults(data.observed, data.rowLabels, data.colLabels);
});

// Allow Enter key in count inputs to trigger compute
tableInputContainer.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type === 'number') {
    e.preventDefault();
    computeBtn.click();
  }
});

// ── Clear button ────────────────────────────────────────────────────

clearBtn.addEventListener('click', () => {
  buildInputTable();
  chartSection.hidden = true;
  resultsSection.hidden = true;
  warningBanner.hidden = true;
  interpretationDiv.hidden = true;
  chartContainer.innerHTML = '';
  observedContainer.innerHTML = '';
  expectedContainer.innerHTML = '';
  announce('Table cleared.');
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

  // Show sections
  chartSection.hidden = false;
  resultsSection.hidden = false;
  interpretationDiv.hidden = false;

  // Populate test stats
  resChisq.textContent = result.chiSq.toFixed(4);
  resDf.textContent = String(result.df);
  resP.textContent = formatStat(result.pValue, 0, 'pvalue');

  // Check expected count condition
  let lowExpected = false;
  for (const row of result.expected) {
    for (const val of row) {
      if (val < 5) { lowExpected = true; break; }
    }
    if (lowExpected) break;
  }
  warningBanner.hidden = !lowExpected;

  // Render observed table
  renderResultTable(observedContainer, result.observed, rowLabels, colLabels,
    'Observed counts', false);

  // Render expected table (with low-expected highlighting)
  renderResultTable(expectedContainer, result.expected, rowLabels, colLabels,
    'Expected counts', true);

  // Draw chart
  drawChart(result);

  // Interpretation
  writeInterpretation(result, lowExpected);

  // Screen reader announcement
  announce(
    `Chi-square = ${result.chiSq.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, 0, 'pvalue')}.` +
    (lowExpected ? ' Warning: some expected counts are less than 5.' : '')
  );
}

// ── Render result tables ────────────────────────────────────────────

/**
 * Render an observed or expected table with row/column totals.
 * @param {HTMLElement} container
 * @param {number[][]} data - 2D array [row][col]
 * @param {string[]} rowLabels
 * @param {string[]} colLabels
 * @param {string} ariaLabel
 * @param {boolean} highlightLow - Whether to highlight cells < 5
 */
function renderResultTable(container, data, rowLabels, colLabels, ariaLabel, highlightLow) {
  const numRows = data.length;
  const numCols = data[0].length;
  const isExpected = highlightLow;

  // Compute totals
  const rowTotals = data.map(row => row.reduce((a, b) => a + b, 0));
  const colTotals = Array.from({ length: numCols }, (_, j) =>
    data.reduce((sum, row) => sum + row[j], 0));
  const grandTotal = rowTotals.reduce((a, b) => a + b, 0);

  let html = `<table class="result-table" aria-label="${ariaLabel}">`;

  // Header
  html += '<thead><tr><th></th>';
  for (let j = 0; j < numCols; j++) {
    html += `<th scope="col">${colLabels[j]}</th>`;
  }
  html += '<th scope="col" class="total-cell">Total</th>';
  html += '</tr></thead>';

  // Body
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

  // Total row
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
 * Draw the chi-square distribution curve with right-tail shading at the
 * test statistic.
 * @param {import('../../js/inference.js').ChisqResult} result
 */
function drawChart(result) {
  chartContainer.innerHTML = '';

  const { chiSq, df } = result;
  const pdfFn = (/** @type {number} */ x) => pdfChisq(x, df);
  const invCdf = (/** @type {number} */ p) => chisqInv(p, df);

  // Compute domain, extending to include the test statistic if it's extreme
  let domain = computeDomain('chisq', { df, invCdf });
  if (chiSq > domain[1]) {
    domain = [0, chiSq * 1.15];
  }

  const titleText = `Chi-square distribution (df = ${df})`;
  const descText = `Chi-square curve with df = ${df}, right-tail shaded at test statistic ${chiSq.toFixed(3)}`;

  const { xScale, yScale, frame } = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: '\u03C7\u00B2',
    yLabel: 'Density',
    titleText,
    descText,
    id: 'chisq-test-chart',
    tail: 'right',
    critValue: chiSq,
  });

  // Add vertical line at the test statistic
  const overlays = d3Selection.select(frame.inner).select('.overlays');
  const statX = xScale(chiSq);
  const yTop = yScale(pdfFn(chiSq));

  if (chiSq >= domain[0] && chiSq <= domain[1]) {
    overlays.append('line')
      .attr('class', 'chisq-stat-line')
      .attr('x1', statX)
      .attr('x2', statX)
      .attr('y1', yScale(0))
      .attr('y2', yTop)
      .attr('stroke', '#F05133')
      .attr('stroke-width', 2)
      .attr('stroke-dasharray', '6 3');

    const labelY = Math.max(yTop - 12, 4);
    overlays.append('text')
      .attr('class', 'chisq-stat-label')
      .attr('x', statX)
      .attr('y', labelY)
      .attr('text-anchor', 'middle')
      .attr('fill', '#F05133')
      .attr('font-size', '11px')
      .attr('font-weight', '700')
      .text(`\u03C7\u00B2 = ${chiSq.toFixed(3)}`);
  }
}

// ── Interpretation ──────────────────────────────────────────────────

/**
 * Write a plain-language interpretation of the chi-square test result.
 * @param {import('../../js/inference.js').ChisqResult} result
 * @param {boolean} lowExpected
 */
function writeInterpretation(result, lowExpected) {
  const { chiSq, df, pValue, rowLabels, colLabels } = result;

  const pPct = pValue < 0.0001
    ? 'less than 0.01%'
    : (pValue * 100).toFixed(2) + '%';

  const significant = pValue < 0.05;
  const conclusion = significant
    ? 'there is statistically significant evidence of an association between the row and column variables'
    : 'there is not enough evidence to conclude an association between the row and column variables';

  let html = `
    <p><strong>Hypotheses:</strong>
      H<sub>0</sub>: The row variable and column variable are independent.
      H<sub>a</sub>: There is an association between the row and column variables.</p>
    <p>The chi-square test statistic is &chi;&sup2; = ${chiSq.toFixed(4)} with
      df = ${df} (${rowLabels.length} rows &minus; 1) &times; (${colLabels.length} columns &minus; 1).</p>
    <p>If the variables were truly independent, we would see a test statistic this large
      or larger about ${pPct} of the time (p = ${formatStat(pValue, 0, 'pvalue')}).</p>
    <p>At the &alpha; = 0.05 significance level, ${conclusion}.</p>
  `;

  if (lowExpected) {
    html += `<p><strong>Caution:</strong> One or more expected counts are below 5.
      The chi-square approximation may not be accurate. Consider merging categories
      or using a simulation-based chi-square test instead.</p>`;
  }

  interpretationDiv.innerHTML = html;
}
