// @ts-check
/**
 * Chi-Square Randomization Test page.
 * Shuffles group labels to build a null distribution of χ².
 * Always right-tailed (χ² ≥ 0).
 */

import { createRng, shuffle } from '../../js/prng.js';
import { chisqStat } from '../../js/stats.js';
import { drawHistogram, computeBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import * as d3Select from 'd3-selection';
import { announce, initTabs, initKeyboardShortcuts, initPlayPause, flashMechanism, loadDatasetIndex, fetchDataset, computeHighlights, setupFileInput } from '../../js/page-utils.js';

// ─── DOM elements ───

const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const mechanismStrip = document.getElementById('mechanism-strip');
const mechObservedTable = document.getElementById('mech-observed-table');
const mechShuffledTable = document.getElementById('mech-shuffled-table');
const mechObservedChisq = document.getElementById('mech-observed-chisq');
const mechShuffledChisq = document.getElementById('mech-shuffled-chisq');
const mechanismDescEl = document.getElementById('mechanism-description');
const simTitleEl = document.getElementById('sim-title');

const pasteArea = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-area'));
const loadPastedBtn = document.getElementById('load-pasted');
const clearBtn = document.getElementById('clear-btn');
const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const datasetDesc = document.getElementById('dataset-desc');

const tableRowsInput = /** @type {HTMLInputElement} */ (document.getElementById('table-rows'));
const tableColsInput = /** @type {HTMLInputElement} */ (document.getElementById('table-cols'));
const buildTableBtn = document.getElementById('build-table');
const tableGrid = document.getElementById('table-grid');
const loadTableBtn = document.getElementById('load-table');

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

initTabs();
initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── State ───

/** @type {{population?:string, parameter?:string, nullClaim?:string}} */
let datasetContext = {};
/** @type {number[]} */
let allStats = [];
/** @type {(() => number)|null} */
let rng = null;
let seed = Math.random().toString(36).slice(2, 10);

/** @type {string[]} */
let rowLabels = [];
/** @type {string[]} */
let colLabels = [];
/** @type {number[][]} */
let observedTable = [];
let observedChisq = 0;
let totalN = 0;

/** @type {Array<{group: string, outcome: string}>} */
let rawData = [];

// ─── Data loading: Paste ───

if (loadPastedBtn && pasteArea) {
  loadPastedBtn.addEventListener('click', () => {
    const text = pasteArea.value.trim();
    if (!text) return;
    datasetContext = {};
    loadFromCSV(text);
  });
}

const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
if (fileInput) {
  setupFileInput(fileInput, (text) => {
    datasetContext = {};
    loadFromCSV(text);
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    rawData = [];
    observedTable = [];
    resetSimulation();
    if (pasteArea) pasteArea.value = '';
    if (dataPreview) dataPreview.hidden = true;
    if (dataSummary) dataSummary.textContent = '\u2014';
    for (const btn of genBtns) btn.disabled = true;
    if (mechanismStrip) mechanismStrip.hidden = true;
    announce('Data cleared.');
  });
}

/** @param {string} text */
function loadFromCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) {
    announce('Need a header row and at least one data row.');
    return;
  }
  const delim = lines[0].includes('\t') ? '\t' : ',';
  const header = lines[0].split(delim).map(s => s.trim());
  if (header.length < 2) {
    announce('Need at least two columns.');
    return;
  }
  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delim).map(s => s.trim());
    if (parts.length >= 2 && parts[0] && parts[1]) {
      data.push({ group: parts[0], outcome: parts[1] });
    }
  }
  if (data.length === 0) {
    announce('No valid data rows found.');
    return;
  }
  rawData = data;
  buildTableFromRaw();
  showDataLoaded();
}

function buildTableFromRaw() {
  rowLabels = [...new Set(rawData.map(d => d.group))];
  colLabels = [...new Set(rawData.map(d => d.outcome))];
  observedTable = rowLabels.map(g =>
    colLabels.map(o => rawData.filter(d => d.group === g && d.outcome === o).length)
  );
  totalN = rawData.length;
  observedChisq = chisqStat(observedTable);
}

// ─── Data loading: Manual table ───

