// @ts-check
/**
 * Descriptive Statistics explore tool — standalone page logic.
 * Quantitative/Categorical toggle controls dataset filtering, data entry,
 * chart types, and statistics display.
 */

import { parseCSV } from '../../js/csv-parser.js';
import { mean, median, sd, quantile, iqr, range, detectPrecision, formatStat } from '../../js/stats.js';
import { drawHistogram, sturgesBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { drawBarChart } from '../../js/barchart.js';
import { announce, initTabs, initDataPanel } from '../../js/page-utils.js';

// ── DOM elements ──────────────────────────────────────────────────────

const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const variableSelector = document.getElementById('variable-selector');
const varSelect = /** @type {HTMLSelectElement} */ (document.getElementById('var-select'));
const resultsSection = document.getElementById('results-section');
const chartArea = document.getElementById('chart-area');
const chartControls = document.getElementById('chart-controls');

const numericStats = document.getElementById('numeric-stats');
const categoricalStats = document.getElementById('categorical-stats');
const freqTableContainer = document.getElementById('freq-table-container');

// Mode toggle
const modeQuantBtn = /** @type {HTMLButtonElement} */ (document.getElementById('mode-quantitative'));
const modeCatBtn = /** @type {HTMLButtonElement} */ (document.getElementById('mode-categorical'));

// Paste panels
const pasteQuant = document.getElementById('paste-quantitative');
const pasteCat = document.getElementById('paste-categorical');
const summaryEntry = document.getElementById('summary-entry');
const addSummaryRowBtn = document.getElementById('add-summary-row');

// Stat output cells
const statN = document.getElementById('stat-n');
const statMean = document.getElementById('stat-mean');
const statMedian = document.getElementById('stat-median');
const statSd = document.getElementById('stat-sd');
const statMin = document.getElementById('stat-min');
const statQ1 = document.getElementById('stat-q1');
const statQ3 = document.getElementById('stat-q3');
const statMax = document.getElementById('stat-max');
const statIqr = document.getElementById('stat-iqr');
const statRange = document.getElementById('stat-range');

initTabs();

// ── Variable type mode ──────────────────────────────────────────────

/** @type {'quantitative'|'categorical'} */
let varMode = 'quantitative';

// ── Chart type toggle ─────────────────────────────────────────────────

/** @type {'histogram'|'dotplot'|'boxplot'} */
let activeChart = 'histogram';

/** Current variable label (for chart titles). */
let currentVarLabel = 'Value';

const chartRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="chart-type"]')
);

chartRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    activeChart = /** @type {'histogram'|'dotplot'|'boxplot'} */ (radio.value);
    renderActiveChart();
    updateChartControls();
  });
});

/** Show/hide contextual controls based on active chart. */
function updateChartControls() {
  if (!chartControls) return;
  chartControls.innerHTML = '';

  if (activeChart === 'histogram') {
    const label = document.createElement('label');
    label.innerHTML = 'Bins: <input type="number" id="bin-count" min="3" max="50" step="1">';
    label.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
    chartControls.appendChild(label);
    const input = /** @type {HTMLInputElement} */ (label.querySelector('input'));
    input.style.cssText = 'width:3.5rem;padding:0.15rem 0.3rem;font-size:0.85rem;';
    if (currentValues.length > 0) {
      input.value = String(currentBinCount);
    }
    input.addEventListener('input', () => {
      const n = parseInt(input.value, 10);
      if (!isFinite(n) || n < 3) return;
      currentBinCount = n;
      renderActiveChart();
    });
  } else if (activeChart === 'boxplot') {
    const label = document.createElement('label');
    label.innerHTML = '<input type="checkbox" id="show-outliers" checked> Show outliers';
    label.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
    chartControls.appendChild(label);
    const cb = /** @type {HTMLInputElement} */ (label.querySelector('input'));
    cb.checked = showOutliers;
    cb.addEventListener('change', () => {
      showOutliers = cb.checked;
      renderActiveChart();
    });
  }
  // dotplot: no contextual controls
}

