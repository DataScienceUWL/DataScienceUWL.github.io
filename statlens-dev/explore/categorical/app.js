// @ts-check
/**
 * Categorical Data explore tool.
 * Contingency table with proportion toggles and bar chart modes.
 */

import { drawBarChart, computeGroupedFrequencies } from '../../js/barchart.js';
import { formatStat } from '../../js/stats.js';
import { announce, initTabs, initDataPanel, initHelp, setPageTitle } from '../../js/page-utils.js';
import { wrapTable } from '../../js/export.js';
import { parseCSV } from '../../js/csv-parser.js';
import { initSheet, handleSheetPaste, readSheetValues, populateSheet } from '../../js/spreadsheet.js';

initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

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
const chartModeGroup = document.getElementById('chart-mode');
const proportionNote = document.getElementById('proportion-note');

/** Get the currently selected chart mode from the segmented control. */
function getChartMode() {
  const pressed = /** @type {HTMLButtonElement|null} */ (chartModeGroup?.querySelector('button[aria-pressed="true"]'));
  return pressed?.dataset.value ?? 'stacked';
}

/** Set the chart mode on the segmented control.
 * @param {string} value */
function setChartMode(value) {
  if (!chartModeGroup) return;
  for (const btn of chartModeGroup.querySelectorAll('button')) {
    btn.setAttribute('aria-pressed', String(/** @type {HTMLButtonElement} */ (btn).dataset.value === value));
  }
}
const catSheetBody = /** @type {HTMLElement} */ (document.getElementById('cat-sheet-body'));
const numCategoriesInput = /** @type {HTMLInputElement} */ (document.getElementById('num-categories'));
const summaryTableBody = /** @type {HTMLElement} */ (document.getElementById('summary-table-body'));

initTabs();

// ── Spreadsheet + summary table init ────────────────────────────────

if (catSheetBody) {
  initSheet(catSheetBody, 'text');
  catSheetBody.closest('.spreadsheet')?.addEventListener('paste', (e) => {
    handleSheetPaste(catSheetBody, 'text', /** @type {ClipboardEvent} */ (e));
  });
}

/** Build the summary table rows (category name + count pairs). */
function buildSummaryTable() {
  if (!summaryTableBody) return;
  const n = parseInt(numCategoriesInput?.value ?? '3', 10) || 3;
  summaryTableBody.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const tr = document.createElement('tr');
    const tdName = document.createElement('td');
    const inputName = document.createElement('input');
    inputName.type = 'text';
    inputName.placeholder = `Category ${i + 1}`;
    inputName.setAttribute('aria-label', `Category ${i + 1} name`);
    tdName.appendChild(inputName);
    tr.appendChild(tdName);

    const tdCount = document.createElement('td');
    const inputCount = document.createElement('input');
    inputCount.type = 'number';
    inputCount.min = '0';
    inputCount.placeholder = '0';
    inputCount.setAttribute('aria-label', `Category ${i + 1} count`);
    tdCount.appendChild(inputCount);
    tr.appendChild(tdCount);

    summaryTableBody.appendChild(tr);
  }
}

buildSummaryTable();
numCategoriesInput?.addEventListener('change', buildSummaryTable);

/**
 * Read data from the summary table (category name + count → expanded values).
 * @returns {{ values: string[], varName: string } | null}
 */
function readSummaryData() {
  if (!summaryTableBody) return null;
  const rows = summaryTableBody.querySelectorAll('tr');
  /** @type {string[]} */
  const values = [];
  let hasData = false;
  for (const row of rows) {
    const inputs = row.querySelectorAll('input');
    const name = inputs[0]?.value.trim();
    const count = parseInt(inputs[1]?.value ?? '0', 10);
    if (name && count > 0) {
      hasData = true;
      for (let i = 0; i < count; i++) values.push(name);
    }
  }
  return hasData ? { values, varName: 'Category' } : null;
}

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

/** Filter: show only datasets with 2+ categorical variables and no numeric. @param {any} ds */
function twoCatFilter(ds) {
  if (ds.hasNumeric) return false;
  if (!ds.hasCategorical) return false;
  const vars = ds.variables || [];
  const catCount = vars.filter(/** @param {any} v */ v =>
    typeof v === 'object' ? v.type === 'categorical' : true
  ).length;
  return catCount >= 2;
}