if (buildTableBtn && tableGrid) {
  buildTableBtn.addEventListener('click', () => {
    const nRows = parseInt(tableRowsInput?.value ?? '2', 10);
    const nCols = parseInt(tableColsInput?.value ?? '2', 10);
    if (nRows < 2 || nCols < 2 || nRows > 6 || nCols > 6) return;

    let html = '<table class="contingency-input"><thead><tr><th></th>';
    for (let j = 0; j < nCols; j++) {
      html += `<th><input type="text" class="col-label" value="Outcome ${j + 1}" size="8"></th>`;
    }
    html += '</tr></thead><tbody>';
    for (let i = 0; i < nRows; i++) {
      html += `<tr><td><input type="text" class="row-label" value="Group ${i + 1}" size="8"></td>`;
      for (let j = 0; j < nCols; j++) {
        html += `<td><input type="number" class="cell-count" value="0" min="0" size="4"></td>`;
      }
      html += '</tr>';
    }
    html += '</tbody></table>';
    tableGrid.innerHTML = html;
  });
}

if (loadTableBtn && tableGrid) {
  loadTableBtn.addEventListener('click', () => {
    datasetContext = {};
    const rlInputs = tableGrid.querySelectorAll('.row-label');
    const clInputs = tableGrid.querySelectorAll('.col-label');
    const cellInputs = tableGrid.querySelectorAll('.cell-count');

    rowLabels = Array.from(rlInputs).map(el => /** @type {HTMLInputElement} */ (el).value.trim() || 'Group');
    colLabels = Array.from(clInputs).map(el => /** @type {HTMLInputElement} */ (el).value.trim() || 'Outcome');

    const nCols = colLabels.length;
    observedTable = [];
    let idx = 0;
    for (let i = 0; i < rowLabels.length; i++) {
      const row = [];
      for (let j = 0; j < nCols; j++) {
        row.push(Math.max(0, parseInt(/** @type {HTMLInputElement} */ (cellInputs[idx]).value, 10) || 0));
        idx++;
      }
      observedTable.push(row);
    }

    rawData = [];
    for (let i = 0; i < rowLabels.length; i++) {
      for (let j = 0; j < colLabels.length; j++) {
        for (let k = 0; k < observedTable[i][j]; k++) {
          rawData.push({ group: rowLabels[i], outcome: colLabels[j] });
        }
      }
    }

    totalN = rawData.length;
    if (totalN === 0) {
      announce('Table is empty. Enter counts.');
      return;
    }
    observedChisq = chisqStat(observedTable);
    showDataLoaded();
  });
}

// ─── Data loading: Datasets ───

/** @type {Array<{id:string,name:string,description:string,type:string}>} */
let datasetIndex = [];

if (datasetSelect) {
  loadDatasetIndex(datasetSelect, ds => ds.type === 'chisq', datasetDesc)
    .then(index => { datasetIndex = index; });

  datasetSelect.addEventListener('change', () => {
    const id = datasetSelect.value;
    if (!id) return;
    const meta = datasetIndex.find(d => d.id === id);
    if (meta && datasetDesc) datasetDesc.textContent = meta.description;

    fetchDataset(id)
      .then(ds => {
        resetSimulation();
        datasetContext = ds.context || {};
        const catVars = ds.variables.filter(v => v.type === 'categorical');
        if (catVars.length < 2) return;
        rawData = ds.rows.map(r => ({
          group: r[catVars[0].name],
          outcome: r[catVars[1].name],
        }));
        buildTableFromRaw();
        showDataLoaded();
        announce(`${ds.name}.`);
      })
      .catch(() => announce('Failed to load dataset.'));
  });
}

// ─── Show data ───

function showDataLoaded() {
  resetSimulation();
  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) {
    const dims = `${rowLabels.length} × ${colLabels.length}`;
    dataSummary.textContent = `${dims} table, n = ${totalN}, observed χ² = ${observedChisq.toFixed(4)}`;
  }
  for (const btn of genBtns) btn.disabled = false;
  if (resultDiv) resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  if (mechanismStrip && mechObservedTable) {
    mechanismStrip.hidden = false;
    mechObservedTable.innerHTML = renderTableHTML(observedTable, rowLabels, colLabels);
    if (mechObservedChisq) mechObservedChisq.textContent = observedChisq.toFixed(4);
  }
  announce(`Data loaded: ${rowLabels.length} × ${colLabels.length} table, n = ${totalN}`);

  // Scroll controls into view after DOM settles
  setTimeout(() => {
    const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

/**
 * @param {number[][]} table
 * @param {string[]} rows
 * @param {string[]} cols
 * @returns {string}
 */
function renderTableHTML(table, rows, cols) {
  let html = '<table class="contingency-table"><thead><tr><th></th>';
  for (const c of cols) html += `<th>${c}</th>`;
  html += '</tr></thead><tbody>';
  for (let i = 0; i < rows.length; i++) {
    html += `<tr><th>${rows[i]}</th>`;
    for (let j = 0; j < cols.length; j++) {
      html += `<td>${table[i][j]}</td>`;
    }
    html += '</tr>';
  }
  html += '</tbody></table>';
  return html;
}

// ─── Generate ───

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.count, 10);
    if (totalN === 0) {
      announce('Please load data first.');
      return;
    }
    generateSimulations(count);
  });
}

