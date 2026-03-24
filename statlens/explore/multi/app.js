// @ts-check
/**
 * Data Explorer — multi-variable exploration workspace.
 * Loads a dataset, shows all variables with type badges, lets students
 * select 1-2 variables and choose any chart type. Surfaces the same
 * controls as each individual explore app (bins, density, outliers, etc.).
 */

import { drawHistogram, sturgesBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { drawBarChart } from '../../js/barchart.js';
import { drawPieChart } from '../../js/pie.js';
import { drawWaffleChart } from '../../js/waffle.js';
import { drawScatterplot, drawResidualPlot } from '../../js/scatterplot.js';
import { drawGroupedDensity, overlayDensityOnHistogram } from '../../js/kde.js';
import { cor, linreg, loess, detectPrecision, formatStat } from '../../js/stats.js';
import { getColors } from '../../js/chart-utils.js';
import { wrapTable } from '../../js/export.js';
import { announce, initTabs, initDataPanel, initHelp, setPageTitle, wrapWithStepper } from '../../js/page-utils.js';
import { drawMeanOnHistogram, drawMeanOnDotplot } from '../../js/mean-marker.js';
import { renderStackedHistograms, renderStackedDotplots } from '../../js/grouped-charts.js';
import { buildGroupedStatsTable, buildNumericStatsTable } from '../../js/stats-tables.js';

initHelp();
initTabs();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── DOM ──────────────────────────────────────────────────────────────

const resultsSection = document.getElementById('results-section');
const varList = document.getElementById('var-list');
const chartContainer = document.getElementById('chart-container');
const emptyState = document.getElementById('empty-state');
const statsContainer = document.getElementById('stats-container');
const chartRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="chart-type"]')
);
const swapBtn = document.getElementById('swap-btn');
const barModeSection = document.getElementById('bar-mode-section');
const barModeRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="bar-mode"]')
);
const chartOptionsSection = document.getElementById('chart-options-section');
const chartOptionsEl = document.getElementById('chart-options');
const tableModeSection = document.getElementById('table-mode-section');
const tableModeRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
  document.querySelectorAll('input[name="table-mode"]')
);

// ── State ────────────────────────────────────────────────────────────

/**
 * @typedef {{ name: string, label: string, type: 'numeric'|'categorical' }} VarInfo
 */

/** @type {VarInfo[]} */
let variables = [];

/** @type {Array<Record<string, any>>} */
let rows = [];

/** @type {string[]} selected variable names (0-2) */
let selected = [];

/** @type {string} */
let activeChart = 'boxplot';

/** @type {'dodged'|'stacked'|'filled'} */
let barMode = 'dodged';

/** Dataset display name */
let datasetName = '';

// ── Chart option state ──────────────────────────────────────────────

/** Histogram bin count (null = Sturges auto) */
let histBins = /** @type {number|null} */ (null);

/** Dotplot stack count (null = auto) */
let dotBins = /** @type {number|null} */ (null);

/** Show relative frequency on y-axis (histogram, bar chart) */
let relativeFreq = false;

/** Show density overlay on histogram */
let showDensity = false;

/** Show outliers on boxplot */
let showOutliers = true;

/** Show mean marker */
let showMean = false;

/** Show regression line on scatterplot */
let showRegLine = true;

/** Show LOESS curve on scatterplot */
let showLoess = false;

/** Show residual plot below scatterplot */
let showResiduals = false;

/** @type {'counts'|'row'|'col'|'cell'} contingency table display mode */
let tableMode = 'counts';

// ── Data loading ─────────────────────────────────────────────────────

initDataPanel({
  autoCollapse: true,
  showPreview: true,
  datasetFilter: () => true,
  onDataset: (ds) => {
    rows = ds.rows || [];
    variables = (ds.variables || []).map(/** @param {any} v */ v => ({
      name: v.name,
      label: v.label || v.name,
      type: v.type === 'numeric' ? 'numeric' : 'categorical',
    }));
    datasetName = ds.name || 'Dataset';
    selected = [];
    resetChartOptions();
    buildVariableList();
    if (resultsSection) resultsSection.hidden = false;
    setPageTitle(baseTitle, datasetName, { n: rows.length });
    announce(`${datasetName} loaded — ${rows.length} observations, ${variables.length} variables.`);
    showEmpty();
  },
  onText: (parsed) => {
    rows = parsed.data || [];
    variables = (parsed.headers || []).map((/** @type {string} */ h, /** @type {number} */ i) => ({
      name: h,
      label: h,
      type: parsed.types[i] === 'numeric' ? 'numeric' : 'categorical',
    }));
    datasetName = 'Pasted data';
    selected = [];
    resetChartOptions();
    buildVariableList();
    if (resultsSection) resultsSection.hidden = false;
    setPageTitle(baseTitle, datasetName, { n: rows.length });
    announce(`Data loaded — ${rows.length} observations, ${variables.length} variables.`);
    showEmpty();
  },
  onClear: () => {
    rows = [];
    variables = [];
    selected = [];
    if (resultsSection) resultsSection.hidden = true;
    if (varList) varList.innerHTML = '';
    clearChart();
    hideAllOptions();
    announce('Data cleared.');
  },
});

