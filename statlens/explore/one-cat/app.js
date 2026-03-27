// @ts-check
/**
 * One Categorical Variable explore tool.
 * Bar chart + frequency table for a single categorical variable.
 */

import { drawBarChart } from '../../js/barchart.js';
import { drawPieChart } from '../../js/pie.js';
import { drawWaffleChart } from '../../js/waffle.js';
import { formatStat } from '../../js/stats.js';
import { announce, initTabs, initDataPanel, initHelp, setPageTitle } from '../../js/page-utils.js';
import { parseCSV } from '../../js/csv-parser.js';
import { initSheet, handleSheetPaste, readSheetValues, populateSheet } from '../../js/spreadsheet.js';
import { wrapTable } from '../../js/export.js';
import { getColors } from '../../js/chart-utils.js';

initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM ──────────────────────────────────────────────────────────────

const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const resultsSection = document.getElementById('results-section');
const tableContainer = document.getElementById('table-container');
const chartContainer = document.getElementById('chart-container');
const chartRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="chart-type"]')
);
const modeRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="chart-mode"]')
);
const modeSep = document.getElementById('mode-sep');
const modeFreqLabel = document.getElementById('mode-freq');
const modeRelLabel = document.getElementById('mode-rel');
let activeChart = 'bar';
// Apply URL params
const _urlParams = new URLSearchParams(window.location.search);
const _chartParam = _urlParams.get('chart');
if (_chartParam && ['bar', 'pie', 'waffle'].includes(_chartParam)) {
  activeChart = /** @type {'bar'|'pie'|'waffle'} */ (_chartParam);
  const _radio = /** @type {HTMLInputElement|null} */ (
    document.querySelector(`input[name="chart-type"][value="${_chartParam}"]`));
  if (_radio) _radio.checked = true;
}
let activeMode = 'frequency';

/** @type {'full'|'names'|'none'} */
let labelsMode = 'full';
const _labelsParam = _urlParams.get('labels');
if (_labelsParam && ['full', 'names', 'none'].includes(_labelsParam)) {
  labelsMode = /** @type {'full'|'names'|'none'} */ (_labelsParam);
}
/** @type {'data'|'freq-desc'|'freq-asc'|'alpha'} */
let activeSort = 'data';
const _sortParam = _urlParams.get('sort');
if (_sortParam && ['data', 'freq-desc', 'freq-asc', 'alpha'].includes(_sortParam)) {
  activeSort = /** @type {'data'|'freq-desc'|'freq-asc'|'alpha'} */ (_sortParam);
  const _sortRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector(`input[name="sort-order"][value="${_sortParam}"]`));
  if (_sortRadio) _sortRadio.checked = true;
}
const sortRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="sort-order"]')
);
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

/** @type {string[]} */
let currentValues = [];
let currentVarName = '';
/** @type {string[]|null} Ordered levels from dataset metadata (null = use first-occurrence). */
let currentLevels = null;

// ── Data loading ─────────────────────────────────────────────────────

/**
 * Load parsed CSV data (shared by paste + file).
 * Uses the first categorical column only.
 * @param {{headers:string[], types:string[], data:Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function loadParsedData(parsed, sourceName) {
  const catIdx = parsed.types.findIndex(t => t === 'categorical');
  if (catIdx < 0) {
    announce('Need at least one categorical column.');
    return;
  }
  const varName = parsed.headers[catIdx];
  const values = parsed.data.map(row => String(row[varName]));
  currentLevels = null;
  loadValues(values, varName, sourceName);
}

/**
 * @param {string[]} values
 * @param {string} varName
 * @param {string} sourceName
 */
function loadValues(values, varName, sourceName) {
  currentValues = values;
  currentVarName = varName;
  // Reset controls to defaults on new data
  activeMode = 'frequency';
  modeRadios.forEach(r => { r.checked = r.value === 'frequency'; });
  if (dataSummary) dataSummary.textContent = `${sourceName} (n = ${values.length})`;
  updateDisplay();
  setPageTitle(baseTitle, sourceName, { variable: varName, n: values.length });
  announce(`${values.length} observations loaded.`);
}

/** Filter: show only datasets with exactly one categorical variable and no numeric. */
function oneCatFilter(/** @type {any} */ ds) {
  if (ds.hasNumeric) return false;
  if (!ds.hasCategorical) return false;
  const vars = ds.variables || [];
  const catCount = vars.filter(/** @param {any} v */ v =>
    typeof v === 'object' ? v.type === 'categorical' : true
  ).length;
  return catCount === 1;
}