// ── State ─────────────────────────────────────────────────────────────

/** @type {number[]} */
let currentValues = [];

/** @type {string[]} */
let currentCatValues = [];

/** Decimal places in source data (for formatStat). */
let dataPrecision = 0;

/** Current bin count for histogram. */
let currentBinCount = 7;

/** Whether to show outliers in boxplot. */
let showOutliers = true;

/**
 * Current loaded dataset (raw JSON), null if pasted.
 * @type {null | {variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>>}}
 */
let loadedDataset = null;

// ── Mode toggle logic ────────────────────────────────────────────────

function setMode(/** @type {'quantitative'|'categorical'} */ mode) {
  varMode = mode;
  modeQuantBtn.setAttribute('aria-pressed', String(mode === 'quantitative'));
  modeCatBtn.setAttribute('aria-pressed', String(mode === 'categorical'));

  // Toggle paste UI
  if (pasteQuant) pasteQuant.hidden = mode !== 'quantitative';
  if (pasteCat) pasteCat.hidden = mode !== 'categorical';

  // Re-filter datasets
  if (mode === 'quantitative') {
    dataPanel.refilterDatasets((/** @type {any} */ ds) => ds.hasNumeric !== false);
  } else {
    dataPanel.refilterDatasets((/** @type {any} */ ds) => ds.hasCategorical === true);
  }

  // Clear current display when switching modes
  clearDisplay();
  announce(`Switched to ${mode} variable mode.`);
}

modeQuantBtn.addEventListener('click', () => setMode('quantitative'));
modeCatBtn.addEventListener('click', () => setMode('categorical'));

// ── Summary data entry ───────────────────────────────────────────────

function addSummaryRow() {
  if (!summaryEntry) return;
  const row = document.createElement('div');
  row.className = 'summary-row';
  row.innerHTML = `
    <input type="text" placeholder="Category" aria-label="Category name">
    <input type="number" placeholder="Count" min="0" aria-label="Count">
    <button type="button" class="remove-row" aria-label="Remove row">&times;</button>`;
  summaryEntry.appendChild(row);
  row.querySelector('.remove-row')?.addEventListener('click', () => {
    row.remove();
  });
}

if (addSummaryRowBtn) {
  addSummaryRowBtn.addEventListener('click', addSummaryRow);
}

// Wire up initial remove buttons
if (summaryEntry) {
  summaryEntry.querySelectorAll('.remove-row').forEach(btn => {
    btn.addEventListener('click', () => {
      /** @type {HTMLElement} */ (btn).closest('.summary-row')?.remove();
    });
  });
}

/** Read summary entry rows and return expanded category values. */
function readSummaryData() {
  if (!summaryEntry) return [];
  /** @type {string[]} */
  const values = [];
  const rows = summaryEntry.querySelectorAll('.summary-row');
  for (const row of rows) {
    const inputs = row.querySelectorAll('input');
    const cat = /** @type {HTMLInputElement} */ (inputs[0]).value.trim();
    const count = parseInt(/** @type {HTMLInputElement} */ (inputs[1]).value, 10);
    if (cat && count > 0) {
      for (let i = 0; i < count; i++) values.push(cat);
    }
  }
  return values;
}

// ── Spreadsheet editors ──────────────────────────────────────────────

const quantSheetBody = document.getElementById('quant-sheet-body');
const catSheetBody = document.getElementById('cat-sheet-body');
const EMPTY_ROWS = 8;

/**
 * Create a spreadsheet editor in a tbody element.
 * @param {HTMLElement} tbody
 * @param {'number'|'text'} inputType
 * @param {string[]} [initialValues]
 */
function initSheet(tbody, inputType, initialValues) {
  tbody.innerHTML = '';
  const vals = initialValues ?? [];
  const rowCount = Math.max(vals.length + 3, EMPTY_ROWS);
  for (let i = 0; i < rowCount; i++) {
    appendSheetRow(tbody, inputType, i + 1, vals[i] ?? '');
  }
}