initDataPanel({
  autoCollapse: true,
  showPreview: true,
  datasetFilter: twoCatFilter,
  onDataset: (ds) => {
    const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
    if (catVars.length === 0) {
      announce('This dataset has no categorical variables.');
      return;
    }
    catVarNames = catVars.map(/** @param {any} v */ v => v.name);
    rawRows = ds.rows;
    setupVariableSelectors(catVarNames);
    // Populate spreadsheet with the first categorical variable's values
    if (catSheetBody && catVarNames.length > 0) {
      const vals = rawRows.map(r => String(r[catVarNames[0]] ?? ''));
      populateSheet(catSheetBody, 'text', vals);
    }
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
    if (catSheetBody) initSheet(catSheetBody, 'text');
    buildSummaryTable();
    announce('Data cleared.');
  },
});

/**
 * Load a flat array of categorical values (from spreadsheet or summary table).
 * @param {string[]} values
 * @param {string} varName
 * @param {string} sourceName
 */
function loadRawValues(values, varName, sourceName) {
  catVarNames = [varName];
  rawRows = values.map(v => ({ [varName]: v }));
  setupVariableSelectors(catVarNames);
  showDataLoaded(sourceName);
}

/**
 * Handle the Apply button — check summary table, then spreadsheet, then CSV textarea.
 */
function handleApply() {
  // 1. Summary table
  const summary = readSummaryData();
  if (summary) {
    loadRawValues(summary.values, summary.varName, 'Summary data');
    return;
  }
  // 2. Spreadsheet
  if (catSheetBody) {
    const sheetValues = readSheetValues(catSheetBody).filter(v => v.length > 0);
    if (sheetValues.length > 0) {
      loadRawValues(sheetValues, 'Value', 'Edited data');
      return;
    }
  }
  // 3. CSV textarea fallback
  const pasteArea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('paste-area'));
  const text = pasteArea?.value?.trim();
  if (text) {
    try {
      const parsed = parseCSV(text);
      loadParsedData(parsed, 'Edited data');
    } catch (e) {
      announce(`Error parsing data: ${e instanceof Error ? e.message : String(e)}`);
    }
    return;
  }
  announce('Enter categorical values or summary counts.');
}

// Override the default Apply button to use our custom handler
const loadPastedBtn = document.getElementById('load-pasted');
if (loadPastedBtn) {
  const newBtn = /** @type {HTMLElement} */ (loadPastedBtn.cloneNode(true));
  loadPastedBtn.parentNode?.replaceChild(newBtn, loadPastedBtn);
  newBtn.addEventListener('click', handleApply);
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
if (chartModeGroup) {
  for (const btn of chartModeGroup.querySelectorAll('button')) {
    btn.addEventListener('click', () => {
      setChartMode(/** @type {HTMLButtonElement} */ (btn).dataset.value ?? 'stacked');
      updateDisplay();
    });
  }
}

// ── Show data ────────────────────────────────────────────────────────

/**
 * @param {string} sourceName
 */
function showDataLoaded(sourceName) {
  // Reset controls to defaults on new data
  if (tableModeSelect) tableModeSelect.value = 'counts';
  setChartMode('stacked');
  if (dataSummary) dataSummary.textContent = `${sourceName} (n = ${rawRows.length})`;
  updateDisplay();
  setPageTitle(baseTitle, sourceName, { n: rawRows.length });
  announce(`${rawRows.length} observations.`);
}

function updateDisplay() {
  if (rawRows.length === 0) return;

  if (rowVar === colVar) {
    announce('Select two different variables.');
    return;
  }

  {
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

// ── Contingency table ─────────────────────────────────────────────────

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

  const tableEl = /** @type {HTMLTableElement|null} */ (tableContainer.querySelector('table'));
  if (tableEl) wrapTable(tableEl, { copyTitle: 'Copy contingency table to clipboard' });

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

  const chartMode = getChartMode();

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