/** Reset chart option state to defaults. */
function resetChartOptions() {
  histBins = null;
  dotBins = null;
  relativeFreq = false;
  showDensity = false;
  showOutliers = true;
  showMean = false;
  showRegLine = true;
  showLoess = false;
  showResiduals = false;
  tableMode = 'counts';
  barMode = 'dodged';
  // Reset bar mode radio
  const dodgedRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="bar-mode"][value="dodged"]'));
  if (dodgedRadio) dodgedRadio.checked = true;
  // Reset table mode radio
  const countsRadio = /** @type {HTMLInputElement|null} */ (
    document.querySelector('input[name="table-mode"][value="counts"]'));
  if (countsRadio) countsRadio.checked = true;
}

/** Hide all conditional sidebar sections. */
function hideAllOptions() {
  if (barModeSection) barModeSection.hidden = true;
  if (chartOptionsSection) chartOptionsSection.hidden = true;
  if (tableModeSection) tableModeSection.hidden = true;
}

// ── Variable list ────────────────────────────────────────────────────

function buildVariableList() {
  if (!varList) return;
  varList.innerHTML = '';

  for (const v of variables) {
    const li = document.createElement('li');
    li.className = 'var-item';
    li.setAttribute('role', 'option');
    li.setAttribute('aria-selected', 'false');
    li.setAttribute('aria-pressed', 'false');
    li.setAttribute('tabindex', '0');
    li.dataset.varName = v.name;

    const badge = document.createElement('span');
    badge.className = `type-badge ${v.type === 'numeric' ? 'quantitative' : 'categorical'}`;
    badge.textContent = v.type === 'numeric' ? 'Q' : 'C';
    badge.setAttribute('aria-hidden', 'true');
    li.appendChild(badge);

    const nameSpan = document.createElement('span');
    nameSpan.className = 'var-name';
    nameSpan.textContent = v.label;
    li.appendChild(nameSpan);

    const roleSpan = document.createElement('span');
    roleSpan.className = 'role-label';
    roleSpan.setAttribute('aria-hidden', 'true');
    li.appendChild(roleSpan);

    li.addEventListener('click', () => toggleVariable(v.name));
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        toggleVariable(v.name);
      }
    });

    varList.appendChild(li);
  }
}

/**
 * Toggle a variable's selection state.
 * @param {string} name
 */
function toggleVariable(name) {
  const idx = selected.indexOf(name);
  if (idx >= 0) {
    selected.splice(idx, 1);
  } else if (selected.length < 2) {
    selected.push(name);
  } else {
    selected[1] = name;
  }
  updateVariableUI();
  renderChart();
}

/** Update variable list visual state. */
function updateVariableUI() {
  if (!varList) return;
  const items = varList.querySelectorAll('.var-item');
  for (const item of items) {
    const el = /** @type {HTMLElement} */ (item);
    const name = el.dataset.varName || '';
    const isSelected = selected.includes(name);
    el.setAttribute('aria-pressed', String(isSelected));
    el.setAttribute('aria-selected', String(isSelected));

    const roleLabel = el.querySelector('.role-label');
    if (roleLabel) {
      if (selected.length === 2 && isSelected) {
        roleLabel.textContent = selected[0] === name ? '1st' : '2nd';
      } else {
        roleLabel.textContent = '';
      }
    }
  }

  if (swapBtn) swapBtn.hidden = selected.length !== 2;
}

// ── Chart type ───────────────────────────────────────────────────────

chartRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    activeChart = radio.value;
    renderChart();
  });
});