/**
 * Append a single row to a spreadsheet tbody.
 * @param {HTMLElement} tbody
 * @param {'number'|'text'} inputType
 * @param {number} rowNum
 * @param {string} value
 * @returns {HTMLInputElement}
 */
function appendSheetRow(tbody, inputType, rowNum, value) {
  const tr = document.createElement('tr');
  if (!value) tr.className = 'empty-row';

  const tdNum = document.createElement('td');
  tdNum.className = 'row-num';
  tdNum.textContent = String(rowNum);
  tr.appendChild(tdNum);

  const tdVal = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'text'; // always text for paste flexibility
  input.inputMode = inputType === 'number' ? 'decimal' : 'text';
  input.value = value;
  input.setAttribute('aria-label', `Row ${rowNum}`);

  // Navigation: Enter/ArrowDown → next row, ArrowUp → prev row
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextRow = tr.nextElementSibling;
      if (nextRow) {
        /** @type {HTMLInputElement|null} */ (nextRow.querySelector('input'))?.focus();
      } else {
        // Add a new row and focus it
        const newInput = appendSheetRow(tbody, inputType, rowNum + 1, '');
        newInput.focus();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevRow = tr.previousElementSibling;
      if (prevRow) {
        /** @type {HTMLInputElement|null} */ (prevRow.querySelector('input'))?.focus();
      }
    }
  });

  // Track empty/non-empty for styling
  input.addEventListener('input', () => {
    tr.className = input.value.trim() ? '' : 'empty-row';
    // Auto-extend: if this is the last row and has content, add more
    if (!tr.nextElementSibling && input.value.trim()) {
      for (let i = 0; i < 3; i++) {
        appendSheetRow(tbody, inputType, getRowCount(tbody) + 1, '');
      }
    }
  });

  tdVal.appendChild(input);
  tr.appendChild(tdVal);
  tbody.appendChild(tr);
  return input;
}

/**
 * Handle paste into the spreadsheet — split lines across rows.
 * @param {HTMLElement} tbody
 * @param {'number'|'text'} inputType
 * @param {ClipboardEvent} e
 */