initDataPanel({
  autoCollapse: true,
  showPreview: true,
  datasetFilter: oneCatFilter,
  onDataset: (ds) => {
    const catVars = ds.variables.filter(/** @param {any} v */ v =>
      typeof v === 'object' ? v.type === 'categorical' : true
    );
    const catVar = catVars[0];
    const varName = typeof catVar === 'object' ? catVar.name : catVar;
    const values = ds.rows.map(/** @param {any} r */ r => String(r[varName]));
    // Store levels from dataset metadata if available
    currentLevels = (typeof catVar === 'object' && Array.isArray(catVar.levels))
      ? catVar.levels : null;
    // Populate spreadsheet
    if (catSheetBody) populateSheet(catSheetBody, 'text', values);
    loadValues(values, varName, ds.name);
  },
  onText: loadParsedData,
  onClear: () => {
    currentValues = [];
    currentVarName = '';
    currentLevels = null;
    if (dataPreview) dataPreview.hidden = true;
    if (resultsSection) resultsSection.hidden = true;
    if (tableContainer) tableContainer.innerHTML = '';
    if (chartContainer) chartContainer.innerHTML = '';
    if (catSheetBody) initSheet(catSheetBody, 'text');
    buildSummaryTable();
    announce('Data cleared.');
  },
});

/**
 * Handle the Apply button — check summary table, then spreadsheet, then CSV textarea.
 */
function handleApply() {
  // User-entered data has no levels metadata
  currentLevels = null;
  // 1. Summary table
  const summary = readSummaryData();
  if (summary) {
    loadValues(summary.values, summary.varName, 'Summary data');
    return;
  }
  // 2. Spreadsheet
  if (catSheetBody) {
    const sheetValues = readSheetValues(catSheetBody).filter(v => v.length > 0);
    if (sheetValues.length > 0) {
      loadValues(sheetValues, 'Value', 'Edited data');
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

// ── Display controls ─────────────────────────────────────────────────

/** Show/hide mode radios based on chart type (only bar uses frequency/relative). */
function updateModeVisibility() {
  const show = activeChart === 'bar';
  if (modeSep) modeSep.hidden = !show;
  if (modeFreqLabel) modeFreqLabel.hidden = !show;
  if (modeRelLabel) modeRelLabel.hidden = !show;
}

chartRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    activeChart = /** @type {'bar'|'pie'|'waffle'} */ (radio.value);
    updateModeVisibility();
    updateDisplay();
  });
});
modeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    activeMode = /** @type {'frequency'|'relative'} */ (radio.value);
    updateDisplay();
  });
});

// "Show values" toggle — visible when labelsMode starts as non-full (URL param)
const showValuesToggle = document.getElementById('show-values-toggle');
const showValuesCb = /** @type {HTMLInputElement|null} */ (document.getElementById('show-values'));
if (showValuesToggle && showValuesCb) {
  if (labelsMode !== 'full') {
    showValuesToggle.hidden = false;
    showValuesCb.checked = false;
  }
  showValuesCb.addEventListener('change', () => {
    labelsMode = showValuesCb.checked ? 'full' : /** @type {'full'|'names'|'none'} */ (_labelsParam ?? 'names');
    updateDisplay();
  });
}

// ── Sort controls ────────────────────────────────────────────────────

sortRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    activeSort = /** @type {'data'|'freq-desc'|'freq-asc'|'alpha'} */ (radio.value);
    updateDisplay();
  });
});

/**
 * Sort category names according to the active sort mode.
 * @param {string[]} cats - unique categories in first-occurrence order
 * @param {Map<string, number>} counts
 * @returns {string[]} sorted copy
 */
function sortCategories(cats, counts) {
  const sorted = [...cats];
  switch (activeSort) {
    case 'freq-desc':
      sorted.sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0));
      break;
    case 'freq-asc':
      sorted.sort((a, b) => (counts.get(a) ?? 0) - (counts.get(b) ?? 0));
      break;
    case 'alpha':
      sorted.sort((a, b) => a.localeCompare(b));
      break;
    default: // 'data' — use levels if available, otherwise first-occurrence
      if (currentLevels) {
        sorted.sort((a, b) => {
          const ai = currentLevels?.indexOf(a) ?? -1;
          const bi = currentLevels?.indexOf(b) ?? -1;
          // Categories not in levels go to the end
          return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi);
        });
      }
      break;
  }
  return sorted;
}

