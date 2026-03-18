// @ts-check
/**
 * Compare Groups explore tool — standalone page logic.
 * Shows side-by-side boxplots, dotplots, or histograms comparing
 * a quantitative variable across levels of a categorical grouping variable.
 */

import * as d3Selection from 'd3-selection';
import { parseCSV } from '../../js/csv-parser.js';
import { mean, median, sd, quantile, iqr, range, detectPrecision, formatStat } from '../../js/stats.js';
import { drawHistogram, computeBins, sturgesBins } from '../../js/histogram.js';
import { drawDotplot, computeDots } from '../../js/dotplot.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { drawGroupedDensity } from '../../js/kde.js';
import { createExportBar } from '../../js/export.js';
import { announce, initTabs, initDataPanel, initHelp, wrapWithStepper, setPageTitle } from '../../js/page-utils.js';
import { getColors } from '../../js/chart-utils.js';
import { DOTPLOT_AUTO_THRESHOLD } from '../../js/chart-defaults.js';

initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatBench$/, '');

// ── DOM elements ──────────────────────────────────────────────────────

const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const variableSelector = document.getElementById('variable-selector');
const quantVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('quant-var-select'));
const groupVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('group-var-select'));
const resultsSection = document.getElementById('results-section');
const chartArea = document.getElementById('chart-area');
const chartControls = document.getElementById('chart-controls');

const statsThead = document.getElementById('stats-thead');
const statsTbody = document.getElementById('stats-tbody');

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
    yLabel.innerHTML = 'Y-axis: <select id="y-scale"><option value="frequency">Frequency</option><option value="relative">Relative Frequency</option></select>';
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
      announce('Data must contain at least one numeric and one categorical column.');
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
  const boxRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="chart-type"][value="boxplot"]'));
  if (boxRadio) boxRadio.checked = true;

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
  datasetFilter: (/** @type {any} */ ds) => ds.hasNumeric && ds.hasCategorical,
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
    renderStackedDotplots(groupNames);
  } else if (activeChart === 'histogram') {
    renderStackedHistograms(groupNames);
  } else if (activeChart === 'density') {
    const densityResult = drawGroupedDensity(chartArea, groupedData, {
      xLabel: currentVarLabel,
      titleText: `Density of ${currentVarLabel} by ${currentGroupLabel}`,
      descText: `Overlaid density curves comparing ${currentVarLabel} across groups of ${currentGroupLabel}`,
      id: 'grouped-density',
    });

    // Mean markers: vertical red dashed lines at each group mean
    if (showMeanMarker && densityResult) {
      const colors = getColors(groupNames.length);
      const overlays = d3Selection.select(densityResult.frame.inner).select('.overlays');
      for (let i = 0; i < groupNames.length; i++) {
        const vals = groupedData[groupNames[i]];
        if (vals.length === 0) continue;
        const meanVal = mean(vals);
        const mx = densityResult.xScale(meanVal);
        overlays.append('line')
          .attr('x1', mx).attr('x2', mx)
          .attr('y1', 0).attr('y2', densityResult.frame.height)
          .attr('stroke', colors[i])
          .attr('stroke-width', 2)
          .attr('stroke-dasharray', '6,3')
          .attr('aria-label', `${groupNames[i]} mean = ${formatStat(meanVal, dataPrecision)}`);
      }
    }
  }

  // Export bar
  const statsTable = /** @type {HTMLTableElement|null} */ (
    document.getElementById('grouped-stats-table'));
  createExportBar({
    chartContainer: chartArea,
    chartFilename: `${currentVarLabel.replace(/\s+/g, '_')}_by_${currentGroupLabel.replace(/\s+/g, '_')}_${activeChart}.png`,
    table: statsTable ?? undefined,
  });
}

/**
 * Render separate dotplots stacked vertically, one per group, with shared x-axis domain.
 * @param {string[]} groupNames
 */