function handleSheetPaste(tbody, inputType, e) {
  const text = e.clipboardData?.getData('text');
  if (!text) return;

  // Split by lines (or tabs for row of tab-separated values)
  const lines = text.split(/[\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (lines.length <= 1) return; // let default paste handle single values

  e.preventDefault();

  const target = /** @type {HTMLInputElement} */ (e.target);
  const targetRow = target.closest('tr');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  let startIdx = targetRow ? rows.indexOf(targetRow) : rows.length;
  if (startIdx < 0) startIdx = rows.length;

  for (let i = 0; i < lines.length; i++) {
    const rowIdx = startIdx + i;
    if (rowIdx < rows.length) {
      const input = /** @type {HTMLInputElement|null} */ (rows[rowIdx].querySelector('input'));
      if (input) {
        input.value = lines[i];
        rows[rowIdx].className = lines[i] ? '' : 'empty-row';
      }
    } else {
      appendSheetRow(tbody, inputType, rowIdx + 1, lines[i]);
    }
  }

  // Add trailing empty rows
  const totalRows = getRowCount(tbody);
  for (let i = 0; i < 3; i++) {
    appendSheetRow(tbody, inputType, totalRows + i + 1, '');
  }
}

/** @param {HTMLElement} tbody */
function getRowCount(tbody) {
  return tbody.querySelectorAll('tr').length;
}

/**
 * Read all non-empty values from a spreadsheet.
 * @param {HTMLElement} tbody
 * @returns {string[]}
 */
function readSheetValues(tbody) {
  /** @type {string[]} */
  const values = [];
  for (const input of tbody.querySelectorAll('input')) {
    const v = /** @type {HTMLInputElement} */ (input).value.trim();
    if (v) values.push(v);
  }
  return values;
}

/**
 * Populate a spreadsheet with values (e.g., from a loaded dataset).
 * @param {HTMLElement} tbody
 * @param {'number'|'text'} inputType
 * @param {string[]} values
 */
function populateSheet(tbody, inputType, values) {
  initSheet(tbody, inputType, values);
}

// Initialize both spreadsheets with empty rows
if (quantSheetBody) {
  initSheet(quantSheetBody, 'number');
  quantSheetBody.addEventListener('paste', (e) =>
    handleSheetPaste(quantSheetBody, 'number', /** @type {ClipboardEvent} */ (e)));
}
if (catSheetBody) {
  initSheet(catSheetBody, 'text');
  catSheetBody.addEventListener('paste', (e) =>
    handleSheetPaste(catSheetBody, 'text', /** @type {ClipboardEvent} */ (e)));
}

// ── Data loading ──────────────────────────────────────────────────────

/**
 * Load parsed CSV/text data, setting up variable selector for multi-column.
 * @param {string} raw - Raw text input
 * @param {string} sourceName
 */
function loadRawText(raw, sourceName) {
  if (varMode === 'categorical') {
    loadRawCategorical(raw, sourceName);
    return;
  }

  loadedDataset = null;
  if (variableSelector) variableSelector.hidden = true;

  // Try CSV parse first (has headers)
  try {
    const parsed = parseCSV(raw);
    const numIdx = parsed.types.indexOf('numeric');
    if (numIdx >= 0) {
      const numericCols = parsed.headers.filter((_h, i) => parsed.types[i] === 'numeric');
      const colName = numericCols[0];
      const values = parsed.data
        .map(row => parseFloat(row[colName]))
        .filter(v => isFinite(v));

      if (numericCols.length > 1) {
        varSelect.innerHTML = '';
        for (const col of numericCols) {
          const opt = document.createElement('option');
          opt.value = col;
          opt.textContent = col;
          varSelect.appendChild(opt);
        }
        if (variableSelector) variableSelector.hidden = false;
        loadedDataset = {
          variables: numericCols.map(c => ({ name: c, label: c, type: 'numeric' })),
          rows: parsed.data.map(row => {
            /** @type {Record<string,number>} */
            const obj = {};
            for (const col of numericCols) {
              obj[col] = parseFloat(row[col]);
            }
            return obj;
          }),
        };
      }

      setData(values, colName, sourceName);
      return;
    }
  } catch {
    // Not valid CSV, try as plain numbers
  }

  // Plain numbers, one per line
  const values = raw.split(/[\n,]+/)
    .map(s => s.trim())
    .filter(s => s.length > 0)
    .map(Number)
    .filter(v => isFinite(v));

  if (values.length === 0) {
    announce('No numeric values found in data.');
    return;
  }

  setData(values, 'Value', sourceName);
}

/**
 * Load raw categorical text — one value per line or CSV with categorical columns.
 * @param {string} raw
 * @param {string} sourceName
 */
function loadRawCategorical(raw, sourceName) {
  loadedDataset = null;
  if (variableSelector) variableSelector.hidden = true;

  // Try CSV parse first
  try {
    const parsed = parseCSV(raw);
    const catCols = parsed.headers.filter((_h, i) => parsed.types[i] === 'categorical');
    if (catCols.length > 0) {
      const colName = catCols[0];
      const values = parsed.data.map(row => String(row[colName]));

      if (catCols.length > 1) {
        varSelect.innerHTML = '';
        for (const col of catCols) {
          const opt = document.createElement('option');
          opt.value = col;
          opt.textContent = col;
          varSelect.appendChild(opt);
        }
        if (variableSelector) variableSelector.hidden = false;
        loadedDataset = {
          variables: catCols.map(c => ({ name: c, label: c, type: 'categorical' })),
          rows: parsed.data.map(row => {
            /** @type {Record<string,string>} */
            const obj = {};
            for (const col of catCols) obj[col] = String(row[col]);
            return obj;
          }),
        };
      }

      setCatData(values, colName, sourceName);
      return;
    }
  } catch {
    // Not CSV
  }

  // Plain text: one category per line
  const values = raw.split(/\n/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  if (values.length === 0) {
    announce('No categorical values found in data.');
    return;
  }

  setCatData(values, 'Category', sourceName);
}

/**
 * Handle the Apply button — reads from spreadsheet or summary entry.
 */
function handleApply() {
  if (varMode === 'categorical') {
    // Check summary entry first
    const summaryValues = readSummaryData();
    if (summaryValues.length > 0) {
      setCatData(summaryValues, 'Category', 'Summary data');
      return;
    }
    // Fall back to spreadsheet
    if (catSheetBody) {
      const values = readSheetValues(catSheetBody);
      if (values.length > 0) {
        setCatData(values, 'Category', 'Edited data');
        return;
      }
    }
    announce('Enter category values or summary counts.');
    return;
  }

  // Quantitative mode — read from spreadsheet
  if (quantSheetBody) {
    const raw = readSheetValues(quantSheetBody);
    const values = raw.map(Number).filter(v => isFinite(v));
    if (values.length > 0) {
      setData(values, 'Value', 'Edited data');
      return;
    }
  }
  announce('Enter numeric values.');
}

const dataPanel = initDataPanel({
  datasetFilter: (/** @type {any} */ ds) => ds.hasNumeric !== false,
  onDataset: (ds) => {
    loadedDataset = ds;
    const typeFilter = varMode === 'quantitative' ? 'numeric' : 'categorical';
    const matchingVars = ds.variables.filter(
      /** @param {{type:string}} v */ v => v.type === typeFilter
    );

    // Also include all variables of the matching type, but show the right ones
    const allVars = ds.variables.filter(
      /** @param {{type:string}} v */ v => v.type === 'numeric' || v.type === 'categorical'
    );

    if (matchingVars.length === 0) {
      announce(`No ${varMode} variables in this dataset.`);
      return;
    }

    if (allVars.length > 1) {
      varSelect.innerHTML = '';
      // Show matching-type variables first, then others
      for (const v of matchingVars) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.label || v.name;
        varSelect.appendChild(opt);
      }
      const otherVars = allVars.filter(/** @param {{type:string}} v */ v => v.type !== typeFilter);
      if (otherVars.length > 0) {
        const optGroup = document.createElement('optgroup');
        optGroup.label = typeFilter === 'numeric' ? 'Categorical' : 'Quantitative';
        for (const v of otherVars) {
          const opt = document.createElement('option');
          opt.value = v.name;
          opt.textContent = v.label || v.name;
          optGroup.appendChild(opt);
        }
        varSelect.appendChild(optGroup);
      }
      if (variableSelector) variableSelector.hidden = false;
    } else {
      if (variableSelector) variableSelector.hidden = true;
    }

    loadVariable(matchingVars[0], ds);
  },
  onRawText: loadRawText,
  onClear: clearDisplay,
});

// Override the default Apply button behavior to handle categorical mode
const loadPastedBtn = document.getElementById('load-pasted');
if (loadPastedBtn) {
  // Remove existing listener by cloning
  const newBtn = loadPastedBtn.cloneNode(true);
  loadPastedBtn.parentNode?.replaceChild(newBtn, loadPastedBtn);
  newBtn.addEventListener('click', handleApply);
}

// Variable selector change
varSelect.addEventListener('change', () => {
  if (!loadedDataset) return;
  const varName = varSelect.value;
  const varInfo = loadedDataset.variables.find(/** @param {any} v */ v => v.name === varName);
  if (varInfo) loadVariable(varInfo, loadedDataset);
});

/**
 * Load a variable from a dataset, detecting its type.
 * @param {{name:string, label:string, type:string}} varInfo
 * @param {{name?:string, rows:Array<Record<string,any>>}} ds
 */
function loadVariable(varInfo, ds) {
  const varLabel = varInfo.label || varInfo.name;
  const sourceName = ds.name ?? 'Dataset';

  if (varInfo.type === 'categorical') {
    const values = ds.rows.map(r => String(r[varInfo.name]));
    setCatData(values, varLabel, sourceName);
  } else {
    const values = ds.rows.map(r => r[varInfo.name]).filter(v => isFinite(v));
    setData(values, varLabel, sourceName);
  }
}

// ── URL data (silent load, no visible tab) ───────────────────────────

(function checkUrlData() {
  const params = new URLSearchParams(window.location.search);
  const dataParam = params.get('data');
  if (!dataParam) return;

  const values = dataParam.split(',')
    .map(s => s.trim())
    .map(Number)
    .filter(v => isFinite(v));

  if (values.length > 0) {
    loadedDataset = null;
    if (variableSelector) variableSelector.hidden = true;
    setData(values, params.get('label') || 'Value', 'URL data');
  }
})();

// ── Core: set data, compute stats, render ─────────────────────────────

/**
 * Set numeric data, compute stats, and render the active chart.
 * @param {number[]} values
 * @param {string} varLabel
 * @param {string} sourceName
 */
function setData(values, varLabel, sourceName) {
  currentValues = values;
  currentCatValues = [];
  currentVarLabel = varLabel;
  dataPrecision = detectPrecision(values);
  currentBinCount = sturgesBins(values.length);

  // Populate spreadsheet editor
  if (quantSheetBody) populateSheet(quantSheetBody, 'number', values.map(String));

  // Show numeric UI, hide categorical
  if (numericStats) numericStats.hidden = false;
  if (categoricalStats) categoricalStats.hidden = true;
  const chartSel = document.querySelector('.chart-selector');
  if (chartSel) /** @type {HTMLElement} */ (chartSel).hidden = false;

  // Show data preview
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) dataSummary.textContent = `${sourceName} — ${varLabel} (n = ${values.length})`;

  if (resultsSection) resultsSection.hidden = false;
  computeAndDisplay(values);
  updateChartControls();
  renderActiveChart();
  announce(`${values.length} values. Statistics and chart updated.`);
}

/**
 * Set categorical data and render bar chart + frequency table.
 * @param {string[]} values
 * @param {string} varLabel
 * @param {string} sourceName
 */
function setCatData(values, varLabel, sourceName) {
  currentCatValues = values;
  currentValues = [];
  currentVarLabel = varLabel;

  // Populate spreadsheet editor
  if (catSheetBody) populateSheet(catSheetBody, 'text', values);

  // Show categorical UI, hide numeric
  if (numericStats) numericStats.hidden = true;
  if (categoricalStats) categoricalStats.hidden = false;
  const chartSel = document.querySelector('.chart-selector');
  if (chartSel) /** @type {HTMLElement} */ (chartSel).hidden = true;

  // Show data preview
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) dataSummary.textContent = `${sourceName} — ${varLabel} (n = ${values.length})`;

  if (resultsSection) resultsSection.hidden = false;
  if (chartControls) chartControls.innerHTML = '';
  renderCatChart();
  renderFreqTable();
  announce(`${values.length} values. Frequency table and bar chart updated.`);
}

