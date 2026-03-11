// @ts-check
/**
 * Descriptive Statistics explore tool — standalone page logic.
 * Loads data (dataset, paste, or URL), computes summary stats, renders charts.
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
const statsSection = document.getElementById('stats-section');
const chartsSection = document.getElementById('charts-section');

const histogramContainer = document.getElementById('histogram-container');
const dotplotContainer = document.getElementById('dotplot-container');
const boxplotContainer = document.getElementById('boxplot-container');
const showOutliersCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-outliers'));
const binCountInput = /** @type {HTMLInputElement} */ (document.getElementById('bin-count'));

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

// Bin count change re-renders histogram only
binCountInput?.addEventListener('change', () => {
  if (currentValues.length === 0) return;
  const varLabel = dataSummary?.textContent?.split(' - ')[1]?.split(' (')[0] || 'Value';
  histogramContainer.innerHTML = '';
  const numBins = parseInt(binCountInput.value, 10);
  if (!isFinite(numBins) || numBins < 3) return;
  drawHistogram(histogramContainer, currentValues, {
    xLabel: varLabel,
    yLabel: 'Frequency',
    titleText: `Histogram of ${varLabel}`,
    descText: `Histogram showing the distribution of ${varLabel}`,
    id: 'desc-hist',
    animate: false,
    numBins,
  });
});

// Outlier toggle re-renders boxplot only
showOutliersCheckbox?.addEventListener('change', () => {
  if (currentValues.length === 0) return;
  boxplotContainer.innerHTML = '';
  const varLabel = dataSummary?.textContent?.split(' - ')[1]?.split(' (')[0] || 'Value';
  drawBoxplot(boxplotContainer, currentValues, {
    xLabel: varLabel,
    titleText: `Boxplot of ${varLabel}`,
    descText: `Boxplot showing five-number summary of ${varLabel}`,
    id: 'desc-box',
    animate: false,
    showOutliers: showOutliersCheckbox.checked,
  });
});

// ── State ─────────────────────────────────────────────────────────────

/** @type {number[]} */
let currentValues = [];

/** Decimal places in source data (for formatStat). */
let dataPrecision = 0;

/**
 * Current loaded dataset (raw JSON), null if pasted.
 * @type {null | {variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>>}}
 */
let loadedDataset = null;

// ── Data loading ──────────────────────────────────────────────────────

/**
 * Load parsed CSV/text data, setting up variable selector for multi-numeric.
 * Handles both CSV (with headers) and plain-number fallback.
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
 * Set the current data, compute stats, and render charts.
 * @param {number[]} values
 * @param {string} varLabel
 * @param {string} sourceName
 */
function setData(values, varLabel, sourceName) {
  currentValues = values;
  dataPrecision = detectPrecision(values);

  // Show data preview
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) dataSummary.textContent = `${sourceName} - ${varLabel} (n = ${values.length})`;

  computeAndDisplay(values);
  renderCharts(values, varLabel);
  announce(`${values.length} values. Statistics and charts updated.`);
}

/**
 * Compute and display summary statistics.
 * @param {number[]} values
 */
function computeAndDisplay(values) {
  if (statsSection) statsSection.hidden = false;

  const d = dataPrecision;
  const n = values.length;
  const [lo, hi] = range(values);
  const q1Val = quantile(values, 0.25);
  const q3Val = quantile(values, 0.75);

  statN.textContent = String(n);
  statMean.textContent = formatStat(mean(values), d);
  statMedian.textContent = formatStat(median(values), d);
  statSd.textContent = formatStat(sd(values), d);
  statMin.textContent = formatStat(lo, d);
  statQ1.textContent = formatStat(q1Val, d);
  statQ3.textContent = formatStat(q3Val, d);
  statMax.textContent = formatStat(hi, d);
  statIqr.textContent = formatStat(iqr(values), d);
  statRange.textContent = formatStat(hi - lo, d);
}

/**
 * Render histogram, dotplot, and boxplot.
 * @param {number[]} values
 * @param {string} xLabel
 */
function renderCharts(values, xLabel) {
  if (chartsSection) chartsSection.hidden = false;

  // Clear previous charts
  histogramContainer.innerHTML = '';
  dotplotContainer.innerHTML = '';
  boxplotContainer.innerHTML = '';

  if (values.length === 0) return;

  // Set bin count default from Sturges' rule
  const defaultBins = sturgesBins(values.length);
  if (binCountInput) binCountInput.value = String(defaultBins);

  drawHistogram(histogramContainer, values, {
    xLabel,
    yLabel: 'Frequency',
    titleText: `Histogram of ${xLabel}`,
    descText: `Histogram showing the distribution of ${xLabel}`,
    id: 'desc-hist',
    animate: false,
  });

  // Dotplot: show for datasets up to 200 values
  if (values.length <= 200) {
    drawDotplot(dotplotContainer, values, {
      xLabel,
      titleText: `Dotplot of ${xLabel}`,
      descText: `Dot plot showing individual values of ${xLabel}`,
      id: 'desc-dot',
      animate: false,
    });
  } else {
    dotplotContainer.innerHTML =
      '<p class="hint">Dotplot hidden for datasets with more than 200 values.</p>';
  }

  drawBoxplot(boxplotContainer, values, {
    xLabel,
    titleText: `Boxplot of ${xLabel}`,
    descText: `Boxplot showing five-number summary of ${xLabel}`,
    id: 'desc-box',
    animate: false,
    showOutliers: showOutliersCheckbox?.checked ?? true,
  });
}

// ── Helpers ───────────────────────────────────────────────────────────

/** Clear all displayed stats and charts. */
function clearDisplay() {
  currentValues = [];
  loadedDataset = null;
  variableSelector.hidden = true;
  if (dataPreview) dataPreview.hidden = true;
  if (statsSection) statsSection.hidden = true;
  if (chartsSection) chartsSection.hidden = true;
  histogramContainer.innerHTML = '';
  dotplotContainer.innerHTML = '';
  boxplotContainer.innerHTML = '';
}
