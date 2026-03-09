// @ts-check
/**
 * Categorical Data explore tool.
 * Contingency table with proportion toggles and bar chart modes.
 */

import { parseCSV } from '../../js/csv-parser.js';
import { drawBarChart, computeGroupedFrequencies } from '../../js/barchart.js';
import { announce, initTabs, loadDatasetIndex, fetchDataset } from '../../js/page-utils.js';

// ── DOM ──────────────────────────────────────────────────────────────

const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const datasetDesc = document.getElementById('dataset-desc');
const pasteArea = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-area'));
const loadPastedBtn = document.getElementById('load-pasted');
const clearBtn = document.getElementById('clear-btn');
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const variableControls = document.getElementById('variable-controls');
const rowVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('row-var-select'));
const colVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('col-var-select'));
const swapBtn = document.getElementById('swap-vars');
const tableSection = document.getElementById('table-section');
const chartSection = document.getElementById('chart-section');
const tableContainer = document.getElementById('table-container');
const chartContainer = document.getElementById('chart-container');
const tableModeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('table-mode'));
const chartModeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('chart-mode'));
const proportionNote = document.getElementById('proportion-note');

initTabs();

// ── State ────────────────────────────────────────────────────────────

/** @type {Array<Record<string, string>>} */
let rawRows = [];
/** @type {string[]} */
let catVarNames = [];
let rowVar = '';
let colVar = '';

// ── Dataset loading ──────────────────────────────────────────────────

/** @type {Array<{id:string, name:string, description:string, type:string, n:number}>} */
let datasetIndex = [];

if (datasetSelect) {
  loadDatasetIndex(datasetSelect,
    ds => ds.type === 'chisq' || ds.type === 'randomization_prop' || ds.type === 'randomization',
    datasetDesc)
    .then(index => { datasetIndex = index; });

  datasetSelect.addEventListener('change', () => {
    const id = datasetSelect.value;
    if (!id) return;
    const meta = datasetIndex.find(d => d.id === id);
    if (meta && datasetDesc) datasetDesc.textContent = meta.description;

    fetchDataset(id)
      .then(ds => {
        const catVars = ds.variables.filter(v => v.type === 'categorical');
        if (catVars.length < 1) {
          announce('No categorical variables found.');
          return;
        }
        catVarNames = catVars.map(v => v.name);
        rawRows = ds.rows;
        setupVariableSelectors(catVarNames);
        showDataLoaded(ds.name);
      })
      .catch(() => announce('Failed to load dataset.'));
  });
}

// ── Paste data ───────────────────────────────────────────────────────

if (loadPastedBtn && pasteArea) {
  loadPastedBtn.addEventListener('click', () => {
    const text = pasteArea.value.trim();
    if (!text) return;
    try {
      const parsed = parseCSV(text);
      const catIndices = parsed.types
        .map((t, i) => t === 'categorical' ? i : -1)
        .filter(i => i >= 0);
      if (catIndices.length < 1) {
        announce('Need at least one categorical column.');
        return;
      }
      catVarNames = catIndices.map(i => parsed.headers[i]);
      rawRows = parsed.data.map(row => {
        /** @type {Record<string, string>} */
        const obj = {};
        for (const col of catVarNames) obj[col] = String(row[col]);
        return obj;
      });
      setupVariableSelectors(catVarNames);
      showDataLoaded('Pasted data');
    } catch {
      announce('Could not parse data.');
    }
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    rawRows = [];
    catVarNames = [];
    if (pasteArea) pasteArea.value = '';
    if (dataPreview) dataPreview.hidden = true;
    if (variableControls) variableControls.hidden = true;
    if (tableSection) tableSection.hidden = true;
    if (chartSection) chartSection.hidden = true;
    if (tableContainer) tableContainer.innerHTML = '';
    if (chartContainer) chartContainer.innerHTML = '';
    announce('Data cleared.');
  });
}

// ── Variable selectors ───────────────────────────────────────────────

/**
 * @param {string[]} varNames
 */