/**
 * Compute and display summary statistics.
 * @param {number[]} values
 */
function computeAndDisplay(values) {
  const d = dataPrecision;
  const [lo, hi] = range(values);

  if (statN) statN.textContent = String(values.length);
  if (statMean) statMean.textContent = formatStat(mean(values), d);
  if (statMedian) statMedian.textContent = formatStat(median(values), d);
  if (statSd) statSd.textContent = formatStat(sd(values), d);
  if (statMin) statMin.textContent = formatStat(lo, d);
  if (statQ1) statQ1.textContent = formatStat(quantile(values, 0.25), d);
  if (statQ3) statQ3.textContent = formatStat(quantile(values, 0.75), d);
  if (statMax) statMax.textContent = formatStat(hi, d);
  if (statIqr) statIqr.textContent = formatStat(iqr(values), d);
  if (statRange) statRange.textContent = formatStat(hi - lo, d);
}

/**
 * Render the currently selected chart type.
 */
function renderActiveChart() {
  if (!chartArea || currentValues.length === 0) return;
  chartArea.innerHTML = '';
  const xLabel = currentVarLabel;

  if (activeChart === 'histogram') {
    drawHistogram(chartArea, currentValues, {
      xLabel,
      yLabel: 'Frequency',
      titleText: `Histogram of ${xLabel}`,
      descText: `Histogram showing the distribution of ${xLabel}`,
      id: 'desc-hist',
      animate: false,
      numBins: currentBinCount,
    });
  } else if (activeChart === 'dotplot') {
    if (currentValues.length <= 200) {
      drawDotplot(chartArea, currentValues, {
        xLabel,
        titleText: `Dotplot of ${xLabel}`,
        descText: `Dot plot showing individual values of ${xLabel}`,
        id: 'desc-dot',
        animate: false,
      });
    } else {
      chartArea.innerHTML =
        '<p class="hint">Dotplot not available for datasets with more than 200 values.</p>';
    }
  } else if (activeChart === 'boxplot') {
    drawBoxplot(chartArea, currentValues, {
      xLabel,
      titleText: `Boxplot of ${xLabel}`,
      descText: `Boxplot showing five-number summary of ${xLabel}`,
      id: 'desc-box',
      animate: false,
      showOutliers,
    });
  }
}