function renderStackedDotplots(groupNames) {
  if (!chartArea) return;
  const xMin = Math.min(...allValues);
  const xMax = Math.max(...allValues);
  const pad = (xMax - xMin) * 0.05 || 0.5;
  /** @type {[number, number]} */
  const domain = [xMin - pad, xMax + pad];

  // Compact height: scale with max group size, clamp between 160–371
  const maxGroupN = Math.max(...groupNames.map(g => groupedData[g].length));
  const compactHeight = Math.min(371, Math.max(160, 100 + maxGroupN * 4));

  const colors = getColors(groupNames.length);
  for (let i = 0; i < groupNames.length; i++) {
    const name = groupNames[i];
    const values = groupedData[name];
    const wrapper = document.createElement('div');

    const label = document.createElement('p');
    label.className = 'group-label';
    label.textContent = `${name} (n = ${values.length})`;
    label.style.color = colors[i];
    wrapper.appendChild(label);

    const chartDiv = document.createElement('div');
    wrapper.appendChild(chartDiv);
    chartArea.appendChild(wrapper);

    const dotResult = drawDotplot(chartDiv, values, {
      xLabel: i === groupNames.length - 1 ? currentVarLabel : '',
      titleText: `Dotplot of ${currentVarLabel} for ${name}`,
      descText: `Dot plot of ${currentVarLabel} for group ${name}`,
      id: `grouped-dot-${i}`,
      animate: false,
      domain,
      fillColor: colors[i],
      viewHeight: compactHeight,
    });

    // Mean marker: red triangle below x-axis
    if (showMeanMarker && values.length > 0) {
      const meanVal = mean(values);
      const mx = dotResult.xScale(meanVal);
      const triangleY = dotResult.frame.height + 12;
      const size = 6;
      const triangle = `M${mx},${triangleY - size} L${mx - size},${triangleY + size} L${mx + size},${triangleY + size} Z`;
      const overlays = d3Selection.select(dotResult.frame.inner).select('.overlays');
      overlays.append('path')
        .attr('d', triangle)
        .attr('fill', '#F05133')
        .attr('stroke', 'none')
        .attr('aria-label', `Mean = ${formatStat(meanVal, dataPrecision)}`)
        .append('title')
        .text(`Mean = ${formatStat(meanVal, dataPrecision)}`);
    }
  }
}

/**
 * Render separate histograms stacked vertically with shared x-axis and bin boundaries.
 * @param {string[]} groupNames
 */
function renderStackedHistograms(groupNames) {
  if (!chartArea) return;

  // Compute shared bin boundaries from all values
  const { bins: sharedBins } = computeBins(allValues, {
    numBins: currentBinCount,
  });
  const thresholds = /** @type {number[]} */ (sharedBins.slice(1).map(b => b.x0));
  /** @type {[number, number]} */
  const domain = [/** @type {number} */ (sharedBins[0].x0), /** @type {number} */ (sharedBins[sharedBins.length - 1].x1)];

  // Compact height: scale with max group size, clamp between 160–371
  const maxGroupN = Math.max(...groupNames.map(g => groupedData[g].length));
  const compactHeight = Math.min(371, Math.max(160, 100 + maxGroupN * 4));

  const colors = getColors(groupNames.length);
  for (let i = 0; i < groupNames.length; i++) {
    const name = groupNames[i];
    const values = groupedData[name];
    const wrapper = document.createElement('div');

    const label = document.createElement('p');
    label.className = 'group-label';
    label.textContent = `${name} (n = ${values.length})`;
    label.style.color = colors[i];
    wrapper.appendChild(label);

    const chartDiv = document.createElement('div');
    wrapper.appendChild(chartDiv);
    chartArea.appendChild(wrapper);

    const histResult = drawHistogram(chartDiv, values, {
      xLabel: i === groupNames.length - 1 ? currentVarLabel : '',
      titleText: `Histogram of ${currentVarLabel} for ${name}`,
      descText: `Histogram of ${currentVarLabel} for group ${name}`,
      id: `grouped-hist-${i}`,
      animate: false,
      domain,
      thresholds,
      relativeFrequency: relativeFreq,
      fillColor: colors[i],
      viewHeight: compactHeight,
    });

    // Mean marker: vertical red dashed line
    if (showMeanMarker && values.length > 0) {
      const meanVal = mean(values);
      const mx = histResult.xScale(meanVal);
      const overlays = d3Selection.select(histResult.frame.inner).select('.overlays');
      overlays.append('line')
        .attr('x1', mx).attr('x2', mx)
        .attr('y1', 0).attr('y2', histResult.frame.height)
        .attr('stroke', '#F05133')
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6,3')
        .attr('aria-label', `Mean = ${formatStat(meanVal, dataPrecision)}`);
    }
  }

  // Bin frequency table (collapsed by default)
  renderBinTable(/** @type {any} */ (sharedBins), groupNames, domain, thresholds);
}

/**
 * Render a collapsible bin frequency table below the histograms.
 * @param {Array<{x0: number, x1: number, length: number}>} sharedBins - Bins computed from all values
 * @param {string[]} groupNames
 * @param {[number, number]} domain
 * @param {number[]} thresholds
 */