/**
 * Reorder values array so categories appear in the given order.
 * Chart modules derive category order from first-occurrence, so reordering
 * values is sufficient to control chart category order.
 * @param {string[]} values
 * @param {string[]} catOrder
 * @returns {string[]}
 */
function reorderValues(values, catOrder) {
  /** @type {Map<string, string[]>} */
  const buckets = new Map();
  for (const cat of catOrder) buckets.set(cat, []);
  for (const v of values) {
    const bucket = buckets.get(v);
    if (bucket) bucket.push(v);
  }
  /** @type {string[]} */
  const result = [];
  for (const cat of catOrder) {
    const bucket = buckets.get(cat);
    if (bucket) result.push(...bucket);
  }
  return result;
}

/**
 * Get current values reordered according to the active sort mode.
 * @returns {string[]}
 */
function getSortedValues() {
  if (activeSort === 'data' && !currentLevels) return currentValues;
  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {string[]} */
  const cats = [];
  for (const v of currentValues) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!cats.includes(v)) cats.push(v);
  }
  const sorted = sortCategories(cats, counts);
  return reorderValues(currentValues, sorted);
}

// ── Render ───────────────────────────────────────────────────────────

function updateDisplay() {
  if (currentValues.length === 0) return;
  renderTable();
  renderChart();
  if (resultsSection) resultsSection.hidden = false;
  // Hide frequency table when labels are suppressed (it reveals the numbers)
  const sidebar = document.querySelector('.app-sidebar');
  if (sidebar) /** @type {HTMLElement} */ (sidebar).hidden = labelsMode !== 'full';
}

function renderTable() {
  if (!tableContainer) return;

  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {string[]} */
  const cats = [];
  for (const v of currentValues) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!cats.includes(v)) cats.push(v);
  }
  const sortedCats = sortCategories(cats, counts);
  const total = currentValues.length;

  let html = '<table class="freq-table" aria-label="Frequency table">';
  html += `<thead><tr><th scope="col">${currentVarName}</th>`;
  html += '<th scope="col">Count</th>';
  html += '<th scope="col">Proportion</th>';
  html += '</tr></thead><tbody>';

  for (const cat of sortedCats) {
    const count = counts.get(cat) ?? 0;
    html += `<tr><th scope="row">${cat}</th>`;
    html += `<td>${count}</td>`;
    html += `<td>${formatStat(count / total, 0, 'proportion')}</td>`;
    html += '</tr>';
  }

  html += '</tbody>';
  html += '<tfoot><tr class="total-row">';
  html += `<th scope="row">Total</th><td>${total}</td><td>${formatStat(1, 0, 'proportion')}</td>`;
  html += '</tr></tfoot></table>';

  tableContainer.innerHTML = html;

  // Tint rows to match chart colors (same palette order as drawBarChart)
  const colors = getColors(sortedCats.length);
  const bodyRows = tableContainer.querySelectorAll('tbody tr');
  bodyRows.forEach((row, i) => {
    const color = colors[i % colors.length];
    const th = row.querySelector('th[scope="row"]');
    if (th) /** @type {HTMLElement} */ (th).style.borderLeft = `3px solid ${color}`;
    row.querySelectorAll('td').forEach(cell => {
      /** @type {HTMLElement} */ (cell).style.backgroundColor = color + '18';
    });
  });

  const table = /** @type {HTMLTableElement|null} */ (tableContainer.querySelector('table'));
  if (table) wrapTable(table, { copyTitle: 'Copy frequency table to clipboard' });
}

function renderChart() {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';

  const chartMode = activeMode;
  const sortedValues = getSortedValues();

  if (activeChart === 'pie') {
    drawPieChart(chartContainer, sortedValues, {
      xLabel: currentVarName,
      titleText: currentVarName,
      id: 'cat-chart',
      labels: labelsMode,
    });
  } else if (activeChart === 'waffle') {
    drawWaffleChart(chartContainer, sortedValues, {
      xLabel: currentVarName,
      titleText: currentVarName,
      id: 'cat-chart',
      labels: labelsMode,
    });
  } else {
    drawBarChart(chartContainer, sortedValues, {
      mode: chartMode === 'relative' ? 'relative' : 'frequency',
      xLabel: currentVarName,
      titleText: currentVarName,
      id: 'cat-chart',
      animate: false,
      margin: { top: 30, right: 15, bottom: 80 },
      labels: labelsMode,
    });
  }

}
