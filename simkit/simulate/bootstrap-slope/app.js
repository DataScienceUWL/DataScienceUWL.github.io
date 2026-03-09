// @ts-check
/**
 * Bootstrap CI: Regression Slope page.
 * Resamples (x, y) pairs with replacement, refits regression,
 * records the slope. Showcase: bootstrap lines overlaid on scatterplot.
 */

import { createRng } from '../../js/prng.js';
import { linreg, mean } from '../../js/stats.js';
import { bootstrapCI } from '../../js/sim-engine.js';
import { drawScatterplot } from '../../js/scatterplot.js';
import { drawHistogram, computeBins } from '../../js/histogram.js';
import { drawDotplot } from '../../js/dotplot.js';
import { parseCSV } from '../../js/csv-parser.js';
import { announce, initTabs, initKeyboardShortcuts, loadDatasetIndex, fetchDataset, computeHighlights } from '../../js/page-utils.js';

// ─── DOM ───

const scatterContainer = document.getElementById('scatter-container');
const histContainer = document.getElementById('hist-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const ciSelect = /** @type {HTMLSelectElement} */ (document.getElementById('ci-level'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const pasteArea = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-area'));
const loadPastedBtn = document.getElementById('load-pasted');
const clearBtn = document.getElementById('clear-btn');
const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const datasetDesc = document.getElementById('dataset-desc');

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

initTabs();
initKeyboardShortcuts(genBtns, resetBtn);

// ─── State ───

/** @type {number[]} */
let xData = [];
/** @type {number[]} */
let yData = [];
let xLabel = 'x';
let yLabel = 'y';

/** @type {number[]} */
let allSlopes = [];
/** @type {Array<{slope: number, intercept: number}>} */
let bootLines = [];
/** @type {(() => number)|null} */
let rng = null;
let seed = Math.random().toString(36).slice(2, 10);

let observedSlope = 0;
let observedIntercept = 0;

// ─── Data loading ───

/** @type {Array<{id:string,name:string,description:string,type:string}>} */
let datasetIndex = [];

if (datasetSelect) {
  loadDatasetIndex(datasetSelect, ds => ds.type === 'regression', datasetDesc)
    .then(index => { datasetIndex = index; });

  datasetSelect.addEventListener('change', () => {
    const id = datasetSelect.value;
    if (!id) return;
    const meta = datasetIndex.find(d => d.id === id);
    if (meta && datasetDesc) datasetDesc.textContent = meta.description;

    fetchDataset(id)
      .then(ds => {
        resetSimulation();
        const numVars = ds.variables.filter(v => v.type === 'numeric');
        if (numVars.length < 2) return;
        xLabel = numVars[0].name;
        yLabel = numVars[1].name;
        xData = ds.rows.map(r => r[xLabel]).filter(v => isFinite(v));
        yData = ds.rows.map(r => r[yLabel]).filter(v => isFinite(v));
        const minLen = Math.min(xData.length, yData.length);
        xData = xData.slice(0, minLen);
        yData = yData.slice(0, minLen);
        showDataLoaded();
        announce(`Loaded dataset: ${ds.name}`);
      })
      .catch(() => announce('Failed to load dataset.'));
  });
}

if (loadPastedBtn && pasteArea) {
  loadPastedBtn.addEventListener('click', () => {
    const text = pasteArea.value.trim();
    if (!text) return;
    try {
      const parsed = parseCSV(text);
      const numIndices = parsed.types
        .map((t, i) => t === 'numeric' ? i : -1)
        .filter(i => i >= 0);
      if (numIndices.length >= 2) {
        xLabel = parsed.headers[numIndices[0]];
        yLabel = parsed.headers[numIndices[1]];
        xData = parsed.data.map(r => parseFloat(r[xLabel])).filter(v => isFinite(v));
        yData = parsed.data.map(r => parseFloat(r[yLabel])).filter(v => isFinite(v));
        const minLen = Math.min(xData.length, yData.length);
        xData = xData.slice(0, minLen);
        yData = yData.slice(0, minLen);
        resetSimulation();
        showDataLoaded();
      }
    } catch {
      announce('Could not parse data.');
    }
  });
}

if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    xData = [];
    yData = [];
    resetSimulation();
    if (pasteArea) pasteArea.value = '';
    if (dataPreview) dataPreview.hidden = true;
    if (dataSummary) dataSummary.textContent = '\u2014';
    for (const btn of genBtns) btn.disabled = true;
    announce('Data cleared.');
  });
}

function showDataLoaded() {
  if (xData.length < 3) {
    announce('Need at least 3 data points.');
    return;
  }
  const reg = linreg(xData, yData);
  observedSlope = reg.slope;
  observedIntercept = reg.intercept;

  if (dataPreview) dataPreview.hidden = false;
  if (dataSummary) {
    dataSummary.textContent =
      `n = ${xData.length}, slope = ${reg.slope.toFixed(4)}, r² = ${reg.r2.toFixed(4)}`;
  }
  for (const btn of genBtns) btn.disabled = false;
  if (resultDiv) resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  renderScatter();
  announce(`Data loaded: n = ${xData.length}`);
}

// ─── CI level change ───