function setupVariableSelectors(varNames) {
  rowVarSelect.innerHTML = '';
  colVarSelect.innerHTML = '';

  for (const name of varNames) {
    const opt1 = document.createElement('option');
    opt1.value = name;
    opt1.textContent = name;
    rowVarSelect.appendChild(opt1);

    const opt2 = document.createElement('option');
    opt2.value = name;
    opt2.textContent = name;
    colVarSelect.appendChild(opt2);
  }

  // Default: first variable as row, second as column (if available)
  rowVar = varNames[0];
  colVar = varNames.length > 1 ? varNames[1] : varNames[0];
  rowVarSelect.value = rowVar;
  colVarSelect.value = colVar;

  if (variableControls) variableControls.hidden = varNames.length < 2;
}

rowVarSelect.addEventListener('change', () => {
  rowVar = rowVarSelect.value;
  updateDisplay();
});

colVarSelect.addEventListener('change', () => {
  colVar = colVarSelect.value;
  updateDisplay();
});

if (swapBtn) {
  swapBtn.addEventListener('click', () => {
    const temp = rowVar;
    rowVar = colVar;
    colVar = temp;
    rowVarSelect.value = rowVar;
    colVarSelect.value = colVar;
    updateDisplay();
    announce('Variables swapped.');
  });
}

// ── Display controls ─────────────────────────────────────────────────

tableModeSelect.addEventListener('change', () => updateDisplay());
chartModeSelect.addEventListener('change', () => updateDisplay());

// ── Show data ────────────────────────────────────────────────────────

/**
 * @param {string} sourceName
 */
function showDataLoaded(sourceName) {
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) dataSummary.textContent = `${sourceName} (n = ${rawRows.length})`;
  updateDisplay();
  announce(`Loaded ${rawRows.length} observations.`);
}

function updateDisplay() {
  if (rawRows.length === 0) return;

  // For single-variable case
  const isSingleVar = catVarNames.length === 1 || rowVar === colVar;

  if (isSingleVar) {
    const values = rawRows.map(r => r[rowVar]);
    renderSingleVarTable(values, rowVar);
    renderChart(values, rowVar);
  } else {
    const rowValues = rawRows.map(r => r[rowVar]);
    const colValues = rawRows.map(r => r[colVar]);
    renderTwoVarTable(rowValues, colValues);
    renderChart(rowValues, rowVar, colValues, colVar);
  }

  if (tableSection) tableSection.hidden = false;
  if (chartSection) chartSection.hidden = false;
}

// ── Single-variable table ────────────────────────────────────────────

/**
 * @param {string[]} values
 * @param {string} varName
 */
function renderSingleVarTable(values, varName) {
  if (!tableContainer) return;
  const mode = tableModeSelect.value;

  // Count frequencies
  /** @type {Map<string, number>} */
  const counts = new Map();
  const cats = [];
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!cats.includes(v)) cats.push(v);
  }
  const total = values.length;

  let html = '<table class="contingency-table" aria-label="Frequency table">';
  html += `<thead><tr><th scope="col">${varName}</th>`;
  html += mode === 'counts'
    ? '<th scope="col">Count</th>'
    : '<th scope="col">Proportion</th>';
  html += '</tr></thead><tbody>';

  for (const cat of cats) {
    const count = counts.get(cat) ?? 0;
    const display = mode === 'counts' ? count : (count / total).toFixed(3);
    html += `<tr><th scope="row">${cat}</th><td>${display}</td></tr>`;
  }

  html += '</tbody>';
  html += '<tfoot><tr class="total-row">';
  html += `<th scope="row">Total</th><td>${mode === 'counts' ? total : '1.000'}</td>`;
  html += '</tr></tfoot></table>';

  tableContainer.innerHTML = html;
  if (proportionNote) proportionNote.hidden = true;
}

// ── Two-variable contingency table ───────────────────────────────────

/**
 * @param {string[]} rowValues
 * @param {string[]} colValues
 */
