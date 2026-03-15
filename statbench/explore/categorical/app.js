// @ts-check
/**
 * Categorical Data explore tool.
 * Contingency table with proportion toggles and bar chart modes.
 */

import { drawBarChart, computeGroupedFrequencies } from '../../js/barchart.js';
import { formatStat } from '../../js/stats.js';
import { announce, initTabs, initDataPanel, initHelp } from '../../js/page-utils.js';

initHelp();

// ── DOM ──────────────────────────────────────────────────────────────

const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const variableControls = document.getElementById('variable-controls');
const rowVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('row-var-select'));
const colVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('col-var-select'));
const swapBtn = document.getElementById('swap-vars');
const resultsSection = document.getElementById('results-section');
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

/**
 * When true, the chart's x-axis and fill are swapped relative to the table's
 * row/column layout. The table structure stays the same; only the chart
 * perspective and table color-tinting change.
 */
let chartFlipped = false;

// ── Data loading ─────────────────────────────────────────────────────

/**
 * Load parsed CSV data (shared by paste + file).
 * @param {{headers:string[], types:string[], data:Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function loadParsedData(parsed, sourceName) {
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
  showDataLoaded(sourceName);
}

/** Group label for categorical datasets. @param {any} ds */
function catGroupFn(ds) {
  if (ds.type === 'chisq' || ds.type === 'randomization_prop') return '1:Two Categorical Variables';
  if (ds.type === 'one_cat' || ds.type === 'bootstrap_prop') return '2:One Categorical Variable';
  if (ds.hasNumeric) return '3:With Quantitative Variable';
  // Fallback: use variable count
  return (ds.variables?.length ?? 0) >= 2 ? '1:Two Categorical Variables' : '2:One Categorical Variable';
}

initDataPanel({
  autoCollapse: true,
  showPreview: true,
  datasetFilter: (/** @type {any} */ ds) => ds.hasCategorical === true,
  datasetGroupFn: catGroupFn,
  onDataset: (ds) => {
    const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
    if (catVars.length === 0) {
      announce('This dataset has no categorical variables.');
      return;
    }
    catVarNames = catVars.map(/** @param {any} v */ v => v.name);
    rawRows = ds.rows;
    setupVariableSelectors(catVarNames);
    showDataLoaded(ds.name);
  },
  onText: loadParsedData,
  onClear: () => {
    rawRows = [];
    catVarNames = [];
    if (dataPreview) dataPreview.hidden = true;
    if (variableControls) variableControls.hidden = true;
    if (resultsSection) resultsSection.hidden = true;
    if (tableContainer) tableContainer.innerHTML = '';
    if (chartContainer) chartContainer.innerHTML = '';
    announce('Data cleared.');
  },
});

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
  chartFlipped = false;
  updateDisplay();
});

colVarSelect.addEventListener('change', () => {
  colVar = colVarSelect.value;
  chartFlipped = false;
  updateDisplay();
});

if (swapBtn) {
  swapBtn.addEventListener('click', () => {
    chartFlipped = !chartFlipped;
    updateDisplay();
    announce(chartFlipped
      ? `Chart: ${colVar} on x-axis, colored by ${rowVar}.`
      : `Chart: ${rowVar} on x-axis, colored by ${colVar}.`);
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
  if (dataSummary) dataSummary.textContent = `${sourceName} (n = ${rawRows.length})`;
  updateDisplay();
  announce(`${rawRows.length} observations.`);
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

    // Table always uses rowVar → rows, colVar → columns
    renderTwoVarTable(rowValues, colValues);

    // Chart may flip which variable is x-axis vs fill
    const chartPrimary = chartFlipped ? colValues : rowValues;
    const chartPrimaryLabel = chartFlipped ? colVar : rowVar;
    const chartSecondary = chartFlipped ? rowValues : colValues;
    const chartSecondaryLabel = chartFlipped ? rowVar : colVar;
    renderChart(chartPrimary, chartPrimaryLabel, chartSecondary, chartSecondaryLabel);

    // Color the table dimension that matches the chart's fill variable
    applyTableColors(chartFlipped ? 'row' : 'col');
  }

  if (resultsSection) resultsSection.hidden = false;
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
  /** @type {string[]} */
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
    const display = mode === 'counts' ? count : formatStat(count / total, 0, 'proportion');
    html += `<tr><th scope="row">${cat}</th><td>${display}</td></tr>`;
  }

  html += '</tbody>';
  html += '<tfoot><tr class="total-row">';
  html += `<th scope="row">Total</th><td>${mode === 'counts' ? total : formatStat(1, 0, 'proportion')}</td>`;
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
  html += `<td class="total-col">${mode === 'counts' ? grandTotal : formatStat(1, 0, 'proportion')}</td>`;
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
    case 'row': return formatStat(count / rowTotal, 0, 'proportion');
    case 'col': return formatStat(count / colTotal, 0, 'proportion');
    case 'cell': return formatStat(count / grandTotal, 0, 'proportion');
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
  if (mode === direction) return formatStat(1, 0, 'proportion');
  return formatStat(subtotal / grandTotal, 0, 'proportion');
}

