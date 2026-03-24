// @ts-check
/**
 * Descriptive Statistics explore tool — quantitative variables only.
 * Histogram, dotplot, boxplot with summary statistics.
 */

import { parseCSV } from '../../js/csv-parser.js';
import { mean, median, sd, quantile, iqr, range, detectPrecision, formatStat } from '../../js/stats.js';
import { drawHistogram, sturgesBins } from '../../js/histogram.js';
import { drawDotplot, computeDots, dotplotBins } from '../../js/dotplot.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { announce, initTabs, initDataPanel, initHelp, wrapWithStepper, setPageTitle } from '../../js/page-utils.js';
import { DOTPLOT_AUTO_THRESHOLD } from '../../js/chart-defaults.js';
import { overlayDensityOnHistogram, silvermanBandwidth, drawGroupedDensity } from '../../js/kde.js';
import { wrapTable } from '../../js/export.js';
import { initSheet, handleSheetPaste, readSheetValues, populateSheet } from '../../js/spreadsheet.js';
import { drawMeanOnHistogram, drawMeanOnDotplot, drawMeanOnGroupedDensity } from '../../js/mean-marker.js';
import { renderBinTable } from '../../js/stats-tables.js';

initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM elements ──────────────────────────────────────────────────────

const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const variableSelector = document.getElementById('variable-selector');
const varSelect = /** @type {HTMLSelectElement} */ (document.getElementById('var-select'));
const resultsSection = document.getElementById('results-section');
const chartArea = document.getElementById('chart-area');
const chartControls = document.getElementById('chart-controls');

const crosslinkEl = document.getElementById('dataset-crosslink');

const groupFilterEl = document.getElementById('group-filter');
const groupSelect = /** @type {HTMLSelectElement} */ (document.getElementById('group-select'));

const numericStats = document.getElementById('numeric-stats');

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

// ── Chart type toggle ────────────────────────────────────────────────

/** @type {'histogram'|'dotplot'|'boxplot'|'density'} */
let activeChart = 'histogram';

/** Current variable label (for chart titles). */
let currentVarLabel = 'Value';

/** Whether to show density curve overlay on histograms. */
let showDensity = false;

/** Whether to show relative frequency (proportion) on y-axis. */
let relativeFreq = false;

/** Whether to show mean marker on dotplots and boxplots. */
let showMeanMarker = false;

/** Bandwidth multiplier for density plot (1.0 = Silverman default). */
let bandwidthMult = 1.0;

/** @type {'full'|'names'|'none'} */
let labelsMode = 'full';
const _descUrlParams = new URLSearchParams(window.location.search);
const _descLabelsParam = _descUrlParams.get('labels');
if (_descLabelsParam && ['full', 'names', 'none'].includes(_descLabelsParam)) {
  labelsMode = /** @type {'full'|'names'|'none'} */ (_descLabelsParam);
}

const chartRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="chart-type"]')
);

chartRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    activeChart = /** @type {'histogram'|'dotplot'|'boxplot'|'density'} */ (radio.value);
    renderActiveChart();
    updateChartControls();
  });
});

/**
 * Enable or disable the dotplot radio based on whether data would overflow.
 * Call after data loads or variable selection changes.
 */
