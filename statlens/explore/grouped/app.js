// @ts-check
/**
 * Compare Groups explore tool — standalone page logic.
 * Shows side-by-side boxplots, dotplots, or histograms comparing
 * a quantitative variable across levels of a categorical grouping variable.
 */

import { parseCSV } from '../../js/csv-parser.js';
import { detectPrecision } from '../../js/stats.js';
import { sturgesBins } from '../../js/histogram.js';
import { computeDots } from '../../js/dotplot.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { drawGroupedDensity } from '../../js/kde.js';
import { wrapTable } from '../../js/export.js';
import { announce, initTabs, initDataPanel, initHelp, wrapWithStepper, setPageTitle } from '../../js/page-utils.js';
import { getColors } from '../../js/chart-utils.js';
import { DOTPLOT_AUTO_THRESHOLD } from '../../js/chart-defaults.js';
import { renderStackedHistograms, renderStackedDotplots } from '../../js/grouped-charts.js';
import { drawMeanOnGroupedDensity } from '../../js/mean-marker.js';
import { buildGroupedStatsTable, renderBinTable } from '../../js/stats-tables.js';

initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM elements ──────────────────────────────────────────────────────

const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const variableSelector = document.getElementById('variable-selector');
const quantVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('quant-var-select'));
const groupVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('group-var-select'));
const resultsSection = document.getElementById('results-section');
const chartArea = document.getElementById('chart-area');
const chartControls = document.getElementById('chart-controls');

// Stats table is built dynamically by buildGroupedStatsTable into .grouped-stats-wrap

initTabs();

// ── Chart type toggle ─────────────────────────────────────────────────

/** @type {'boxplot'|'dotplot'|'histogram'|'density'} */
let activeChart = 'boxplot';

/** Current quantitative variable label. */
let currentVarLabel = 'Value';

/** Current grouping variable label. */
let currentGroupLabel = 'Group';

const chartRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="chart-type"]')
);

chartRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    activeChart = /** @type {'boxplot'|'dotplot'|'histogram'|'density'} */ (radio.value);
    renderActiveChart();
    updateChartControls();
  });
});

/** Whether dotplot is currently disabled due to overflow. */
let dotplotDisabled = false;

/**
 * Enable or disable the dotplot radio based on whether any group would overflow.
 * Call after data loads or group selection changes.
 */
function updateDotplotAvailability() {
  const groupNames = Object.keys(groupedData);
  const totalN = allValues.length;

  // Check total N threshold
  let tooMany = totalN > DOTPLOT_AUTO_THRESHOLD;

  // Check per-group stack overflow
  if (!tooMany && groupNames.length > 0) {
    const xMin = Math.min(...allValues);
    const xMax = Math.max(...allValues);
    const pad = (xMax - xMin) * 0.05 || 0.5;
    /** @type {[number, number]} */
    const domain = [xMin - pad, xMax + pad];
    const INNER_HEIGHT = 296;
    const MIN_R = 2;
    for (const name of groupNames) {
      const result = computeDots(groupedData[name], { domain });
      if (result.maxStack > 0 && result.maxStack * MIN_R * 2 > INNER_HEIGHT) {
        tooMany = true;
        break;
      }
    }
  }

  dotplotDisabled = tooMany;
  const dotRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="chart-type"][value="dotplot"]'));
  if (dotRadio) {
    dotRadio.disabled = tooMany;
    const label = dotRadio.closest('label');
    if (label) {
      label.title = tooMany ? 'Too many values for dotplot — try Histogram' : '';
      label.style.opacity = tooMany ? '0.45' : '';
    }
    // If dotplot was active and now disabled, switch to histogram
    if (tooMany && activeChart === 'dotplot') {
      const histRadio = /** @type {HTMLInputElement|null} */ (
        document.querySelector('input[name="chart-type"][value="histogram"]'));
      if (histRadio) {
        histRadio.checked = true;
        activeChart = 'histogram';
      }
    }
  }
}

// ── State ─────────────────────────────────────────────────────────────

/**
 * Grouped data: { groupName: number[] }
 * @type {Record<string, number[]>}
 */
let groupedData = {};

/** All values combined (for shared axis domains). */
/** @type {number[]} */
let allValues = [];

/** Decimal places in source data. */
let dataPrecision = 0;

/** Current bin count for histogram. */
let currentBinCount = 7;

/** Whether to show outliers in boxplot. */
let showOutliers = true;

/** Whether to show mean marker on boxplot. */
let showMeanMarker = false;

/** Whether to show relative frequency on histogram y-axis. */
let relativeFreq = false;

