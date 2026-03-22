// @ts-check
/**
 * Data Explorer — multi-variable exploration workspace.
 * Loads a dataset, shows all variables with type badges, lets students
 * select 1-2 variables and choose any chart type. Pure discovery mode:
 * all chart types always available, wrong choices produce unhelpful output.
 */

import { drawHistogram, computeBins, sturgesBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { drawBarChart } from '../../js/barchart.js';
import { drawPieChart } from '../../js/pie.js';
import { drawWaffleChart } from '../../js/waffle.js';
import { drawScatterplot } from '../../js/scatterplot.js';
import { drawGroupedDensity } from '../../js/kde.js';
import { mean, median, sd, quantile, iqr, range, cor, linreg, detectPrecision, formatStat } from '../../js/stats.js';
import { addChartSaveButton, copyTableRich } from '../../js/export.js';
import { announce, initTabs, initDataPanel, initHelp, setPageTitle } from '../../js/page-utils.js';

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
    announce('Data cleared.');
  },
});

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
    // Deselect
    selected.splice(idx, 1);
  } else if (selected.length < 2) {
    // Select
    selected.push(name);
  } else {
    // Already 2 selected — replace the second
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

  // Show swap button only when 2 variables are selected
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
 * Extract a column of values from rows.
 * @param {string} name
 * @returns {any[]}
 */
function getColumn(name) {
  return rows.map(r => r[name]);
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
  if (emptyState && chartContainer) {
    chartContainer.appendChild(emptyState);
    emptyState.style.display = '';
  }
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

  // Show bar mode selector only for two-categorical + bar chart
  const showBarMode = catCount === 2 && selected.length === 2 && activeChart === 'bar';
  if (barModeSection) barModeSection.hidden = !showBarMode;

  try {
    if (selected.length === 1) {
      if (v1.type === 'numeric') {
        renderOneNumeric(v1);
      } else {
        renderOneCategorical(v1);
      }
    } else if (numCount === 2) {
      renderTwoNumeric(v1, /** @type {VarInfo} */ (v2));
    } else if (numCount === 1 && catCount === 1) {
      // Put numeric first, categorical second for consistency
      const numVar = v1.type === 'numeric' ? v1 : /** @type {VarInfo} */ (v2);
      const catVar = v1.type === 'categorical' ? v1 : /** @type {VarInfo} */ (v2);
      renderNumericByCategorical(numVar, catVar);
    } else if (catCount === 2) {
      renderTwoCategorical(v1, /** @type {VarInfo} */ (v2));
    }
  } catch (e) {
    if (chartContainer) {
      chartContainer.innerHTML = `<div class="empty-state">Cannot render this chart for the selected variables.</div>`;
    }
  }

  // Save + Copy buttons for chart
  if (chartContainer && chartContainer.querySelector('svg')) {
    const safeName = selected.map(s => s.replace(/\s+/g, '_')).join('_vs_');
    addChartSaveButton(chartContainer, `${safeName}_${activeChart}.png`, { showCopy: true });
  }

  // Table copy/download buttons
  addTableActions();
}

// ── One numeric variable ─────────────────────────────────────────────

/** @param {VarInfo} v */
function renderOneNumeric(v) {
  const values = getNumericColumn(v.name);
  if (values.length === 0) return;

  if (activeChart === 'histogram') {
    drawHistogram(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart', animate: false,
    });
  } else if (activeChart === 'dotplot') {
    drawDotplot(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart', animate: false,
    });
  } else if (activeChart === 'boxplot') {
    drawBoxplot(chartContainer, values, {
      xLabel: v.label, titleText: v.label, id: 'explorer-chart', animate: false,
    });
  } else {
    renderMismatchNote('Histograms, dotplots, and boxplots work well for a single quantitative variable.');
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

  if (activeChart === 'scatterplot') {
    const reg = linreg(x.slice(0, n), y.slice(0, n));
    drawScatterplot(chartContainer, x.slice(0, n), y.slice(0, n), {
      xLabel: v1.label, yLabel: v2.label,
      titleText: `${v1.label} vs ${v2.label}`,
      id: 'explorer-chart',
      regression: { slope: reg.slope, intercept: reg.intercept },
    });
  } else {
    renderMismatchNote('Scatterplots work well for two quantitative variables.');
    return;
  }

  renderRegressionStats(v1.label, v2.label, x.slice(0, n), y.slice(0, n));
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

  // Build grouped data
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

  if (activeChart === 'boxplot') {
    drawBoxplot(chartContainer, grouped, {
      xLabel: numVar.label, titleText: `${numVar.label} by ${catVar.label}`,
      id: 'explorer-chart', animate: false,
    });
  } else if (activeChart === 'histogram') {
    // Draw histograms for each group stacked vertically
    for (const name of groupNames) {
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '0.5rem';
      if (chartContainer) chartContainer.appendChild(wrapper);
      drawHistogram(wrapper, grouped[name], {
        xLabel: numVar.label, titleText: `${name} (n=${grouped[name].length})`,
        id: `explorer-chart-${name}`, animate: false,
      });
    }
  } else if (activeChart === 'dotplot') {
    for (const name of groupNames) {
      const wrapper = document.createElement('div');
      wrapper.style.marginBottom = '0.5rem';
      if (chartContainer) chartContainer.appendChild(wrapper);
      drawDotplot(wrapper, grouped[name], {
        xLabel: numVar.label, titleText: `${name} (n=${grouped[name].length})`,
        id: `explorer-chart-${name}`, animate: false,
      });
    }
  } else if (activeChart === 'density') {
    drawGroupedDensity(chartContainer, grouped, {
      xLabel: numVar.label,
      titleText: `${numVar.label} by ${catVar.label}`,
      id: 'explorer-chart',
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

  // Build contingency table
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
    // Grouped bar chart — use v2 as grouping, barMode controls layout
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

/**
 * Add a "Copy" button below the stats table(s).
 * Copies as rich HTML (formatted table in Word/Docs) with plain-text fallback.
 */
function addTableActions() {
  if (!statsContainer) return;
  const tables = statsContainer.querySelectorAll('table');
  if (tables.length === 0) return;

  const bar = document.createElement('div');
  bar.className = 'table-actions';

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy table';
  copyBtn.title = 'Copy to clipboard — pastes as a formatted table in Word or Google Docs';
  copyBtn.addEventListener('click', async () => {
    // Copy the last table (main stats), or first if only one
    const table = /** @type {HTMLTableElement} */ (tables[tables.length - 1]);
    const ok = await copyTableRich(table);
    copyBtn.textContent = ok ? 'Copied!' : 'Copy failed';
    setTimeout(() => { copyBtn.textContent = 'Copy table'; }, 1500);
  });

  bar.appendChild(copyBtn);
  statsContainer.appendChild(bar);
}

// ── Stats rendering ──────────────────────────────────────────────────

/**
 * @param {string} label
 * @param {number[]} values
 */
function renderNumericStats(label, values) {
  if (!statsContainer) return;
  const n = values.length;
  const dp = detectPrecision(values);

  statsContainer.innerHTML = `
    <table aria-label="Summary statistics for ${label}">
      <thead><tr>
        <th>Statistic</th><th>Value</th>
      </tr></thead>
      <tbody>
        <tr><td>n</td><td>${n}</td></tr>
        <tr><td>Mean</td><td>${formatStat(mean(values), dp)}</td></tr>
        <tr><td>Median</td><td>${formatStat(median(values), dp)}</td></tr>
        <tr><td>SD</td><td>${formatStat(sd(values), dp)}</td></tr>
        <tr><td>IQR</td><td>${formatStat(iqr(values), dp)}</td></tr>
        <tr><td>Min</td><td>${formatStat(Math.min(...values), dp)}</td></tr>
        <tr><td>Q1</td><td>${formatStat(quantile(values, 0.25), dp)}</td></tr>
        <tr><td>Q3</td><td>${formatStat(quantile(values, 0.75), dp)}</td></tr>
        <tr><td>Max</td><td>${formatStat(Math.max(...values), dp)}</td></tr>
      </tbody>
    </table>`;
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
  const groups = Object.keys(grouped);

  let html = `<table aria-label="Group statistics for ${numLabel} by ${catLabel}">`;
  html += `<thead><tr><th>${catLabel}</th><th>n</th><th>Mean</th><th>Median</th><th>SD</th><th>IQR</th></tr></thead><tbody>`;
  for (const g of groups) {
    const vals = grouped[g];
    const dp = detectPrecision(vals);
    html += `<tr>`;
    html += `<td>${g}</td>`;
    html += `<td>${vals.length}</td>`;
    html += `<td>${formatStat(mean(vals), dp)}</td>`;
    html += `<td>${formatStat(median(vals), dp)}</td>`;
    html += `<td>${formatStat(sd(vals), dp)}</td>`;
    html += `<td>${formatStat(iqr(vals), dp)}</td>`;
    html += `</tr>`;
  }
  html += `</tbody></table>`;

  statsContainer.innerHTML = html;
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

  let html = `<table class="freq-table" aria-label="Contingency table: ${rowLabel} × ${colLabel}">`;
  html += `<thead><tr><th>${rowLabel} \\ ${colLabel}</th>`;
  for (const c of colLevels) html += `<th>${c}</th>`;
  html += `<th>Total</th></tr></thead><tbody>`;

  for (const r of rowLevels) {
    html += `<tr><td><strong>${r}</strong></td>`;
    let rowTotal = 0;
    for (const c of colLevels) {
      const count = table.get(r)?.get(c) ?? 0;
      rowTotal += count;
      html += `<td>${count}</td>`;
    }
    html += `<td>${rowTotal}</td></tr>`;
  }

  // Column totals
  html += `<tr><td><strong>Total</strong></td>`;
  for (const c of colLevels) {
    let colTotal = 0;
    for (const r of rowLevels) colTotal += table.get(r)?.get(c) ?? 0;
    html += `<td><strong>${colTotal}</strong></td>`;
  }
  html += `<td><strong>${total}</strong></td></tr>`;
  html += `</tbody></table>`;

  statsContainer.innerHTML += html;
}

/**
 * Show a guidance message when chart type doesn't match variable selection.
 * No fallback chart is rendered — only the message.
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