function updateDotplotAvailability() {
  const values = currentValues;
  let tooMany = values.length > DOTPLOT_AUTO_THRESHOLD;

  if (!tooMany && values.length > 0) {
    const result = computeDots(values);
    const INNER_HEIGHT = 296;
    const MIN_R = 2;
    tooMany = result.maxStack > 0 && result.maxStack * MIN_R * 2 > INNER_HEIGHT;
  }

  const dotRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="chart-type"][value="dotplot"]'));
  if (dotRadio) {
    dotRadio.disabled = tooMany;
    const label = dotRadio.closest('label');
    if (label) {
      label.title = tooMany ? 'Too many values for dotplot — try Histogram' : '';
      label.style.opacity = tooMany ? '0.45' : '';
    }
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

    // Density overlay checkbox
    const densityLabel = document.createElement('label');
    densityLabel.innerHTML = '<input type="checkbox" id="show-density"> Density curve';
    densityLabel.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
    chartControls.appendChild(densityLabel);
    const densityCb = /** @type {HTMLInputElement} */ (densityLabel.querySelector('input'));
    densityCb.checked = showDensity;
    densityCb.addEventListener('change', () => {
      showDensity = densityCb.checked;
      renderActiveChart();
    });

  } else if (activeChart === 'dotplot') {
    const label = document.createElement('label');
    label.innerHTML = 'Stacks: <input type="number" id="dot-bin-count" min="3" max="50" step="1">';
    label.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
    chartControls.appendChild(label);
    const input = /** @type {HTMLInputElement} */ (label.querySelector('input'));
    input.style.cssText = 'width:3.5rem;padding:0.15rem 0.3rem;font-size:0.85rem;';
    if (currentValues.length > 0) {
      input.value = String(currentDotBinCount ?? dotplotBins(currentValues));
    }
    wrapWithStepper(input);
    input.addEventListener('input', () => {
      const n = parseInt(input.value, 10);
      if (!isFinite(n) || n < 3) return;
      currentDotBinCount = n;
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

  } else if (activeChart === 'density') {
    // Bandwidth multiplier slider
    const label = document.createElement('label');
    label.innerHTML = 'Bandwidth: <input type="range" id="bw-slider" min="0.2" max="3" step="0.1" style="width:100px;vertical-align:middle;"> <span id="bw-display"></span>';
    label.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
    chartControls.appendChild(label);
    const slider = /** @type {HTMLInputElement} */ (label.querySelector('input'));
    const display = /** @type {HTMLSpanElement} */ (label.querySelector('#bw-display'));
    slider.value = String(bandwidthMult);
    display.textContent = bandwidthMult === 1 ? 'default' : `×${bandwidthMult.toFixed(1)}`;
    slider.addEventListener('input', () => {
      bandwidthMult = parseFloat(slider.value);
      display.textContent = bandwidthMult === 1 ? 'default' : `×${bandwidthMult.toFixed(1)}`;
      renderActiveChart();
    });
  }

  // Show mean checkbox — available for all chart types
  const meanLabel = document.createElement('label');
  meanLabel.innerHTML = '<input type="checkbox" id="show-mean-marker"> Show mean';
  meanLabel.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
  chartControls.appendChild(meanLabel);
  const meanCb = /** @type {HTMLInputElement} */ (meanLabel.querySelector('input'));
  meanCb.checked = showMeanMarker;
  meanCb.addEventListener('change', () => {
    showMeanMarker = meanCb.checked;
    renderActiveChart();
  });

  // "Show values" toggle — visible when labels URL param suppresses numbers
  if (_descLabelsParam && _descLabelsParam !== 'full') {
    const valLabel = document.createElement('label');
    valLabel.innerHTML = '<input type="checkbox" id="show-values"> Show values';
    valLabel.style.cssText = 'display:inline-flex;flex-direction:row;align-items:center;gap:0.3rem;font-weight:400;font-size:0.85rem;';
    chartControls.appendChild(valLabel);
    const valCb = /** @type {HTMLInputElement} */ (valLabel.querySelector('input'));
    valCb.checked = labelsMode === 'full';
    valCb.addEventListener('change', () => {
      labelsMode = valCb.checked ? 'full' : /** @type {'full'|'names'|'none'} */ (_descLabelsParam);
      renderActiveChart();
      // Hide/show stats panel
      if (numericStats) numericStats.hidden = labelsMode !== 'full';
    });
  }
}

// ── State ─────────────────────────────────────────────────────────────

/** @type {number[]} */
let currentValues = [];

/** Decimal places in source data (for formatStat). */
let dataPrecision = 0;

/** Current bin count for histogram. */
let currentBinCount = 7;

/** Current bin count for dotplot (null = auto via Sturges). */
let currentDotBinCount = /** @type {number|null} */ (null);

/** Whether to show outliers in boxplot. */
let showOutliers = true;


/**
 * Current loaded dataset (raw JSON), null if pasted.
 * @type {null | {variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>>}}
 */
let loadedDataset = null;

/** Name of the categorical grouping variable (if any). */
let groupVarName = '';

/**
 * Grouped data for group filter: { groupName: number[] }.
 * Only populated when dataset has a categorical variable.
 * @type {Record<string, number[]>}
 */
let groupedSubsets = {};

// ── Spreadsheet editor ───────────────────────────────────────────────

const quantSheetBody = document.getElementById('quant-sheet-body');

if (quantSheetBody) {
  initSheet(quantSheetBody, 'number');
  quantSheetBody.addEventListener('paste', (e) =>
    handleSheetPaste(quantSheetBody, 'number', /** @type {ClipboardEvent} */ (e)));
}

// ── Data loading ──────────────────────────────────────────────────────

/**
 * Load parsed CSV/text data, setting up variable selector for multi-column.
 * @param {string} raw - Raw text input
 * @param {string} sourceName
 */
function loadRawText(raw, sourceName) {
  loadedDataset = null;
  if (variableSelector) variableSelector.hidden = true;

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
    // Not valid CSV
  }

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
 * Handle the Apply button — reads from spreadsheet.
 */
function handleApply() {
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

// ── Dataset grouping ─────────────────────────────────────────────────

/**
 * Show a cross-link hint when a dataset belongs to a non-primary group.
 * @param {any} meta - Dataset metadata from the index
 */
function showCrosslink(meta) {
  if (!crosslinkEl) return;
  crosslinkEl.hidden = true;
  crosslinkEl.innerHTML = '';
  if (!meta) return;

  const dsParam = meta.file ? `?dataset=${encodeURIComponent(meta.file.replace('.json', ''))}` : '';
  if (meta.hasCategorical) {
    crosslinkEl.innerHTML = `This dataset has a categorical grouping variable. To compare groups, try <a href="../../explore/grouped/${dsParam}">Grouped Statistics</a>.`;
    crosslinkEl.hidden = false;
  } else if (meta.type === 'paired') {
    crosslinkEl.innerHTML = `This dataset has paired measurements. To compare pairs, try <a href="../../explore/grouped/${dsParam}">Grouped Statistics</a>.`;
    crosslinkEl.hidden = false;
  } else if (meta.type === 'regression' || (meta.variables && meta.variables.length > 1)) {
    crosslinkEl.innerHTML = `This dataset has two quantitative variables. To explore their relationship, try <a href="../../explore/regression/${dsParam}">Regression</a>.`;
    crosslinkEl.hidden = false;
  }
}

/**
 * Set up the group filter dropdown when a dataset has a categorical variable.
 * @param {{ variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>> }} ds
 */
function setupGroupFilter(ds) {
  groupVarName = '';
  groupedSubsets = {};

  const catVars = ds.variables.filter(v => v.type === 'categorical');
  if (catVars.length === 0) {
    if (groupFilterEl) groupFilterEl.hidden = true;
    return;
  }

  const catVar = catVars[0];
  groupVarName = catVar.name;
  const groupLabel = catVar.label || catVar.name;

  rebuildGroupSubsets(ds);

  groupSelect.innerHTML = '';
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All (combined)';
  groupSelect.appendChild(allOpt);

  for (const level of Object.keys(groupedSubsets)) {
    const opt = document.createElement('option');
    opt.value = level;
    opt.textContent = `${level} (n=${groupedSubsets[level].length})`;
    groupSelect.appendChild(opt);
  }

  if (groupFilterEl) {
    const label = groupFilterEl.querySelector('label');
    if (label) {
      label.firstChild && (label.firstChild.textContent = `${groupLabel}: `);
    }
    groupFilterEl.hidden = false;
  }
}

/**
 * Rebuild groupedSubsets from current dataset and selected numeric variable.
 * @param {{ variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>> }} ds
 */
function rebuildGroupSubsets(ds) {
  groupedSubsets = {};
  if (!groupVarName) return;

  const numVar = varSelect.value || ds.variables.find(v => v.type === 'numeric')?.name;
  if (!numVar) return;

  for (const row of ds.rows) {
    const val = parseFloat(row[numVar]);
    const grp = String(row[groupVarName]);
    if (!isFinite(val) || !grp) continue;
    if (!groupedSubsets[grp]) {
      groupedSubsets[grp] = [];
    }
    groupedSubsets[grp].push(val);
  }
}

// Group filter change handler
groupSelect.addEventListener('change', () => {
  if (!loadedDataset) return;

  const selectedGroup = groupSelect.value;
  const numVarName = varSelect.value || loadedDataset.variables.find(v => v.type === 'numeric')?.name;
  if (!numVarName) return;

  const numVar = loadedDataset.variables.find(v => v.name === numVarName);
  if (!numVar) return;

  if (selectedGroup) {
    const values = loadedDataset.rows
      .filter(r => String(r[groupVarName]) === selectedGroup)
      .map(r => parseFloat(r[numVar.name]))
      .filter(v => isFinite(v));
    const label = `${numVar.label || numVar.name} (${selectedGroup})`;
    setData(values, label, '');
  } else {
    loadVariable(numVar, loadedDataset);
  }
});

const dataPanel = initDataPanel({
  autoCollapse: true,
  showPreview: true,
  datasetFilter: (/** @type {any} */ ds) =>
    ds.hasNumeric === true && !ds.hasCategorical &&
    ds.type !== 'regression' && ds.type !== 'paired',
  onDataset: (ds, meta) => {
    loadedDataset = ds;
    showCrosslink(meta);
    const matchingVars = ds.variables.filter(
      /** @param {{type:string}} v */ v => v.type === 'numeric'
    );

    if (matchingVars.length === 0) {
      announce('No quantitative variables in this dataset.');
      return;
    }

    if (matchingVars.length > 1) {
      varSelect.innerHTML = '';
      for (const v of matchingVars) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.label || v.name;
        varSelect.appendChild(opt);
      }
      if (variableSelector) variableSelector.hidden = false;
    } else {
      if (variableSelector) variableSelector.hidden = true;
    }

    setupGroupFilter(ds);
    loadVariable(matchingVars[0], ds);
  },
  onRawText: loadRawText,
  onClear: clearDisplay,
});

// Override the default Apply button to use spreadsheet
const loadPastedBtn = document.getElementById('load-pasted');
if (loadPastedBtn) {
  const newBtn = loadPastedBtn.cloneNode(true);
  loadPastedBtn.parentNode?.replaceChild(newBtn, loadPastedBtn);
  newBtn.addEventListener('click', handleApply);
}

// Variable selector change
varSelect.addEventListener('change', () => {
  if (!loadedDataset) return;
  const varName = varSelect.value;
  const varInfo = loadedDataset.variables.find(/** @param {any} v */ v => v.name === varName);
  if (varInfo) {
    if (groupVarName) rebuildGroupSubsets(loadedDataset);
    loadVariable(varInfo, loadedDataset);
  }
});

/**
 * Load a numeric variable from a dataset.
 * @param {{name:string, label:string, type:string}} varInfo
 * @param {{name?:string, rows:Array<Record<string,any>>}} ds
 */
function loadVariable(varInfo, ds) {
  const varLabel = varInfo.label || varInfo.name;
  const sourceName = ds.name ?? 'Dataset';
  const values = ds.rows.map(r => r[varInfo.name]).filter(v => isFinite(v));
  setData(values, varLabel, sourceName);
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
  currentVarLabel = varLabel;
  dataPrecision = detectPrecision(values);
  currentBinCount = sturgesBins(values.length);
  currentDotBinCount = null; // reset to auto (Sturges) for new data

  // Reset controls to defaults on new data
  activeChart = 'histogram';
  showOutliers = true;
  showDensity = false;
  relativeFreq = false;
  bandwidthMult = 1.0;

  // Apply ?chart= URL param on first load
  const chartParam = new URLSearchParams(window.location.search).get('chart');
  if (chartParam && ['histogram', 'dotplot', 'boxplot', 'density'].includes(chartParam)) {
    activeChart = /** @type {'histogram'|'dotplot'|'boxplot'|'density'} */ (chartParam);
  }

  const defaultRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector(`input[name="chart-type"][value="${activeChart}"]`));
  if (defaultRadio) defaultRadio.checked = true;
  if (groupSelect) groupSelect.value = '';

  // Populate spreadsheet editor
  if (quantSheetBody) populateSheet(quantSheetBody, 'number', values.map(String));

  if (numericStats) numericStats.hidden = false;

  if (dataSummary) dataSummary.textContent = `${varLabel} (n = ${values.length})`;

  if (resultsSection) resultsSection.hidden = false;
  updateDotplotAvailability();
  computeAndDisplay(values);
  updateChartControls();
  renderActiveChart();
  setPageTitle(baseTitle, sourceName, { variable: varLabel, n: values.length });
  announce(`${values.length} values. Statistics and chart updated.`);
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

// renderBinTable is now imported from ../../js/stats-tables.js

/**
 * Render the currently selected quantitative chart type.
 */
function renderActiveChart() {
  if (!chartArea || currentValues.length === 0) return;
  chartArea.innerHTML = '';
  const xLabel = currentVarLabel;

  if (activeChart === 'histogram') {
    const histResult = drawHistogram(chartArea, currentValues, {
      xLabel,
      titleText: `Histogram of ${xLabel}`,
      descText: `Histogram showing the distribution of ${xLabel}`,
      id: 'desc-hist',
      animate: false,
      numBins: currentBinCount,
      relativeFrequency: relativeFreq,
      labels: labelsMode,
    });
    if (showDensity && histResult && histResult.bins && histResult.bins.length > 0 && currentValues.length >= 2) {
      const firstX0 = /** @type {number} */ (histResult.bins[0].x0);
      const lastX1 = /** @type {number} */ (histResult.bins[histResult.bins.length - 1].x1);
      const avgBinWidth = (lastX1 - firstX0) / histResult.bins.length;
      overlayDensityOnHistogram(histResult.frame.inner, currentValues, histResult.xScale, histResult.yScale, avgBinWidth);
    }
    if (showMeanMarker) drawMeanOnHistogram(histResult, currentValues);
    if (labelsMode === 'full' && histResult && histResult.bins && histResult.bins.length > 0) {
      renderBinTable(chartArea, histResult.bins, {
        totalN: currentValues.length,
        relativeFrequency: relativeFreq,
        precision: dataPrecision,
      });
    }
  } else if (activeChart === 'dotplot') {
    const dotResult = drawDotplot(chartArea, currentValues, {
      xLabel,
      titleText: `Dotplot of ${xLabel}`,
      descText: `Dot plot showing individual values of ${xLabel}`,
      id: 'desc-dot',
      animate: false,
      numBins: currentDotBinCount ?? undefined,
      labels: labelsMode,
    });

    if (showMeanMarker) drawMeanOnDotplot(dotResult, currentValues);
  } else if (activeChart === 'boxplot') {
    drawBoxplot(chartArea, currentValues, {
      xLabel,
      titleText: `Boxplot of ${xLabel}`,
      descText: `Boxplot showing five-number summary of ${xLabel}`,
      id: 'desc-box',
      animate: false,
      showOutliers,
      showMean: showMeanMarker,
      labels: labelsMode,
    });

  } else if (activeChart === 'density') {
    const bw = silvermanBandwidth(currentValues) * bandwidthMult;
    const grouped = { [xLabel]: currentValues };
    const densityResult = drawGroupedDensity(chartArea, grouped, {
      xLabel,
      titleText: `Density Plot of ${xLabel}`,
      descText: `Kernel density estimate showing the distribution shape of ${xLabel}`,
      id: 'desc-density',
      bandwidth: bw,
    });
    if (showMeanMarker) {
      drawMeanOnGroupedDensity(densityResult, grouped, [xLabel], ['#F05133']);
    }
  }

  // Wrap stats table with copy button (only once — skip if already wrapped)
  const statsTable = /** @type {HTMLTableElement|null} */ (
    document.querySelector('#numeric-stats .sidebar-stats'));
  if (statsTable && !statsTable.closest('.statlens-table')) {
    wrapTable(statsTable, { copyTitle: 'Copy statistics to clipboard' });
  }

  // Hide stats panel and bin table when labels are suppressed
  if (numericStats) numericStats.hidden = labelsMode !== 'full';
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Clear all displayed stats and charts. */
function clearDisplay() {
  currentValues = [];

  loadedDataset = null;
  groupVarName = '';
  groupedSubsets = {};
  if (variableSelector) variableSelector.hidden = true;
  if (groupFilterEl) groupFilterEl.hidden = true;
  if (dataPreview) dataPreview.hidden = true;
  if (resultsSection) resultsSection.hidden = true;
  if (chartArea) chartArea.innerHTML = '';
  if (crosslinkEl) crosslinkEl.hidden = true;
}