function renderTwoVarTable(rowValues, colValues) {
  if (!tableContainer) return;
  const mode = tableModeSelect.value;

  const { primaryCats, secondaryCats, table, primaryTotals } =
    computeGroupedFrequencies(rowValues, colValues);

  // Column totals
  /** @type {Map<string, number>} */
  const colTotals = new Map();
  for (const s of secondaryCats) {
    let sum = 0;
    for (const p of primaryCats) sum += table.get(p)?.get(s) ?? 0;
    colTotals.set(s, sum);
  }
  const grandTotal = rowValues.length;

  let html = `<table class="contingency-table" aria-label="Contingency table: ${rowVar} × ${colVar}">`;
  html += `<thead><tr><th scope="col">${rowVar} \\ ${colVar}</th>`;
  for (const s of secondaryCats) {
    html += `<th scope="col">${s}</th>`;
  }
  html += '<th scope="col" class="total-col">Total</th></tr></thead><tbody>';

  for (const p of primaryCats) {
    html += `<tr><th scope="row">${p}</th>`;
    const rowTotal = primaryTotals.get(p) ?? 0;
    for (const s of secondaryCats) {
      const count = table.get(p)?.get(s) ?? 0;
      html += `<td>${formatCell(count, rowTotal, colTotals.get(s) ?? 0, grandTotal, mode)}</td>`;
    }
    html += `<td class="total-col">${formatTotal(rowTotal, grandTotal, mode, 'row')}</td>`;
    html += '</tr>';
  }

  // Total row
  html += '<tr class="total-row"><th scope="row">Total</th>';
  for (const s of secondaryCats) {
    const ct = colTotals.get(s) ?? 0;
    html += `<td>${formatTotal(ct, grandTotal, mode, 'col')}</td>`;
  }
  html += `<td class="total-col">${mode === 'counts' ? grandTotal : '1.000'}</td>`;
  html += '</tr></tbody></table>';

  tableContainer.innerHTML = html;

  // Proportion note
  if (proportionNote) {
    if (mode === 'row') {
      proportionNote.textContent = 'Each row sums to 1. Read across to compare within each row category.';
      proportionNote.hidden = false;
    } else if (mode === 'col') {
      proportionNote.textContent = 'Each column sums to 1. Read down to compare within each column category.';
      proportionNote.hidden = false;
    } else if (mode === 'cell') {
      proportionNote.textContent = 'All cells sum to 1. Each value is the proportion of the total.';
      proportionNote.hidden = false;
    } else {
      proportionNote.hidden = true;
    }
  }
}

/**
 * @param {number} count
 * @param {number} rowTotal
 * @param {number} colTotal
 * @param {number} grandTotal
 * @param {string} mode
 * @returns {string}
 */
function formatCell(count, rowTotal, colTotal, grandTotal, mode) {
  switch (mode) {
    case 'row': return (count / rowTotal).toFixed(3);
    case 'col': return (count / colTotal).toFixed(3);
    case 'cell': return (count / grandTotal).toFixed(3);
    default: return String(count);
  }
}

/**
 * @param {number} subtotal
 * @param {number} grandTotal
 * @param {string} mode
 * @param {'row'|'col'} direction
 * @returns {string}
 */
function formatTotal(subtotal, grandTotal, mode, direction) {
  if (mode === 'counts') return String(subtotal);
  if (mode === direction) return '1.000';
  return (subtotal / grandTotal).toFixed(3);
}

// ── Bar chart ────────────────────────────────────────────────────────

/**
 * @param {string[]} primaryValues
 * @param {string} primaryLabel
 * @param {string[]} [secondaryValues]
 * @param {string} [secondaryLabel]
 */
function renderChart(primaryValues, primaryLabel, secondaryValues, secondaryLabel) {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';

  const chartMode = chartModeSelect.value;

  if (chartMode === 'relative' || !secondaryValues) {
    // Single-variable bar chart
    drawBarChart(chartContainer, primaryValues, {
      mode: chartMode === 'relative' ? 'relative' : 'frequency',
      xLabel: primaryLabel,
      titleText: `${primaryLabel}`,
      id: 'cat-chart',
      animate: true,
    });
  } else {
    // Grouped bar chart — use dodged for frequency, stacked/filled as selected
    /** @type {import('../../js/barchart.js').BarMode} */
    const barMode = chartMode === 'frequency' ? 'dodged' : chartMode;
    drawBarChart(chartContainer, primaryValues, {
      mode: barMode,
      groupValues: secondaryValues,
      xLabel: primaryLabel,
      titleText: `${primaryLabel} by ${secondaryLabel}`,
      id: 'cat-chart',
      animate: true,
    });
  }
}

