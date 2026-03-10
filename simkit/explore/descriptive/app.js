// @ts-check
/**
 * Descriptive Statistics explore tool — standalone page logic.
 * Loads data (dataset, paste, or URL), computes summary stats, renders charts.
 */

import { parseCSV } from '../../js/csv-parser.js';
import { mean, median, sd, quantile, iqr, range } from '../../js/stats.js';
import { drawHistogram } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { announce, initTabs, loadDatasetIndex, fetchDataset } from '../../js/page-utils.js';

// ── DOM elements ──────────────────────────────────────────────────────

const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const datasetDesc = document.getElementById('dataset-desc');
const pasteArea = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-area'));
const loadPastedBtn = document.getElementById('load-pasted');
const clearBtn = document.getElementById('clear-btn');
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

/**
 * Current loaded dataset (raw JSON), null if pasted.
 * @type {null | {variables: Array<{name:string, label:string, type:string}>, rows: Array<Record<string,any>>}}
 */
let loadedDataset = null;

// ── Dataset loading ───────────────────────────────────────────────────

/** @type {Array<{id:string, name:string, description:string, type:string, n:number}>} */
let datasetIndex = [];

if (datasetSelect) {
  loadDatasetIndex(datasetSelect, ds => ds.type === 'bootstrap' || ds.type === 'explore', datasetDesc)
    .then(index => { datasetIndex = index; });

  datasetSelect.addEventListener('change', () => {
    const id = datasetSelect.value;
    if (!id) {
      if (datasetDesc) datasetDesc.textContent = '';
      return;
    }
    const meta = datasetIndex.find(d => d.id === id);
    if (meta && datasetDesc) datasetDesc.textContent = meta.description;

    fetchDataset(id)
      .then(ds => {
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
      })
      .catch(() => announce('Could not load dataset.'));
  });
}

// Variable selector change
varSelect.addEventListener('change', () => {
  if (!loadedDataset) return;
  const varName = varSelect.value;
  const varInfo = loadedDataset.variables.find(v => v.name === varName);
  const varLabel = varInfo?.label || varName;
  const values = loadedDataset.rows.map(r => r[varName]).filter(v => isFinite(v));
  setData(values, varLabel, loadedDataset.name ?? 'Dataset');
});

// ── Paste data ────────────────────────────────────────────────────────

loadPastedBtn?.addEventListener('click', () => {
  const raw = pasteArea.value.trim();
  if (!raw) return;

  loadedDataset = null;
  variableSelector.hidden = true;

  // Try CSV parse first (has headers)
  try {
    const parsed = parseCSV(raw);
    // Find first numeric column
    const numIdx = parsed.types.indexOf('numeric');
    if (numIdx >= 0) {
      const colName = parsed.headers[numIdx];
      const values = parsed.data
        .map(row => parseFloat(row[colName]))
        .filter(v => isFinite(v));

      // If multiple numeric columns, populate selector
      const numericCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
      if (numericCols.length > 1) {
        varSelect.innerHTML = '';
        for (const col of numericCols) {
          const opt = document.createElement('option');
          opt.value = col;
          opt.textContent = col;
          varSelect.appendChild(opt);
        }
        variableSelector.hidden = false;
        // Store as pseudo-dataset for variable switching
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

      setData(values, colName, 'Pasted data');
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
    announce('No numeric values found in pasted data.');
    return;
  }

  setData(values, 'Value', 'Pasted data');
});

clearBtn?.addEventListener('click', () => {
  pasteArea.value = '';
  clearDisplay();
});

// ── URL data ──────────────────────────────────────────────────────────

(function checkUrlData() {
  const params = new URLSearchParams(window.location.search);
  const dataParam = params.get('data');
  if (!dataParam) return;

  const urlInfo = document.getElementById('url-data-info');

  // Try to parse as comma-separated numbers
  const values = dataParam.split(',')
    .map(s => s.trim())
    .map(Number)
    .filter(v => isFinite(v));

  if (values.length > 0) {
    if (urlInfo) urlInfo.textContent = `Loaded ${values.length} values from URL.`;
    // Switch to URL tab
    for (const t of document.querySelectorAll('[role="tab"]')) t.setAttribute('aria-selected', 'false');
    for (const p of document.querySelectorAll('[role="tabpanel"]')) /** @type {HTMLElement} */ (p).hidden = true;
    document.getElementById('tab-url')?.setAttribute('aria-selected', 'true');
    document.getElementById('panel-url')?.removeAttribute('hidden');

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

  // Show data preview
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) dataSummary.textContent = `${sourceName} - ${varLabel} (n = ${values.length})`;

  computeAndDisplay(values);
  renderCharts(values, varLabel);
  announce(`Loaded ${values.length} values. Statistics and charts updated.`);
}

/**
 * Compute and display summary statistics.
 * @param {number[]} values
 */
function computeAndDisplay(values) {
  if (statsSection) statsSection.hidden = false;

  const n = values.length;
  const [lo, hi] = range(values);
  const q1Val = quantile(values, 0.25);
  const q3Val = quantile(values, 0.75);

  statN.textContent = String(n);
  statMean.textContent = fmt(mean(values));
  statMedian.textContent = fmt(median(values));
  statSd.textContent = fmt(sd(values));
  statMin.textContent = fmt(lo);
  statQ1.textContent = fmt(q1Val);
  statQ3.textContent = fmt(q3Val);
  statMax.textContent = fmt(hi);
  statIqr.textContent = fmt(iqr(values));
  statRange.textContent = fmt(hi - lo);
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

/**
 * Format a number for display (up to 4 decimal places).
 * @param {number} x
 * @returns {string}
 */
function fmt(x) {
  if (!isFinite(x)) return '\u2014';
  // Use up to 4 decimals, strip trailing zeros
  return parseFloat(x.toFixed(4)).toString();
}

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