/**
 * Current loaded dataset (raw JSON), null if pasted.
 * @type {null | {variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>>}}
 */
let loadedDataset = null;

// ── Chart controls ────────────────────────────────────────────────────

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
    if (allValues.length > 0) {
      input.value = String(currentBinCount);
    }
    wrapWithStepper(input);
    input.addEventListener('input', () => {
      const n = parseInt(input.value, 10);
      if (!isFinite(n) || n < 3) return;
      currentBinCount = n;
      renderActiveChart();
    });

    // Y-axis scale toggle
    const yLabel = document.createElement('label');
    yLabel.innerHTML = 'Y-axis: <select id="y-scale"><option value="frequency">Frequency</option><option value="relative">Proportion</option></select>';
    yLabel.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
    chartControls.appendChild(yLabel);
    const ySelect = /** @type {HTMLSelectElement} */ (yLabel.querySelector('select'));
    ySelect.style.cssText = 'padding:0.15rem 0.3rem;font-size:0.85rem;';
    ySelect.value = relativeFreq ? 'relative' : 'frequency';
    ySelect.addEventListener('change', () => {
      relativeFreq = ySelect.value === 'relative';
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

  // Mean marker checkbox — available for all chart types
  const meanLabel = document.createElement('label');
  meanLabel.innerHTML = '<input type="checkbox" id="show-mean-grouped"> Show mean';
  meanLabel.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
  chartControls.appendChild(meanLabel);
  const meanCb = /** @type {HTMLInputElement} */ (meanLabel.querySelector('input'));
  meanCb.checked = showMeanMarker;
  meanCb.addEventListener('change', () => {
    showMeanMarker = meanCb.checked;
    renderActiveChart();
  });
}

// ── Spreadsheet editor ────────────────────────────────────────────────

const editSheetBody = document.getElementById('edit-sheet-body');
const EMPTY_ROWS = 8;

/**
 * Initialize the two-column spreadsheet.
 * @param {Array<{value: string, group: string}>} [initialData]
 */
function initSheet(initialData) {
  if (!editSheetBody) return;
  editSheetBody.innerHTML = '';
  const data = initialData ?? [];
  const rowCount = Math.max(data.length + 3, EMPTY_ROWS);
  for (let i = 0; i < rowCount; i++) {
    appendSheetRow(i + 1, data[i]?.value ?? '', data[i]?.group ?? '');
  }
}

/**
 * Append a single row to the spreadsheet.
 * @param {number} rowNum
 * @param {string} value
 * @param {string} group
 * @returns {{ valueInput: HTMLInputElement, groupInput: HTMLInputElement }}
 */
function appendSheetRow(rowNum, value, group) {
  if (!editSheetBody) throw new Error('No sheet body');
  const tr = document.createElement('tr');
  if (!value && !group) tr.className = 'empty-row';

  const tdNum = document.createElement('td');
  tdNum.className = 'row-num';
  tdNum.textContent = String(rowNum);
  tr.appendChild(tdNum);

  const tdVal = document.createElement('td');
  const valueInput = document.createElement('input');
  valueInput.type = 'text';
  valueInput.inputMode = 'decimal';
  valueInput.value = value;
  valueInput.setAttribute('aria-label', `Row ${rowNum} value`);
  tdVal.appendChild(valueInput);
  tr.appendChild(tdVal);

  const tdGroup = document.createElement('td');
  const groupInput = document.createElement('input');
  groupInput.type = 'text';
  groupInput.value = group;
  groupInput.setAttribute('aria-label', `Row ${rowNum} group`);
  tdGroup.appendChild(groupInput);
  tr.appendChild(tdGroup);

  // Navigation
  const inputs = [valueInput, groupInput];
  for (const input of inputs) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === 'ArrowDown') {
        e.preventDefault();
        const nextRow = tr.nextElementSibling;
        if (nextRow) {
          /** @type {HTMLInputElement|null} */ (nextRow.querySelector('input'))?.focus();
        } else {
          const newRow = appendSheetRow(rowNum + 1, '', '');
          newRow.valueInput.focus();
        }
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevRow = tr.previousElementSibling;
        if (prevRow) {
          /** @type {HTMLInputElement|null} */ (prevRow.querySelector('input'))?.focus();
        }
      }
    });

    input.addEventListener('input', () => {
      tr.className = (valueInput.value.trim() || groupInput.value.trim()) ? '' : 'empty-row';
      if (!tr.nextElementSibling && (valueInput.value.trim() || groupInput.value.trim())) {
        const count = editSheetBody ? editSheetBody.querySelectorAll('tr').length : 0;
        for (let i = 0; i < 3; i++) {
          appendSheetRow(count + i + 1, '', '');
        }
      }
    });
  }

  // Handle paste into value column (multi-line)
  valueInput.addEventListener('paste', (e) => {
    const text = /** @type {ClipboardEvent} */ (e).clipboardData?.getData('text');
    if (!text) return;
    // If text has tabs, it's likely two-column data
    const lines = text.split(/[\n\r]+/).filter(s => s.trim().length > 0);
    if (lines.length <= 1) return;
    e.preventDefault();

    const rows = editSheetBody ? Array.from(editSheetBody.querySelectorAll('tr')) : [];
    let startIdx = rows.indexOf(tr);
    if (startIdx < 0) startIdx = rows.length;

    for (let i = 0; i < lines.length; i++) {
      const parts = lines[i].split(/\t/);
      const val = parts[0]?.trim() ?? '';
      const grp = parts[1]?.trim() ?? '';
      const rowIdx = startIdx + i;
      if (rowIdx < rows.length) {
        const inps = rows[rowIdx].querySelectorAll('input');
        /** @type {HTMLInputElement} */ (inps[0]).value = val;
        if (inps[1] && grp) /** @type {HTMLInputElement} */ (inps[1]).value = grp;
        rows[rowIdx].className = val ? '' : 'empty-row';
      } else {
        appendSheetRow(rowIdx + 1, val, grp);
      }
    }
    // Add trailing empty rows
    const totalRows = editSheetBody ? editSheetBody.querySelectorAll('tr').length : 0;
    for (let i = 0; i < 3; i++) {
      appendSheetRow(totalRows + i + 1, '', '');
    }
  });

  editSheetBody.appendChild(tr);
  return { valueInput, groupInput };
}