if (ciSelect) {
  ciSelect.addEventListener('change', () => {
    if (allSlopes.length >= 10) {
      const ciLevel = parseInt(ciSelect.value, 10);
      const result = bootstrapCI([...allSlopes], ciLevel);
      displayResults(allSlopes, result.ci, result.se, ciLevel);
    }
  });
}

// ─── Generate ───

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.count, 10);
    if (xData.length === 0) {
      announce('Please load data first.');
      return;
    }
    generateResamples(count);
  });
}

/** @param {number} count */
function generateResamples(count) {
  if (!rng) rng = createRng(seed);
  const n = xData.length;
  const prevLength = allSlopes.length;

  for (let i = 0; i < count; i++) {
    /** @type {number[]} */
    const indices = [];
    for (let j = 0; j < n; j++) {
      indices.push(Math.floor(rng() * n));
    }
    const xBoot = indices.map(k => xData[k]);
    const yBoot = indices.map(k => yData[k]);
    const reg = linreg(xBoot, yBoot);
    allSlopes.push(reg.slope);
    bootLines.push({ slope: reg.slope, intercept: reg.intercept });
  }

  const ciLevel = parseInt(ciSelect?.value ?? '95', 10);
  if (allSlopes.length >= 10) {
    const result = bootstrapCI([...allSlopes], ciLevel);
    displayResults(allSlopes, result.ci, result.se, ciLevel);
  } else {
    if (resultDiv) {
      resultDiv.innerHTML = `<p><strong>Bootstrap Distribution</strong> (${allSlopes.length} resamples)</p>
        <p>Need at least 10 resamples for CI estimate.</p>`;
    }
  }

  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(allSlopes, prevLength, count, computeBins);

  renderScatter();
  renderHist(allSlopes, hlIndex, hlIndices, prevBinCounts);

  if (resetBtn) resetBtn.hidden = false;
  announce(`Generated ${count} resample${count > 1 ? 's' : ''}. Total: ${allSlopes.length}`);
}

// ─── Charts ───

function renderScatter() {
  if (!scatterContainer) return;
  scatterContainer.innerHTML = '';
  drawScatterplot(scatterContainer, xData, yData, {
    id: 'scatter',
    xLabel,
    yLabel,
    titleText: 'Data with Bootstrap Lines',
    regression: { slope: observedSlope, intercept: observedIntercept },
    bootstrapLines: bootLines,
  });
}

/**
 * @param {number[]} slopes
 * @param {number} [highlightIndex]
 * @param {Set<number>} [highlightIndices]
 * @param {number[]} [prevBinCounts]
 */
function renderHist(slopes, highlightIndex = -1, highlightIndices, prevBinCounts) {
  if (!histContainer) return;
  histContainer.innerHTML = '';
  const n = slopes.length;
  if (n === 0) return;

  if (n <= 200) {
    drawDotplot(histContainer, slopes, {
      id: 'slope-dist',
      xLabel: 'Bootstrap Slope',
      titleText: 'Bootstrap Distribution of Slope',
      observedStat: observedSlope,
      animate: false,
      highlightIndex,
      highlightIndices,
    });
  } else {
    drawHistogram(histContainer, slopes, {
      id: 'slope-dist',
      xLabel: 'Bootstrap Slope',
      titleText: 'Bootstrap Distribution of Slope',
      observedStat: observedSlope,
      animate: false,
      prevBinCounts,
    });
  }
}

/**
 * @param {number[]} slopes
 * @param {[number,number]} ci
 * @param {number} se
 * @param {number} ciLevel
 */
function displayResults(slopes, ci, se, ciLevel) {
  if (!resultDiv) return;
  resultDiv.innerHTML = `
    <p><strong>Bootstrap Distribution</strong> (${slopes.length} resamples)</p>
    <p>Observed slope: ${observedSlope.toFixed(4)}</p>
    <p>Bootstrap mean slope: ${mean(slopes).toFixed(4)}</p>
    <p>SE: ${se.toFixed(4)}</p>
    <p><strong>${ciLevel}% Confidence Interval:</strong> (${ci[0].toFixed(4)}, ${ci[1].toFixed(4)})</p>
    <p class="interpretation">We are ${ciLevel}% confident that the true population slope is between ${ci[0].toFixed(4)} and ${ci[1].toFixed(4)}. The ${bootLines.length} semi-transparent lines on the scatterplot show the variability in the fitted regression across bootstrap resamples.</p>
    ${slopes.length < 50 ? '<p class="hint">CI is approximate with few resamples. Generate more for stability.</p>' : ''}
  `;
}

// ─── Reset ───

if (resetBtn) {
  resetBtn.addEventListener('click', () => {
    resetSimulation();
    renderScatter();
    announce('Simulation reset.');
  });
}

function resetSimulation() {
  allSlopes = [];
  bootLines = [];
  rng = null;
  seed = Math.random().toString(36).slice(2, 10);
  if (histContainer) histContainer.innerHTML = '';
  if (resultDiv) resultDiv.innerHTML = '<p class="placeholder">Load data and run a simulation to see results.</p>';
  if (resetBtn) resetBtn.hidden = true;
}