// Swap variable roles
if (swapBtn) {
  swapBtn.addEventListener('click', () => {
    if (selected.length === 2) {
      selected.reverse();
      updateVariableUI();
      renderChart();
      announce(`Swapped roles: ${selected[0]} is now 1st, ${selected[1]} is now 2nd.`);
    }
  });
}

// Bar mode selector
barModeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    barMode = /** @type {'dodged'|'stacked'|'filled'} */ (radio.value);
    renderChart();
  });
});

// Table mode selector
tableModeRadios.forEach(radio => {
  radio.addEventListener('change', () => {
    tableMode = /** @type {'counts'|'row'|'col'|'cell'} */ (radio.value);
    renderChart();
  });
});

// Export dataset as CSV
const exportCsvBtn = document.getElementById('export-csv-btn');
if (exportCsvBtn) {
  exportCsvBtn.addEventListener('click', () => {
    if (rows.length === 0 || variables.length === 0) return;
    const headers = variables.map(v => v.name);
    const csvRows = [headers.join(',')];
    for (const row of rows) {
      const cells = headers.map(h => {
        let val = String(row[h] ?? '');
        if (val.includes(',') || val.includes('"') || val.includes('\n')) {
          val = `"${val.replace(/"/g, '""')}"`;
        }
        return val;
      });
      csvRows.push(cells.join(','));
    }
    const csv = csvRows.join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (datasetName || 'data').replace(/\s+/g, '_').toLowerCase();
    a.download = `${safeName}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Get a variable's info by name.
 * @param {string} name
 * @returns {VarInfo|undefined}
 */
function getVar(name) {
  return variables.find(v => v.name === name);
}

/**
 * Extract numeric values (filter NaN/null).
 * @param {string} name
 * @returns {number[]}
 */
function getNumericColumn(name) {
  return rows.map(r => Number(r[name])).filter(v => isFinite(v));
}

/**
 * Extract string values.
 * @param {string} name
 * @returns {string[]}
 */
function getCategoricalColumn(name) {
  return rows.map(r => String(r[name] ?? ''));
}

function clearChart() {
  if (chartContainer) chartContainer.innerHTML = '';
  if (statsContainer) statsContainer.innerHTML = '';
}

function showEmpty() {
  clearChart();
  hideAllOptions();
  if (emptyState && chartContainer) {
    chartContainer.appendChild(emptyState);
    emptyState.style.display = '';
  }
}

// ── Dynamic chart options ────────────────────────────────────────────

/**
 * Build the dynamic chart options panel based on current chart type
 * and variable combination.
 * @param {'1q'|'1c'|'2q'|'qc'|'2c'|'none'} combo
 */
function renderChartOptions(combo) {
  if (!chartOptionsEl) return;
  chartOptionsEl.innerHTML = '';
  let hasOptions = false;

  // Histogram options: bins, y-axis, density
  if (activeChart === 'histogram' && (combo === '1q' || combo === 'qc')) {
    hasOptions = true;
    // Bin count
    const binLabel = document.createElement('label');
    binLabel.textContent = 'Bins: ';
    const binInput = document.createElement('input');
    binInput.type = 'number';
    binInput.min = '3';
    binInput.max = '50';
    binInput.step = '1';
    binInput.value = String(histBins ?? sturgesBins(rows.length));
    binInput.addEventListener('input', () => {
      const n = parseInt(binInput.value, 10);
      if (!isFinite(n) || n < 3) return;
      histBins = n;
      renderChart();
    });
    binLabel.appendChild(binInput);
    chartOptionsEl.appendChild(binLabel);
    wrapWithStepper(binInput);

    // Y-axis scale
    const yLabel = document.createElement('label');
    yLabel.textContent = 'Y-axis: ';
    const ySelect = document.createElement('select');
    ySelect.innerHTML = '<option value="frequency">Frequency</option><option value="relative">Proportion</option>';
    ySelect.value = relativeFreq ? 'relative' : 'frequency';
    ySelect.addEventListener('change', () => {
      relativeFreq = ySelect.value === 'relative';
      renderChart();
    });
    yLabel.appendChild(ySelect);
    chartOptionsEl.appendChild(yLabel);

    // Density overlay (single quantitative only — grouped histograms are stacked vertically)
    if (combo === '1q') {
      const dLabel = document.createElement('label');
      const dCb = document.createElement('input');
      dCb.type = 'checkbox';
      dCb.checked = showDensity;
      dCb.addEventListener('change', () => { showDensity = dCb.checked; renderChart(); });
      dLabel.appendChild(dCb);
      dLabel.append(' Density curve');
      chartOptionsEl.appendChild(dLabel);
    }
  }

  // Dotplot options: stacks
  if (activeChart === 'dotplot' && (combo === '1q' || combo === 'qc')) {
    hasOptions = true;
    const sLabel = document.createElement('label');
    sLabel.textContent = 'Stacks: ';
    const sInput = document.createElement('input');
    sInput.type = 'number';
    sInput.min = '3';
    sInput.max = '50';
    sInput.step = '1';
    sInput.value = String(dotBins ?? sturgesBins(rows.length));
    sInput.addEventListener('input', () => {
      const n = parseInt(sInput.value, 10);
      if (!isFinite(n) || n < 3) return;
      dotBins = n;
      renderChart();
    });
    sLabel.appendChild(sInput);
    chartOptionsEl.appendChild(sLabel);
    wrapWithStepper(sInput);
  }

  // Boxplot options: outliers
  if (activeChart === 'boxplot' && (combo === '1q' || combo === 'qc')) {
    hasOptions = true;
    const oLabel = document.createElement('label');
    const oCb = document.createElement('input');
    oCb.type = 'checkbox';
    oCb.checked = showOutliers;
    oCb.addEventListener('change', () => { showOutliers = oCb.checked; renderChart(); });
    oLabel.appendChild(oCb);
    oLabel.append(' Show outliers');
    chartOptionsEl.appendChild(oLabel);
  }

  // Show mean (for any quantitative chart: histogram, dotplot, boxplot, density)
  if (['histogram', 'dotplot', 'boxplot', 'density'].includes(activeChart) &&
      (combo === '1q' || combo === 'qc')) {
    hasOptions = true;
    const mLabel = document.createElement('label');
    const mCb = document.createElement('input');
    mCb.type = 'checkbox';
    mCb.checked = showMean;
    mCb.addEventListener('change', () => { showMean = mCb.checked; renderChart(); });
    mLabel.appendChild(mCb);
    mLabel.append(' Show mean');
    chartOptionsEl.appendChild(mLabel);
  }

  // Bar chart mode for single categorical: frequency / relative
  if (activeChart === 'bar' && combo === '1c') {
    hasOptions = true;
    const fLabel = document.createElement('label');
    const fCb = document.createElement('input');
    fCb.type = 'checkbox';
    fCb.checked = relativeFreq;
    fCb.addEventListener('change', () => { relativeFreq = fCb.checked; renderChart(); });
    fLabel.appendChild(fCb);
    fLabel.append(' Show proportions');
    chartOptionsEl.appendChild(fLabel);
  }

  // Scatterplot options: regression line, LOESS, residuals
  if (activeChart === 'scatterplot' && combo === '2q') {
    hasOptions = true;

    const rLabel = document.createElement('label');
    const rCb = document.createElement('input');
    rCb.type = 'checkbox';
    rCb.checked = showRegLine;
    rCb.addEventListener('change', () => { showRegLine = rCb.checked; renderChart(); });
    rLabel.appendChild(rCb);
    rLabel.append(' Regression line');
    chartOptionsEl.appendChild(rLabel);

    const lLabel = document.createElement('label');
    const lCb = document.createElement('input');
    lCb.type = 'checkbox';
    lCb.checked = showLoess;
    lCb.addEventListener('change', () => { showLoess = lCb.checked; renderChart(); });
    lLabel.appendChild(lCb);
    lLabel.append(' LOESS curve');
    chartOptionsEl.appendChild(lLabel);

    const resLabel = document.createElement('label');
    const resCb = document.createElement('input');
    resCb.type = 'checkbox';
    resCb.checked = showResiduals;
    resCb.addEventListener('change', () => { showResiduals = resCb.checked; renderChart(); });
    resLabel.appendChild(resCb);
    resLabel.append(' Residual plot');
    chartOptionsEl.appendChild(resLabel);
  }

  if (chartOptionsSection) chartOptionsSection.hidden = !hasOptions;
}

// ── Render ───────────────────────────────────────────────────────────

function renderChart() {
  if (selected.length === 0) {
    showEmpty();
    return;
  }

  if (emptyState) emptyState.style.display = 'none';
  if (chartContainer) chartContainer.innerHTML = '';
  if (statsContainer) statsContainer.innerHTML = '';

  const v1 = getVar(selected[0]);
  const v2 = selected.length > 1 ? getVar(selected[1]) : null;

  if (!v1) return;

  // Determine variable type combination
  const types = [v1.type];
  if (v2) types.push(v2.type);
  const numCount = types.filter(t => t === 'numeric').length;
  const catCount = types.filter(t => t === 'categorical').length;

  /** @type {'1q'|'1c'|'2q'|'qc'|'2c'|'none'} */
  let combo = 'none';

  // Show/hide conditional sidebar sections
  const showBarMode = catCount === 2 && selected.length === 2 && activeChart === 'bar';
  if (barModeSection) barModeSection.hidden = !showBarMode;

  const showTableMode = catCount === 2 && selected.length === 2;
  if (tableModeSection) tableModeSection.hidden = !showTableMode;

  try {
    if (selected.length === 1) {
      if (v1.type === 'numeric') {
        combo = '1q';
        renderOneNumeric(v1);
      } else {
        combo = '1c';
        renderOneCategorical(v1);
      }
    } else if (numCount === 2) {
      combo = '2q';
      renderTwoNumeric(v1, /** @type {VarInfo} */ (v2));
    } else if (numCount === 1 && catCount === 1) {
      combo = 'qc';
      const numVar = v1.type === 'numeric' ? v1 : /** @type {VarInfo} */ (v2);
      const catVar = v1.type === 'categorical' ? v1 : /** @type {VarInfo} */ (v2);
      renderNumericByCategorical(numVar, catVar);
    } else if (catCount === 2) {
      combo = '2c';
      renderTwoCategorical(v1, /** @type {VarInfo} */ (v2));
    }
  } catch (e) {
    if (chartContainer) {
      chartContainer.innerHTML = `<div class="empty-state">Cannot render this chart for the selected variables.</div>`;
    }
  }

  // Build dynamic chart options
  renderChartOptions(combo);

  // Table copy buttons
  addTableActions();
}

// Mean marker helpers are imported from ../../js/mean-marker.js

// ── One numeric variable ─────────────────────────────────────────────

/** @param {VarInfo} v */
function renderOneNumeric(v) {
  const values = getNumericColumn(v.name);
  if (values.length === 0) return;

  if (activeChart === 'histogram') {
    const numBins = histBins ?? sturgesBins(values.length);
    const histResult = drawHistogram(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart', animate: false,
      numBins, relativeFrequency: relativeFreq,
    });
    // Density overlay
    if (showDensity && histResult && histResult.bins && histResult.bins.length > 0 && values.length >= 2) {
      const firstX0 = /** @type {number} */ (histResult.bins[0].x0);
      const lastX1 = /** @type {number} */ (histResult.bins[histResult.bins.length - 1].x1);
      const avgBinWidth = (lastX1 - firstX0) / histResult.bins.length;
      overlayDensityOnHistogram(histResult.frame.inner, values, histResult.xScale, histResult.yScale, avgBinWidth);
    }
    if (showMean) drawMeanOnHistogram(histResult, values);
  } else if (activeChart === 'dotplot') {
    const dotResult = drawDotplot(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart', animate: false,
      numBins: dotBins ?? undefined,
    });
    if (showMean) drawMeanOnDotplot(dotResult, values);
  } else if (activeChart === 'boxplot') {
    drawBoxplot(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart', animate: false,
      showOutliers, showMean,
    });
  } else if (activeChart === 'density') {
    // Standalone density — wrap single variable as a group
    drawGroupedDensity(chartContainer, { [v.label]: values }, {
      xLabel: v.label, titleText: `Density of ${v.label}`, id: 'explorer-chart',
    });
  } else {
    renderMismatchNote('Histograms, dotplots, boxplots, and density curves work well for a single quantitative variable.');
    return;
  }

  renderNumericStats(v.label, values);
}

// ── One categorical variable ─────────────────────────────────────────

/** @param {VarInfo} v */
function renderOneCategorical(v) {
  const values = getCategoricalColumn(v.name);
  if (values.length === 0) return;

  if (activeChart === 'bar') {
    drawBarChart(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart', animate: false,
      mode: relativeFreq ? 'relative' : 'frequency',
      margin: { top: 30, right: 15, bottom: 80, left: 55 },
    });
  } else if (activeChart === 'pie') {
    drawPieChart(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart',
    });
  } else if (activeChart === 'waffle') {
    drawWaffleChart(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart',
    });
  } else {
    renderMismatchNote('Bar charts, pie charts, and waffle charts work well for a single categorical variable.');
    return;
  }

  renderCategoricalStats(v.label, values);
}

// ── Two numeric variables ────────────────────────────────────────────

/**
 * @param {VarInfo} v1
 * @param {VarInfo} v2
 */
function renderTwoNumeric(v1, v2) {
  const x = getNumericColumn(v1.name);
  const y = getNumericColumn(v2.name);
  const n = Math.min(x.length, y.length);
  if (n < 2) return;

  const xn = x.slice(0, n);
  const yn = y.slice(0, n);

  if (activeChart === 'scatterplot') {
    const reg = linreg(xn, yn);
    const scatterOpts = {
      xLabel: v1.label, yLabel: v2.label,
      titleText: `${v1.label} vs ${v2.label}`,
      id: 'explorer-chart',
      regression: showRegLine ? { slope: reg.slope, intercept: reg.intercept } : undefined,
      loessCurve: showLoess ? loess(xn, yn) : undefined,
    };
    drawScatterplot(chartContainer, xn, yn, scatterOpts);

    // Residual plot
    if (showResiduals && chartContainer) {
      const resContainer = document.createElement('div');
      resContainer.id = 'residual-container';
      chartContainer.appendChild(resContainer);
      const fitted = xn.map(xi => reg.intercept + reg.slope * xi);
      const residuals = yn.map((yi, i) => yi - fitted[i]);
      drawResidualPlot(resContainer, fitted, residuals, {
        id: 'explorer-residuals',
        xLabel: 'Fitted values',
        yLabel: 'Residuals',
        titleText: 'Residual Plot',
      });
    }
  } else {
    renderMismatchNote('Scatterplots work well for two quantitative variables.');
    return;
  }

  renderRegressionStats(v1.label, v2.label, xn, yn);
}

// ── Numeric × Categorical ────────────────────────────────────────────

/**
 * @param {VarInfo} numVar
 * @param {VarInfo} catVar
 */
function renderNumericByCategorical(numVar, catVar) {
  const numValues = getNumericColumn(numVar.name);
  const catValues = getCategoricalColumn(catVar.name);
  const n = Math.min(numValues.length, catValues.length);

  /** @type {Record<string, number[]>} */
  const grouped = {};
  for (let i = 0; i < n; i++) {
    if (!isFinite(numValues[i])) continue;
    const group = catValues[i];
    if (!grouped[group]) grouped[group] = [];
    grouped[group].push(numValues[i]);
  }

  const groupNames = Object.keys(grouped);
  if (groupNames.length === 0) return;

  const colors = getColors(groupNames.length);

  if (activeChart === 'boxplot') {
    drawBoxplot(chartContainer, grouped, {
      xLabel: numVar.label, titleText: `${numVar.label} by ${catVar.label}`,
      id: 'explorer-chart', animate: false, showOutliers, showMean,
    });
  } else if (activeChart === 'histogram') {
    if (chartContainer) {
      renderStackedHistograms(chartContainer, grouped, {
        xLabel: numVar.label,
        numBins: histBins ?? sturgesBins(n),
        relativeFrequency: relativeFreq,
        showMean: showMean,
        colors,
        idPrefix: 'explorer-chart',
      });
    }
  } else if (activeChart === 'dotplot') {
    if (chartContainer) {
      renderStackedDotplots(chartContainer, grouped, {
        xLabel: numVar.label,
        numBins: dotBins ?? undefined,
        showMean: showMean,
        colors,
        idPrefix: 'explorer-chart',
      });
    }
  } else if (activeChart === 'density') {
    drawGroupedDensity(chartContainer, grouped, {
      xLabel: numVar.label,
      titleText: `${numVar.label} by ${catVar.label}`,
      id: 'explorer-chart',
      colors,
    });
  } else {
    renderMismatchNote('Boxplots, histograms, dotplots, and density curves work well for comparing a quantitative variable across groups.');
    return;
  }

  renderGroupedStats(numVar.label, catVar.label, grouped);
}

// ── Two categorical variables ────────────────────────────────────────

/**
 * @param {VarInfo} v1
 * @param {VarInfo} v2
 */
function renderTwoCategorical(v1, v2) {
  const col1 = getCategoricalColumn(v1.name);
  const col2 = getCategoricalColumn(v2.name);
  const n = Math.min(col1.length, col2.length);

  /** @type {Map<string, Map<string, number>>} row → col → count */
  const table = new Map();
  const rowLevels = /** @type {string[]} */ ([]);
  const colLevels = /** @type {string[]} */ ([]);

  for (let i = 0; i < n; i++) {
    const r = col1[i];
    const c = col2[i];
    if (!rowLevels.includes(r)) rowLevels.push(r);
    if (!colLevels.includes(c)) colLevels.push(c);
    if (!table.has(r)) table.set(r, new Map());
    const rowMap = /** @type {Map<string, number>} */ (table.get(r));
    rowMap.set(c, (rowMap.get(c) ?? 0) + 1);
  }

  if (activeChart === 'bar') {
    drawBarChart(chartContainer, col1, {
      xLabel: v1.label, titleText: `${v1.label} by ${v2.label}`,
      id: 'explorer-chart', animate: false, mode: barMode,
      groupValues: col2, groupLabel: v2.label,
      margin: { top: 30, right: 15, bottom: 80, left: 55 },
    });
  } else {
    renderMismatchNote('Bar charts work well for two categorical variables.');
  }

  // Always show contingency table for two categorical (even on mismatch)
  renderContingencyTable(v1.label, v2.label, rowLevels, colLevels, table, n);
}

// ── Table export helpers ─────────────────────────────────────────────

function addTableActions() {
  if (!statsContainer) return;
  const tables = statsContainer.querySelectorAll('table');
  if (tables.length === 0) return;

  const table = /** @type {HTMLTableElement} */ (tables[tables.length - 1]);
  wrapTable(table);
}

// ── Stats rendering ──────────────────────────────────────────────────

/**
 * @param {string} label
 * @param {number[]} values
 */
function renderNumericStats(label, values) {
  if (!statsContainer) return;
  buildNumericStatsTable(statsContainer, label, values);
}

/**
 * @param {string} label
 * @param {string[]} values
 */
function renderCategoricalStats(label, values) {
  if (!statsContainer) return;
  const total = values.length;

  /** @type {Map<string, number>} */
  const counts = new Map();
  const cats = /** @type {string[]} */ ([]);
  for (const v of values) {
    counts.set(v, (counts.get(v) ?? 0) + 1);
    if (!cats.includes(v)) cats.push(v);
  }

  let html = `<table class="freq-table" aria-label="Frequency table for ${label}">`;
  html += `<thead><tr><th>${label}</th><th>Count</th><th>Proportion</th></tr></thead><tbody>`;
  for (const cat of cats) {
    const count = counts.get(cat) ?? 0;
    html += `<tr><td>${cat}</td><td>${count}</td><td>${formatStat(count / total, 0, 'proportion')}</td></tr>`;
  }
  html += `</tbody>`;
  html += `<tfoot><tr><td><strong>Total</strong></td><td><strong>${total}</strong></td><td><strong>${formatStat(1, 0, 'proportion')}</strong></td></tr></tfoot>`;
  html += `</table>`;

  statsContainer.innerHTML = html;
}

/**
 * @param {string} xLabel
 * @param {string} yLabel
 * @param {number[]} x
 * @param {number[]} y
 */
function renderRegressionStats(xLabel, yLabel, x, y) {
  if (!statsContainer) return;
  const reg = linreg(x, y);
  const r = cor(x, y);

  statsContainer.innerHTML = `
    <table aria-label="Regression statistics">
      <thead><tr><th>Statistic</th><th>Value</th></tr></thead>
      <tbody>
        <tr><td>n</td><td>${x.length}</td></tr>
        <tr><td>Correlation (r)</td><td>${formatStat(r, 4)}</td></tr>
        <tr><td>R&sup2;</td><td>${formatStat(r * r, 4)}</td></tr>
        <tr><td>Slope</td><td>${formatStat(reg.slope, 4)}</td></tr>
        <tr><td>Intercept</td><td>${formatStat(reg.intercept, 4)}</td></tr>
      </tbody>
    </table>`;
}

/**
 * @param {string} numLabel
 * @param {string} catLabel
 * @param {Record<string, number[]>} grouped
 */
function renderGroupedStats(numLabel, catLabel, grouped) {
  if (!statsContainer) return;
  statsContainer.innerHTML = '';
  buildGroupedStatsTable(statsContainer, grouped, {
    numLabel,
    catLabel,
  });
}

/**
 * @param {string} rowLabel
 * @param {string} colLabel
 * @param {string[]} rowLevels
 * @param {string[]} colLevels
 * @param {Map<string, Map<string, number>>} table
 * @param {number} total
 */
function renderContingencyTable(rowLabel, colLabel, rowLevels, colLevels, table, total) {
  if (!statsContainer) return;

  // Compute row and column totals
  /** @type {Map<string, number>} */
  const rowTotals = new Map();
  /** @type {Map<string, number>} */
  const colTotals = new Map();
  for (const r of rowLevels) {
    let rt = 0;
    for (const c of colLevels) {
      const count = table.get(r)?.get(c) ?? 0;
      rt += count;
      colTotals.set(c, (colTotals.get(c) ?? 0) + count);
    }
    rowTotals.set(r, rt);
  }

  /**
   * Format a cell value based on tableMode.
   * @param {number} count
   * @param {number} rowTotal
   * @param {number} colTotal
   * @returns {string}
   */
  function fmtCell(count, rowTotal, colTotal) {
    if (tableMode === 'counts') return String(count);
    if (tableMode === 'row') return rowTotal > 0 ? formatStat(count / rowTotal, 0, 'proportion') : '0';
    if (tableMode === 'col') return colTotal > 0 ? formatStat(count / colTotal, 0, 'proportion') : '0';
    // cell proportion
    return total > 0 ? formatStat(count / total, 0, 'proportion') : '0';
  }

  const modeLabels = { counts: '', row: ' (Row %)', col: ' (Column %)', cell: ' (Cell %)' };
  const modeSuffix = modeLabels[tableMode] || '';

  let html = `<table class="freq-table" aria-label="Contingency table: ${rowLabel} × ${colLabel}${modeSuffix}">`;
  html += `<thead><tr><th>${rowLabel} \\ ${colLabel}</th>`;
  for (const c of colLevels) html += `<th>${c}</th>`;
  html += `<th>Total</th></tr></thead><tbody>`;

  for (const r of rowLevels) {
    html += `<tr><td><strong>${r}</strong></td>`;
    const rowTotal = rowTotals.get(r) ?? 0;
    for (const c of colLevels) {
      const count = table.get(r)?.get(c) ?? 0;
      const colTotal = colTotals.get(c) ?? 0;
      html += `<td>${fmtCell(count, rowTotal, colTotal)}</td>`;
    }
    // Row total
    if (tableMode === 'counts') {
      html += `<td>${rowTotal}</td>`;
    } else if (tableMode === 'row') {
      html += `<td>${formatStat(1, 0, 'proportion')}</td>`;
    } else if (tableMode === 'col') {
      html += `<td>${total > 0 ? formatStat(rowTotal / total, 0, 'proportion') : '0'}</td>`;
    } else {
      html += `<td>${total > 0 ? formatStat(rowTotal / total, 0, 'proportion') : '0'}</td>`;
    }
    html += `</tr>`;
  }

  // Column totals row
  html += `<tr><td><strong>Total</strong></td>`;
  for (const c of colLevels) {
    const colTotal = colTotals.get(c) ?? 0;
    if (tableMode === 'counts') {
      html += `<td><strong>${colTotal}</strong></td>`;
    } else if (tableMode === 'row') {
      html += `<td><strong>${total > 0 ? formatStat(colTotal / total, 0, 'proportion') : '0'}</strong></td>`;
    } else if (tableMode === 'col') {
      html += `<td><strong>${formatStat(1, 0, 'proportion')}</strong></td>`;
    } else {
      html += `<td><strong>${total > 0 ? formatStat(colTotal / total, 0, 'proportion') : '0'}</strong></td>`;
    }
  }
  if (tableMode === 'counts') {
    html += `<td><strong>${total}</strong></td>`;
  } else {
    html += `<td><strong>${formatStat(1, 0, 'proportion')}</strong></td>`;
  }
  html += `</tr></tbody></table>`;

  statsContainer.innerHTML += html;
}

/**
 * Show a guidance message when chart type doesn't match variable selection.
 * @param {string} suggestion
 */
function renderMismatchNote(suggestion) {
  if (!chartContainer) return;
  const note = document.createElement('div');
  note.className = 'empty-state';
  note.style.cssText = 'flex-direction:column;gap:0.5rem;';
  const icon = document.createElement('span');
  icon.style.cssText = 'font-size:1.5rem;opacity:0.5;';
  icon.textContent = '\u2139';
  icon.setAttribute('aria-hidden', 'true');
  note.appendChild(icon);
  const text = document.createElement('span');
  text.textContent = `This chart type doesn\u2019t match your variable selection. ${suggestion}`;
  note.appendChild(text);
  chartContainer.appendChild(note);
}