/**
 * Read all non-empty rows from the spreadsheet.
 * @returns {Array<{value: string, group: string}>}
 */
function readSheetData() {
  if (!editSheetBody) return [];
  /** @type {Array<{value: string, group: string}>} */
  const data = [];
  for (const tr of editSheetBody.querySelectorAll('tr')) {
    const inputs = tr.querySelectorAll('input');
    const val = /** @type {HTMLInputElement} */ (inputs[0]).value.trim();
    const grp = /** @type {HTMLInputElement} */ (inputs[1]).value.trim();
    if (val && grp) data.push({ value: val, group: grp });
  }
  return data;
}

/**
 * Populate the spreadsheet with data rows.
 * @param {Array<{value: string, group: string}>} data
 */
function populateSheet(data) {
  initSheet(data);
}

// Initialize empty spreadsheet
initSheet();

// ── Data loading ──────────────────────────────────────────────────────

/**
 * Load raw text (CSV/pasted), parse it, and find numeric + categorical columns.
 * @param {string} raw
 * @param {string} sourceName
 */
function loadRawText(raw, sourceName) {
  loadedDataset = null;

  try {
    const parsed = parseCSV(raw);
    const numericVars = parsed.headers.filter((_h, i) => parsed.types[i] === 'numeric');
    const catVars = parsed.headers.filter((_h, i) => parsed.types[i] === 'categorical');

    if (numericVars.length === 0 || catVars.length === 0) {
      const msg = 'This data needs at least one numeric and one categorical column for grouped comparison.';
      announce(msg);
      if (chartArea) {
        chartArea.innerHTML = `<p class="hint" style="text-align:center;padding:2rem 1rem;">${msg}</p>`;
      }
      return;
    }

    // Build a pseudo-dataset object
    loadedDataset = {
      variables: parsed.headers.map((h, i) => ({
        name: h,
        label: h,
        type: parsed.types[i],
      })),
      rows: parsed.data,
    };

    setupVariableSelectors(loadedDataset, sourceName);
  } catch {
    announce('Could not parse data.');
  }
}

/**
 * Populate the quantitative and grouping variable dropdowns.
 * @param {{ variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>> }} ds
 * @param {string} sourceName
 */