// ── Categorical rendering ─────────────────────────────────────────────

/** Render a bar chart for categorical data. */
function renderCatChart() {
  if (!chartArea || currentCatValues.length === 0) return;
  chartArea.innerHTML = '';
  drawBarChart(chartArea, currentCatValues, {
    mode: 'frequency',
    xLabel: currentVarLabel,
    titleText: `Bar chart of ${currentVarLabel}`,
    descText: `Bar chart showing frequency of each category of ${currentVarLabel}`,
    id: 'desc-bar',
    animate: false,
  });
}

/** Render a frequency table in the sidebar. */
function renderFreqTable() {
  if (!freqTableContainer) return;

  /** @type {Map<string, number>} */
  const counts = new Map();
  /** @type {string[]} */
  const cats = [];
  for (const v of currentCatValues) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!cats.includes(v)) cats.push(v);
  }
  const total = currentCatValues.length;

  let html = '<table class="sidebar-stats" aria-label="Frequency table"><tbody>';
  html += '<tr><th scope="row">n</th><td>' + total + '</td></tr>';
  html += '<tr class="stat-sep"><th colspan="2" style="text-align:center;font-weight:700;font-size:0.8rem;color:var(--ims-gray-text);">Counts</th></tr>';
  for (const cat of cats) {
    const count = counts.get(cat) ?? 0;
    html += `<tr><th scope="row">${cat}</th><td>${count}</td></tr>`;
  }
  html += '<tr class="stat-sep"><th colspan="2" style="text-align:center;font-weight:700;font-size:0.8rem;color:var(--ims-gray-text);">Proportions</th></tr>';
  for (const cat of cats) {
    const count = counts.get(cat) ?? 0;
    html += `<tr><th scope="row">${cat}</th><td>${formatStat(count / total, 0, 'proportion')}</td></tr>`;
  }
  html += '</tbody></table>';
  freqTableContainer.innerHTML = html;
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Clear all displayed stats and charts. */
function clearDisplay() {
  currentValues = [];
  currentCatValues = [];

  loadedDataset = null;
  if (variableSelector) variableSelector.hidden = true;
  if (dataPreview) dataPreview.hidden = true;
  if (resultsSection) resultsSection.hidden = true;
  if (chartArea) chartArea.innerHTML = '';
}