/** @param {number} count */
function generateSimulations(count) {
  if (!rng) rng = createRng(seed);
  const prevLength = allStats.length;

  if (simTitleEl) {
    simTitleEl.textContent = count === 1 ? 'This Shuffle' : 'Last Shuffle';
  }

  const outcomes = rawData.map(d => d.outcome);
  const groups = rawData.map(d => d.group);

  /** @type {number[][]} */
  let lastShuffledTable = [];
  let lastChisq = 0;

  for (let i = 0; i < count; i++) {
    const shuffled = shuffle([...groups], rng);
    const table = rowLabels.map(g =>
      colLabels.map(o => {
        let ct = 0;
        for (let k = 0; k < shuffled.length; k++) {
          if (shuffled[k] === g && outcomes[k] === o) ct++;
        }
        return ct;
      })
    );
    const chi2 = chisqStat(table);
    allStats.push(chi2);
    lastShuffledTable = table;
    lastChisq = chi2;
  }

  if (mechShuffledTable && mechShuffledChisq) {
    mechShuffledTable.innerHTML = renderTableHTML(lastShuffledTable, rowLabels, colLabels);
    mechShuffledChisq.textContent = lastChisq.toFixed(4);
  }
  if (mechanismDescEl) {
    mechanismDescEl.textContent = 'Shuffle group labels, keeping outcomes fixed';
    mechanismDescEl.hidden = false;
  }

  const csHi = Math.max(...allStats, observedChisq) * 1.05 || 1;
  /** @type {[number,number]} */
  const hlDomain = [0, csHi];

  // Pre-compute bins to lock in bin edges for both computeHighlights and drawHistogram
  const { bins: fullBins } = computeBins(allStats, { domain: hlDomain });
  const lockedThresholds = fullBins.slice(1).map(b => b.x0);

  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    allStats, prevLength, count, computeBins, { domain: hlDomain, thresholds: lockedThresholds });
  const { pValue, extremeCount } = computePValue(allStats, observedChisq);
  displayResults(allStats, observedChisq, pValue, extremeCount);

  if (count === 1) {
    setTimeout(() => {
      flashMechanism(mechanismStrip);
      setTimeout(() => {
        renderChart(allStats, observedChisq, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
      }, 120);
    }, 120);
  } else {
    renderChart(allStats, observedChisq, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
  }

  if (resetBtn) resetBtn.hidden = false;
  announce(`Generated ${count} shuffle${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
}

// ─── Chart ───

/**
 * @param {number[]} stats
 * @param {number} observed
 * @param {number} [highlightIndex]
 * @param {Set<number>} [highlightIndices]
 * @param {number[]} [prevBinCounts]
 * @param {[number,number]} [hlDomain]
 * @param {number[]} [hlThresholds]
 */
function renderChart(stats, observed, highlightIndex = -1, highlightIndices, prevBinCounts, hlDomain, hlThresholds) {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';

  const hi = Math.max(...stats, observed) * 1.05 || 1;
  /** @type {[number, number]} */
  const domain = hlDomain || [0, hi];

  /** @type {import('../../js/chart-utils.js').ChartFrame} */
  let frame;
  /** @type {any} */
  let xScale;
  if (stats.length <= 200) {
    const r = drawDotplot(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Chi-Square Statistic (χ²)',
      titleText: 'Null Distribution',
      isExtreme: (v) => v >= observed,
      observedStat: observed,
      animate: false,
      domain,
      highlightIndex,
      highlightIndices,
    });
    frame = r.frame;
    xScale = r.xScale;
  } else {
    const r = drawHistogram(chartContainer, stats, {
      id: 'sim-chart',
      xLabel: 'Chi-Square Statistic (χ²)',
      titleText: 'Null Distribution',
      isTail: (v) => v >= observed,
      observedStat: observed,
      animate: false,
      domain,
      thresholds: hlThresholds,
      prevBinCounts,
    });
    frame = r.frame;
    xScale = r.xScale;
  }

  // P-value pills (always right-tailed)
  if (stats.length > 0) {
    const { pValue } = computePValue(stats, observed);
    renderPValuePills(frame, xScale, pValue, observed);
  }
}

/**
 * Render p-value pills (right-tail only for chi-square).
 * @param {import('../../js/chart-utils.js').ChartFrame} frame
 * @param {any} xScale
 * @param {number} pValue
 * @param {number} observed
 */
function renderPValuePills(frame, xScale, pValue, observed) {
  const annotations = d3Select.select(frame.inner).select('.annotations');
  const w = frame.width;
  const pillY = frame.height * 0.22;
  const obsX = xScale(observed);
  const comp = 1 - pValue;

  let pText;
  if (pValue === 0) pText = 'p ≈ 0';
  else if (pValue < 0.0001) pText = 'p < 0.0001';
  else pText = `p = ${pValue.toFixed(4)}`;

  // Right tail pill
  const tailX = Math.min(w - 50, Math.max(obsX + 10, (obsX + w) / 2));
  _pill(annotations, pText, tailX, pillY, false);
  // Body pill
  const bodyX = Math.max(50, Math.min(obsX - 10, obsX / 2));
  _pill(annotations, comp.toFixed(4), bodyX, pillY, true);
}

/** @param {any} g @param {string} text @param {number} cx @param {number} cy @param {boolean} isComp */
function _pill(g, text, cx, cy, isComp) {
  const group = g.append('g').attr('class', 'sim-pill');
  const tw = text.length * 8.5 + 16;
  const ph = 24;
  group.append('rect')
    .attr('x', cx - tw / 2).attr('y', cy - ph / 2)
    .attr('width', tw).attr('height', ph).attr('rx', 4)
    .attr('fill', isComp ? '#f5f5f5' : '#e8f4f8')
    .attr('stroke', isComp ? '#ccc' : '#569BBD')
    .attr('stroke-width', 1)
    .style('pointer-events', 'none');
  group.append('text')
    .attr('class', isComp ? 'prob-label prob-complement' : 'prob-label')
    .attr('x', cx).attr('y', cy)
    .attr('text-anchor', 'middle')
    .attr('dominant-baseline', 'central')
    .attr('fill', isComp ? '#6B6B6B' : '#114B5F')
    .style('pointer-events', 'none')
    .text(text);
}

/**
 * @param {number[]} stats
 * @param {number} observed
 */
function computePValue(stats, observed) {
  let extremeCount = 0;
  for (const s of stats) {
    if (s >= observed) extremeCount++;
  }
  return { pValue: extremeCount / stats.length, extremeCount };
}

/**
 * @param {number[]} stats
 * @param {number} observed
 * @param {number} pValue
 * @param {number} extremeCount
 */
function displayResults(stats, observed, pValue, extremeCount) {
  let strength;
  if (pValue < 0.01) strength = 'very strong';
  else if (pValue < 0.05) strength = 'strong';
  else if (pValue < 0.10) strength = 'moderate';
  else strength = 'little';

  if (resultDiv) {
    resultDiv.innerHTML = `
      <p><strong>Null Distribution</strong> (${stats.length} simulations)</p>
      <p>Observed χ² = ${observed.toFixed(4)}</p>
      <p>Extreme count: ${extremeCount} of ${stats.length} (right-tail)</p>
      <p><strong>p-value:</strong> ${pValue.toFixed(4)}</p>
      <p class="interpretation">${extremeCount} of ${stats.length} shuffled tables had χ² ≥ ${observed.toFixed(2)}. This provides ${strength} evidence against H₀: ${datasetContext.nullClaim || 'the row and column variables are independent'}.</p>
    `;
  }
}

// ─── Reset ───

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    resetSimulation();
    announce('Simulation reset.');
  });
}

function resetSimulation() {
  allStats = [];
  rng = null;
  seed = Math.random().toString(36).slice(2, 10);
  if (chartContainer) chartContainer.innerHTML = '';
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Load data and run a simulation to see results.</p>';
  if (resetBtn) resetBtn.hidden = true;
}