function setupVariableSelectors(ds, sourceName) {
  const numericVars = ds.variables.filter(v => v.type === 'numeric');
  const catVars = ds.variables.filter(v => v.type === 'categorical');

  if (numericVars.length === 0 || catVars.length === 0) {
    announce('Dataset needs both numeric and categorical variables.');
    return;
  }

  // Reset controls to defaults on new data
  activeChart = 'boxplot';
  showOutliers = true;
  relativeFreq = false;

  // Apply ?chart= URL param on first load
  const chartParam = new URLSearchParams(window.location.search).get('chart');
  if (chartParam && ['boxplot', 'dotplot', 'histogram', 'density'].includes(chartParam)) {
    activeChart = /** @type {'boxplot'|'dotplot'|'histogram'|'density'} */ (chartParam);
  }

  const defaultRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector(`input[name="chart-type"][value="${activeChart}"]`));
  if (defaultRadio) defaultRadio.checked = true;

  quantVarSelect.innerHTML = '';
  for (const v of numericVars) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.label || v.name;
    quantVarSelect.appendChild(opt);
  }

  groupVarSelect.innerHTML = '';
  for (const v of catVars) {
    const opt = document.createElement('option');
    opt.value = v.name;
    opt.textContent = v.label || v.name;
    groupVarSelect.appendChild(opt);
  }

  if (variableSelector) variableSelector.hidden = false;

  loadGroupedData(numericVars[0].name, catVars[0].name, ds, sourceName);
}

/**
 * Split data into groups and display.
 * @param {string} quantVar - Name of numeric column
 * @param {string} groupVar - Name of categorical column
 * @param {{ variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>> }} ds
 * @param {string} sourceName
 */
function loadGroupedData(quantVar, groupVar, ds, sourceName) {
  const quantInfo = ds.variables.find(v => v.name === quantVar);
  const groupInfo = ds.variables.find(v => v.name === groupVar);
  currentVarLabel = quantInfo?.label || quantVar;
  currentGroupLabel = groupInfo?.label || groupVar;

  /** @type {Record<string, number[]>} */
  const groups = {};
  /** @type {string[]} */
  const groupOrder = [];

  for (const row of ds.rows) {
    const val = parseFloat(row[quantVar]);
    const grp = String(row[groupVar]);
    if (!isFinite(val) || !grp) continue;
    if (!groups[grp]) {
      groups[grp] = [];
      groupOrder.push(grp);
    }
    groups[grp].push(val);
  }

  if (groupOrder.length === 0) {
    announce('No valid grouped data found.');
    return;
  }

  // Rebuild groupedData preserving insertion order
  groupedData = {};
  for (const g of groupOrder) {
    groupedData[g] = groups[g];
  }

  allValues = Object.values(groupedData).flat();
  dataPrecision = detectPrecision(allValues);
  currentBinCount = sturgesBins(allValues.length);

  // Populate spreadsheet
  /** @type {Array<{value: string, group: string}>} */
  const sheetData = [];
  for (const row of ds.rows) {
    const val = row[quantVar];
    const grp = row[groupVar];
    if (val != null && grp != null) {
      sheetData.push({ value: String(val), group: String(grp) });
    }
  }
  populateSheet(sheetData);

  const groupNames = Object.keys(groupedData);
  const groupSummary = groupNames.map(g => `${g}: n=${groupedData[g].length}`).join(', ');
  if (dataSummary) {
    dataSummary.textContent = `${sourceName} -- ${currentVarLabel} by ${currentGroupLabel} (${groupSummary})`;
  }

  if (resultsSection) resultsSection.hidden = false;
  updateDotplotAvailability();
  renderStats();
  updateChartControls();
  renderActiveChart();
  setPageTitle(baseTitle, sourceName, { variable: currentVarLabel, n: allValues.length });
  announce(`${allValues.length} values in ${groupNames.length} groups. Chart and statistics updated.`);
}

// Variable selector change handlers
quantVarSelect.addEventListener('change', () => {
  if (!loadedDataset) return;
  loadGroupedData(quantVarSelect.value, groupVarSelect.value, loadedDataset, 'Dataset');
});
groupVarSelect.addEventListener('change', () => {
  if (!loadedDataset) return;
  loadGroupedData(quantVarSelect.value, groupVarSelect.value, loadedDataset, 'Dataset');
});

// ── Data panel (dataset dropdown, file, paste) ────────────────────────

/**
 * Handle the Apply button for edited spreadsheet data.
 */
function handleApply() {
  const rows = readSheetData();
  if (rows.length === 0) {
    announce('Enter values and group labels.');
    return;
  }

  // Build a pseudo-dataset
  loadedDataset = {
    variables: [
      { name: 'value', label: 'Value', type: 'numeric' },
      { name: 'group', label: 'Group', type: 'categorical' },
    ],
    rows: rows.map(r => ({ value: parseFloat(r.value), group: r.group })),
  };

  setupVariableSelectors(loadedDataset, 'Edited data');
}