function renderBinTable(sharedBins, groupNames, domain, thresholds) {
  if (!chartArea) return;

  // Compute per-group bins using the same boundaries
  /** @type {Record<string, number[]>} */
  const groupBinCounts = {};
  for (const name of groupNames) {
    const { bins } = computeBins(groupedData[name], { domain, thresholds });
    groupBinCounts[name] = bins.map(b => b.length);
  }

  const details = document.createElement('details');
  details.className = 'bin-table-details';
  details.style.cssText = 'margin:0.5rem 0;font-size:0.85rem;';
  const summary = document.createElement('summary');
  summary.textContent = relativeFreq ? 'Bin relative frequencies' : 'Bin frequencies';
  summary.style.cssText = 'cursor:pointer;color:var(--ims-green);font-weight:500;';
  details.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'bin-freq-table';
  table.style.cssText = 'width:100%;border-collapse:collapse;margin:0.4rem 0;font-size:0.82rem;';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const thBin = document.createElement('th');
  thBin.textContent = 'Bin';
  thBin.style.cssText = 'text-align:left;padding:0.2rem 0.4rem;border-bottom:2px solid #ccc;';
  headerRow.appendChild(thBin);
  for (const name of groupNames) {
    const th = document.createElement('th');
    th.textContent = name;
    th.style.cssText = 'text-align:right;padding:0.2rem 0.4rem;border-bottom:2px solid #ccc;';
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Rows
  const tbody = document.createElement('tbody');
  const d = dataPrecision;
  for (let i = 0; i < sharedBins.length; i++) {
    const bin = sharedBins[i];
    const tr = document.createElement('tr');
    if (i % 2 === 1) tr.style.background = '#f8f8f8';

    const tdBin = document.createElement('td');
    tdBin.textContent = `[${formatStat(/** @type {number} */ (bin.x0), d)}, ${formatStat(/** @type {number} */ (bin.x1), d)})`;
    tdBin.style.cssText = 'padding:0.2rem 0.4rem;border-bottom:1px solid #eee;white-space:nowrap;';
    tr.appendChild(tdBin);

    for (const name of groupNames) {
      const td = document.createElement('td');
      const count = groupBinCounts[name][i] ?? 0;
      if (relativeFreq) {
        const n = groupedData[name].length || 1;
        const rf = count / n;
        td.textContent = rf === 0 ? '0' : rf.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      } else {
        td.textContent = String(count);
      }
      td.style.cssText = 'text-align:right;padding:0.2rem 0.4rem;border-bottom:1px solid #eee;';
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(table);
  chartArea.appendChild(details);
}

// ── Summary statistics table ──────────────────────────────────────────

/** Render the grouped summary statistics table. */
function renderStats() {
  if (!statsThead || !statsTbody) return;

  const groupNames = Object.keys(groupedData);
  const d = dataPrecision;

  // Group colors matching chart palette
  const colors = getColors(groupNames.length);

  // Build header row
  statsThead.innerHTML = '';
  const headerRow = document.createElement('tr');
  const thStat = document.createElement('th');
  thStat.scope = 'col';
  thStat.textContent = 'Statistic';
  headerRow.appendChild(thStat);

  for (let i = 0; i < groupNames.length; i++) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = groupNames[i];
    th.style.borderBottom = `3px solid ${colors[i % colors.length]}`;
    headerRow.appendChild(th);
  }
  statsThead.appendChild(headerRow);

  // Build data rows
  const statRows = [
    { label: 'n', fn: (/** @type {number[]} */ v) => String(v.length) },
    { label: 'Mean', fn: (/** @type {number[]} */ v) => formatStat(mean(v), d), sep: true },
    { label: 'Std Dev', fn: (/** @type {number[]} */ v) => formatStat(sd(v), d) },
    { label: 'Min', fn: (/** @type {number[]} */ v) => { const [lo] = range(v); return formatStat(lo, d); }, sep: true },
    { label: 'Q1', fn: (/** @type {number[]} */ v) => formatStat(quantile(v, 0.25), d) },
    { label: 'Median', fn: (/** @type {number[]} */ v) => formatStat(median(v), d) },
    { label: 'Q3', fn: (/** @type {number[]} */ v) => formatStat(quantile(v, 0.75), d) },
    { label: 'Max', fn: (/** @type {number[]} */ v) => { const [, hi] = range(v); return formatStat(hi, d); } },
    { label: 'IQR', fn: (/** @type {number[]} */ v) => formatStat(iqr(v), d), sep: true },
    { label: 'Range', fn: (/** @type {number[]} */ v) => { const [lo, hi] = range(v); return formatStat(hi - lo, d); } },
  ];

  statsTbody.innerHTML = '';
  for (const stat of statRows) {
    const tr = document.createElement('tr');
    if (stat.sep) tr.className = 'stat-sep';

    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = stat.label;
    tr.appendChild(th);

    for (let i = 0; i < groupNames.length; i++) {
      const td = document.createElement('td');
      td.textContent = stat.fn(groupedData[groupNames[i]]);
      td.style.backgroundColor = colors[i % colors.length] + '12';
      tr.appendChild(td);
    }

    statsTbody.appendChild(tr);
  }
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
