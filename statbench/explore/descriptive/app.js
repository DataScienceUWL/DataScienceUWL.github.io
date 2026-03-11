// @ts-check
/**
 * Descriptive Statistics explore tool — standalone page logic.
 * Two-column layout: chart (with type toggle) left, stats sidebar right.
 */

import { parseCSV } from '../../js/csv-parser.js';
import { mean, median, sd, quantile, iqr, range, detectPrecision, formatStat } from '../../js/stats.js';
import { drawHistogram, sturgesBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { announce, initTabs, initDataPanel } from '../../js/page-utils.js';

// ── DOM elements ──────────────────────────────────────────────────────

const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const variableSelector = document.getElementById('variable-selector');
const varSelect = /** @type {HTMLSelectElement} */ (document.getElementById('var-select'));
const resultsSection = document.getElementById('results-section');
const chartArea = document.getElementById('chart-area');
const chartControls = document.getElementById('chart-controls');

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

// ── Data loading ──────────────────────────────────────────────────────

/**
 * Load parsed CSV/text data, setting up variable selector for multi-numeric.
 * @param {string} raw - Raw text input
 * @param {string} sourceName
 */
function loadRawText(raw, sourceName) {
  loadedDataset = null;
  variableSelector.hidden = true;

  // Try CSV parse first (has headers)
  try {
    const parsed = parseCSV(raw);
    const numIdx = parsed.types.indexOf('numeric');
    if (numIdx >= 0) {
      const numericCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
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
        variableSelector.hidden = false;
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

initDataPanel({
  datasetFilter: ds => ds.type === 'bootstrap' || ds.type === 'explore',
  onDataset: (ds) => {
    loadedDataset = ds;
    const numericVars = ds.variables.filter(v => v.type === 'numeric');

    if (numericVars.length === 0) {
      announce('No numeric variables found in this dataset.');
      return;
    }

    if (numericVars.length > 1) {
      varSelect.innerHTML = '';
      for (const v of numericVars) {
        const opt = document.createElement('option');
        opt.value = v.name;
        opt.textContent = v.label || v.name;
        varSelect.appendChild(opt);
      }
      variableSelector.hidden = false;
    } else {
      variableSelector.hidden = true;
    }

    const varName = numericVars[0].name;
    const varLabel = numericVars[0].label || varName;
    const values = ds.rows.map(r => r[varName]).filter(v => isFinite(v));
    setData(values, varLabel, ds.name);
  },
  onRawText: loadRawText,
  onClear: clearDisplay,
});

// Variable selector change
varSelect.addEventListener('change', () => {
  if (!loadedDataset) return;
  const varName = varSelect.value;
  const varInfo = loadedDataset.variables.find(v => v.name === varName);
  const varLabel = varInfo?.label || varName;
  const values = loadedDataset.rows.map(r => r[varName]).filter(v => isFinite(v));
  setData(values, varLabel, loadedDataset.name ?? 'Dataset');
});

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
    variableSelector.hidden = true;
    setData(values, params.get('label') || 'Value', 'URL data');
  }
})();

// ── Core: set data, compute stats, render ─────────────────────────────

/**
 * Set the current data, compute stats, and render the active chart.
 * @param {number[]} values
 * @param {string} varLabel
 * @param {string} sourceName
 */
function setData(values, varLabel, sourceName) {
  currentValues = values;
  currentVarLabel = varLabel;
  dataPrecision = detectPrecision(values);
  currentBinCount = sturgesBins(values.length);

  // Show data preview
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) dataSummary.textContent = `${sourceName} - ${varLabel} (n = ${values.length})`;

  if (resultsSection) resultsSection.hidden = false;
  computeAndDisplay(values);
  updateChartControls();
  renderActiveChart();
  announce(`${values.length} values. Statistics and chart updated.`);
}

/**
 * Compute and display summary statistics.
 * @param {number[]} values
 */
function computeAndDisplay(values) {
  const d = dataPrecision;
  const [lo, hi] = range(values);

  statN.textContent = String(values.length);
  statMean.textContent = formatStat(mean(values), d);
  statMedian.textContent = formatStat(median(values), d);
  statSd.textContent = formatStat(sd(values), d);
  statMin.textContent = formatStat(lo, d);
  statQ1.textContent = formatStat(quantile(values, 0.25), d);
  statQ3.textContent = formatStat(quantile(values, 0.75), d);
  statMax.textContent = formatStat(hi, d);
  statIqr.textContent = formatStat(iqr(values), d);
  statRange.textContent = formatStat(hi - lo, d);
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

// ── Helpers ───────────────────────────────────────────────────────────

/** Clear all displayed stats and charts. */
function clearDisplay() {
  currentValues = [];
  loadedDataset = null;
  variableSelector.hidden = true;
  if (dataPreview) dataPreview.hidden = true;
  if (resultsSection) resultsSection.hidden = true;
  if (chartArea) chartArea.innerHTML = '';
}