const dataPanel = initDataPanel({
  autoCollapse: true,
  showPreview: true,
  // Grouped comparison needs a real grouping variable: 2+ levels with >=3 obs
  // per group. Excludes datasets like urban_owner (52 single-record state
  // "groups") that produce nonsense boxplots/stats (REQ-024).
  datasetFilter: (/** @type {any} */ ds) => ds.hasNumeric && ds.hasCategorical && ds.groupLevels >= 2 && ds.minGroupN >= 3,
  onDataset: (ds) => {
    loadedDataset = ds;
    setupVariableSelectors(ds, ds.name ?? 'Dataset');
  },
  onRawText: loadRawText,
  onClear: clearDisplay,
});

// Override the Apply button to handle two-column spreadsheet
const loadPastedBtn = document.getElementById('load-pasted');
if (loadPastedBtn) {
  const newBtn = /** @type {HTMLElement} */ (loadPastedBtn.cloneNode(true));
  loadPastedBtn.parentNode?.replaceChild(newBtn, loadPastedBtn);
  newBtn.addEventListener('click', handleApply);
}

// ── Rendering ─────────────────────────────────────────────────────────

/** Render the currently selected chart type. */
function renderActiveChart() {
  if (!chartArea || allValues.length === 0) return;
  chartArea.innerHTML = '';

  const groupNames = Object.keys(groupedData);

  if (activeChart === 'boxplot') {
    drawBoxplot(chartArea, groupedData, {
      xLabel: currentVarLabel,
      titleText: `Boxplot of ${currentVarLabel} by ${currentGroupLabel}`,
      descText: `Side-by-side boxplots comparing ${currentVarLabel} across groups of ${currentGroupLabel}`,
      id: 'grouped-box',
      animate: false,
      showOutliers,
      showMean: showMeanMarker,
    });
  } else if (activeChart === 'dotplot') {
    renderStackedDotplotsLocal();
  } else if (activeChart === 'histogram') {
    renderStackedHistogramsLocal();
  } else if (activeChart === 'density') {
    const densityResult = drawGroupedDensity(chartArea, groupedData, {
      xLabel: currentVarLabel,
      titleText: `Density of ${currentVarLabel} by ${currentGroupLabel}`,
      descText: `Overlaid density curves comparing ${currentVarLabel} across groups of ${currentGroupLabel}`,
      id: 'grouped-density',
    });

    // Mean markers: vertical dashed lines at each group mean
    if (showMeanMarker && densityResult) {
      const colors = getColors(groupNames.length);
      drawMeanOnGroupedDensity(densityResult, groupedData, groupNames, colors);
    }
  }

  // Wrap stats table with copy button (only once — skip if already wrapped)
  const statsTable = /** @type {HTMLTableElement|null} */ (
    document.getElementById('grouped-stats-table'));
  if (statsTable && !statsTable.closest('.statlens-table')) {
    wrapTable(statsTable);
  }

}

/**
 * Render separate dotplots stacked vertically, one per group, with shared x-axis domain.
 */
function renderStackedDotplotsLocal() {
  if (!chartArea) return;
  renderStackedDotplots(chartArea, groupedData, {
    xLabel: currentVarLabel,
    showMean: showMeanMarker,
    idPrefix: 'grouped-dot',
  });
}

/**
 * Render separate histograms stacked vertically with shared x-axis and bin boundaries.
 */
function renderStackedHistogramsLocal() {
  if (!chartArea) return;
  const { sharedBins, domain, thresholds } = renderStackedHistograms(chartArea, groupedData, {
    xLabel: currentVarLabel,
    numBins: currentBinCount,
    relativeFrequency: relativeFreq,
    showMean: showMeanMarker,
    idPrefix: 'grouped-hist',
  });

  // Bin frequency table (collapsed by default)
  renderBinTable(chartArea, /** @type {any} */ (sharedBins), {
    relativeFrequency: relativeFreq,
    precision: dataPrecision,
    grouped: groupedData,
    domain,
    thresholds,
  });
}

// renderBinTable is now imported from ../../js/stats-tables.js

// ── Summary statistics table ──────────────────────────────────────────

/** Render the grouped summary statistics table. */
function renderStats() {
  // Replace the existing table with a fresh one from buildGroupedStatsTable
  const wrap = document.querySelector('.grouped-stats-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';
  const table = buildGroupedStatsTable(wrap, groupedData, {
    numLabel: currentVarLabel,
    catLabel: currentGroupLabel,
  });
  table.id = 'grouped-stats-table';
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Clear all displayed stats and charts. */
function clearDisplay() {
  groupedData = {};
  allValues = [];
  loadedDataset = null;
  if (variableSelector) variableSelector.hidden = true;
  if (dataPreview) dataPreview.hidden = true;
  if (resultsSection) resultsSection.hidden = true;
  if (chartArea) chartArea.innerHTML = '';
}

// URL ?dataset= auto-load is handled by initDataPanel() in page-utils.js