// ── Bar chart ────────────────────────────────────────────────────────

/** Last color map from grouped chart (for table tinting). @type {null | { categories: string[], colors: string[] }} */
let lastColorMap = null;

/**
 * @param {string[]} primaryValues
 * @param {string} primaryLabel
 * @param {string[]} [secondaryValues]
 * @param {string} [secondaryLabel]
 */
function renderChart(primaryValues, primaryLabel, secondaryValues, secondaryLabel) {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';
  lastColorMap = null;

  const chartMode = chartModeSelect.value;

  if (chartMode === 'relative' || !secondaryValues) {
    // Single-variable bar chart
    drawBarChart(chartContainer, primaryValues, {
      mode: chartMode === 'relative' ? 'relative' : 'frequency',
      xLabel: primaryLabel,
      titleText: `${primaryLabel}`,
      id: 'cat-chart',
      animate: false,
    });
  } else {
    // Grouped bar chart — use dodged for frequency, stacked/filled as selected
    const barMode = /** @type {import('../../js/barchart.js').BarMode} */ (
      chartMode === 'frequency' ? 'dodged' : chartMode);
    const result = drawBarChart(chartContainer, primaryValues, {
      mode: barMode,
      groupValues: secondaryValues,
      groupLabel: secondaryLabel,
      xLabel: primaryLabel,
      titleText: `${primaryLabel} by ${secondaryLabel}`,
      id: 'cat-chart',
      animate: false,
    });
    lastColorMap = result.colorMap ?? null;
  }
}

// ── Table ↔ Chart color link ─────────────────────────────────────────

/**
 * Apply light color tints to the contingency table dimension that matches
 * the chart's fill/group variable.
 *
 * @param {'row'|'col'} dimension - Which table dimension to color.
 *   'col' = the chart fill variable is the table's column variable (default).
 *   'row' = the chart fill variable is the table's row variable (flipped).
 */
function applyTableColors(dimension) {
  if (!lastColorMap || !tableContainer) return;
  const { categories, colors } = lastColorMap;

  const table = tableContainer.querySelector('table');
  if (!table) return;

  // Build a map: category text → color
  /** @type {Map<string, string>} */
  const colorByCategory = new Map();
  for (let i = 0; i < categories.length; i++) {
    colorByCategory.set(categories[i], colors[i % colors.length]);
  }

  if (dimension === 'col') {
    // Color table columns (column variable = chart fill variable)
    const headerRow = table.querySelector('thead tr');
    if (!headerRow) return;
    const ths = headerRow.querySelectorAll('th');

    /** @type {Map<number, string>} */
    const colIndexToColor = new Map();
    ths.forEach((th, i) => {
      if (i === 0) return; // row variable label
      const text = th.textContent?.trim() ?? '';
      const color = colorByCategory.get(text);
      if (color) {
        colIndexToColor.set(i, color);
        th.style.borderBottom = `3px solid ${color}`;
      }
    });

    const bodyRows = table.querySelectorAll('tbody tr, tfoot tr');
    bodyRows.forEach(row => {
      const cells = row.querySelectorAll('th, td');
      cells.forEach((cell, i) => {
        const color = colIndexToColor.get(i);
        if (color) {
          /** @type {HTMLElement} */ (cell).style.backgroundColor = color + '18';
        }
      });
    });
  } else {
    // Color table rows (row variable = chart fill variable)
    const bodyRows = table.querySelectorAll('tbody tr');
    bodyRows.forEach(row => {
      const th = row.querySelector('th[scope="row"]');
      if (!th) return;
      const text = th.textContent?.trim() ?? '';
      const color = colorByCategory.get(text);
      if (!color) return;

      // Color the row header with a solid border and tint all cells in this row
      /** @type {HTMLElement} */ (th).style.borderLeft = `3px solid ${color}`;
      row.querySelectorAll('td').forEach(cell => {
        /** @type {HTMLElement} */ (cell).style.backgroundColor = color + '18';
      });
    });
  }
}
