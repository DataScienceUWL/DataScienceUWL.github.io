// @ts-check
/**
 * Correlation Randomization Test page.
 * Shuffles y-values to break the x-y pairing, builds a null distribution of r.
 * Supports two-sided, right-tail, and left-tail alternatives.
 */

import { createRng, shuffle } from '../../js/prng.js';
import { cor, formatStat } from '../../js/stats.js';
import { computeBins } from '../../js/histogram.js';
import { drawScatterplot } from '../../js/scatterplot.js';
import { announce, initTabs, initKeyboardShortcuts, initPlayPause, initMechanismCollapse, initDataPanel, computeHighlights, animateDropToChart, flyDataStream, createExpertToggle, getTabHintText, getActiveTabId, setPageTitle } from '../../js/page-utils.js';
import { renderSimChart, resolveChartType } from '../../js/chart-defaults.js';

// ─── DOM elements ───

const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const mechanismStrip = document.getElementById('mechanism-strip');
const mechObservedPlot = document.getElementById('mech-observed-plot');
const mechShuffledPlot = document.getElementById('mech-shuffled-plot');
const mechObservedR = document.getElementById('mech-observed-r');
const mechShuffledR = document.getElementById('mech-shuffled-r');
const mechanismDescEl = document.getElementById('mechanism-description');
const simTitleEl = document.getElementById('sim-title');
const hypothesisDisplay = document.getElementById('hypothesis-display');
const altDirectionBtn = /** @type {HTMLButtonElement} */ (document.getElementById('alt-direction'));

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

// Controls section (for expert toggle)
const controlsSection = document.getElementById('controls');
const generateBar = /** @type {HTMLElement|null} */ (controlsSection?.querySelector('.generate-bar'));
if (generateBar) createExpertToggle(generateBar);

initTabs({ hintTarget: resultDiv, hintAction: 'run a simulation to see results' });
initKeyboardShortcuts(genBtns, resetBtn);
initPlayPause(genBtns, resetBtn);

// ─── State ───

/** @type {number[]} */
let allStats = [];
/** @type {(() => number)|null} */
let rng = null;
let seed = Math.random().toString(36).slice(2, 10);
let mechanismInitialized = false;

/** @type {number[]} */
let xValues = [];
/** @type {number[]} */
let yValues = [];
let xLabel = 'x';
let yLabel = 'y';
let observedR = 0;
let currentSourceName = '';
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ─── Hypothesis direction ───

function getDirection() {
  const alt = altDirectionBtn?.dataset.value ?? 'twosided';
  if (alt === 'greater') return /** @type {const} */ ('right');
  if (alt === 'less') return /** @type {const} */ ('left');
  return /** @type {const} */ ('both');
}

if (altDirectionBtn) {
  const vals = (altDirectionBtn.dataset.values || '').split(',');
  const labels = (altDirectionBtn.dataset.labels || '').split(',');
  altDirectionBtn.addEventListener('click', () => {
    const cur = vals.indexOf(altDirectionBtn.dataset.value || 'twosided');
    const next = (cur + 1) % vals.length;
    altDirectionBtn.dataset.value = vals[next];
    altDirectionBtn.textContent = labels[next];
    if (allStats.length > 0) {
      const direction = getDirection();
      renderChart(allStats, observedR, direction);
      const { pValue, extremeCount } = computePValue(allStats, observedR, direction);
      displayResults(allStats, observedR, pValue, extremeCount, direction);
    }
  });
}

// ─── Data loading ───

initDataPanel({
  autoCollapse: true,
  stickyControls: true,
  showPreview: true,
  datasetFilter: ds => ds.type === 'regression',
  onDataset: (ds) => {
    resetSimulation();
    currentSourceName = ds.name || '';
    const numVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'numeric');
    if (numVars.length < 2) {
      announce('Need at least two numeric variables.');
      return;
    }
    xLabel = numVars[0].label || numVars[0].name;
    yLabel = numVars[1].label || numVars[1].name;
    xValues = ds.rows.map(/** @param {any} r */ r => parseFloat(r[numVars[0].name])).filter(isFinite);
    yValues = ds.rows.map(/** @param {any} r */ r => parseFloat(r[numVars[1].name])).filter(isFinite);
    // Trim to matching length
    const n = Math.min(xValues.length, yValues.length);
    xValues = xValues.slice(0, n);
    yValues = yValues.slice(0, n);
    observedR = cor(xValues, yValues);
    showDataLoaded();
    announce(`${ds.name}.`);
  },
  onRawText: (text) => {
    currentSourceName = '';
    loadFromCSV(text);
  },
  onClear: () => {
    xValues = [];
    yValues = [];
    currentSourceName = '';
    resetSimulation();
    if (dataPreview) dataPreview.hidden = true;
    if (dataSummary) dataSummary.textContent = '\u2014';
    for (const btn of genBtns) btn.disabled = true;
    if (mechanismStrip) mechanismStrip.hidden = true;
    if (hypothesisDisplay) hypothesisDisplay.hidden = true;
    announce('Data cleared.');
  },
});

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
  xLabel = header[0];
  yLabel = header[1];
  const xs = [];
  const ys = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(delim).map(s => s.trim());
    const x = parseFloat(parts[0]);
    const y = parseFloat(parts[1]);
    if (isFinite(x) && isFinite(y)) {
      xs.push(x);
      ys.push(y);
    }
  }
  if (xs.length < 3) {
    announce('Need at least 3 valid numeric pairs.');
    return;
  }
  xValues = xs;
  yValues = ys;
  observedR = cor(xValues, yValues);
  showDataLoaded();
}

// ─── Show data ───

function showDataLoaded() {
  resetSimulation();
  if (dataSummary) {
    const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
    dataSummary.textContent = `${namePrefix}n = ${xValues.length}, observed r = ${formatStat(observedR, 4)}`;
  }
  for (const btn of genBtns) btn.disabled = false;
  if (resultDiv) resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';
  if (hypothesisDisplay) hypothesisDisplay.hidden = false;

  // Draw observed scatterplot in mechanism (stays hidden until first generate)
  const mechMargin = { top: 8, right: 8, bottom: 28, left: 22 };
  if (mechObservedPlot) {
    mechObservedPlot.innerHTML = '';
    drawScatterplot(mechObservedPlot, xValues, yValues, {
      xLabel, yLabel,
      titleText: 'Original Data',
      id: 'mech-obs',
      regression: computeRegression(xValues, yValues),
      margin: mechMargin,
      minimal: true,
    });
  }
  if (mechObservedR) mechObservedR.textContent = formatStat(observedR, 4);

  setPageTitle(baseTitle, currentSourceName, { n: xValues.length });
  announce(`Data loaded: n = ${xValues.length}, r = ${formatStat(observedR, 4)}`);

  setTimeout(() => {
    const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ─── Generate ───

for (const btn of genBtns) {
  btn.addEventListener('click', () => {
    const count = parseInt(btn.dataset.count, 10);
    if (xValues.length === 0) {
      announce('Please load data first.');
      return;
    }
    generateSimulations(count);
  });
}

/** @param {number} count */
function generateSimulations(count) {
  if (!rng) rng = createRng(seed);

  if (!mechanismInitialized && mechanismStrip) {
    mechanismInitialized = true;
    mechanismStrip.hidden = false;
    initMechanismCollapse(mechanismStrip);
  }

  const prevLength = allStats.length;

  if (simTitleEl) {
    simTitleEl.textContent = count === 1 ? 'This Shuffle' : 'Last Shuffle';
  }

  /** @type {number[]} */
  let lastShuffledY = [];
  let lastR = 0;

  for (let i = 0; i < count; i++) {
    const shuffledY = shuffle([...yValues], rng);
    const r = cor(xValues, shuffledY);
    allStats.push(r);
    lastShuffledY = shuffledY;
    lastR = r;
  }

  // Fire flying dots from observed → shuffled on +1
  if (count === 1 && mechObservedPlot && mechShuffledPlot) {
    flyDataStream(mechObservedPlot, mechShuffledPlot);
  }

  // Update mechanism strip with last shuffle (delayed on +1 to let dots land)
  const updateMechanism = () => {
    if (mechShuffledPlot) {
      mechShuffledPlot.innerHTML = '';
      const sMargin = { top: 8, right: 8, bottom: 28, left: 22 };
      drawScatterplot(mechShuffledPlot, xValues, lastShuffledY, {
        xLabel, yLabel,
        titleText: count === 1 ? 'This Shuffle' : 'Last Shuffle',
        id: 'mech-shuf',
        regression: computeRegression(xValues, lastShuffledY),
        margin: sMargin,
        minimal: true,
      });
    }
    if (mechShuffledR) {
      mechShuffledR.textContent = formatStat(lastR, 4);
      mechShuffledR.classList.toggle('highlight-last', count === 1);
    }
  };
  if (count === 1) {
    setTimeout(updateMechanism, 200);
  } else {
    updateMechanism();
  }
  if (mechanismDescEl) {
    mechanismDescEl.textContent = 'Shuffle y-values, keeping x-values fixed';
    mechanismDescEl.hidden = false;
  }

  const direction = getDirection();

  // Domain: symmetric around 0, extending to cover observed and all stats
  const maxAbs = Math.max(
    ...allStats.map(Math.abs),
    Math.abs(observedR)
  ) * 1.05 || 1;
  /** @type {[number, number]} */
  const hlDomain = [-maxAbs, maxAbs];

  const { bins: fullBins } = computeBins(allStats, { domain: hlDomain });
  const lockedThresholds = fullBins.slice(1).map(b => b.x0);

  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    allStats, prevLength, count, computeBins, { domain: hlDomain, thresholds: lockedThresholds });
  const { pValue, extremeCount } = computePValue(allStats, observedR, direction);
  displayResults(allStats, observedR, pValue, extremeCount, direction);

  if (count === 1) {
    setTimeout(() => {
      renderChart(allStats, observedR, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
      const dropSource = document.getElementById('mech-shuffled-r');
      const chartCont = document.getElementById('chart-container');
      if (dropSource && chartCont) animateDropToChart(dropSource, chartCont);
    }, 150);
  } else {
    renderChart(allStats, observedR, direction, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
  }

  if (resetBtn) resetBtn.hidden = false;
  announce(`Generated ${count} shuffle${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
}

// ─── Chart ───

/**
 * @param {number[]} stats
 * @param {number} observed
 * @param {'left'|'right'|'both'} direction
 * @param {number} [highlightIndex]
 * @param {Set<number>} [highlightIndices]
 * @param {number[]} [prevBinCounts]
 * @param {[number,number]} [hlDomain]
 * @param {number[]} [hlThresholds]
 */
function renderChart(stats, observed, direction, highlightIndex = -1, highlightIndices, prevBinCounts, hlDomain, hlThresholds) {
  if (!chartContainer) return;

  const maxAbs = Math.max(...stats.map(Math.abs), Math.abs(observed)) * 1.05 || 1;
  /** @type {[number, number]} */
  const domain = hlDomain || [-maxAbs, maxAbs];
  const activeChart = resolveChartType(stats.length, 'auto');

  const { pValue } = stats.length > 0 ? computePValue(stats, observed, direction) : { pValue: 0 };

  renderSimChart(chartContainer, stats, {
    chartType: activeChart,
    id: 'sim-chart',
    xLabel: 'Correlation (r)',
    titleText: 'Null Distribution',
    observedStat: observed,
    direction,
    nullCenter: 0,
    domain,
    highlightIndex,
    highlightIndices,
    prevBinCounts,
    thresholds: hlThresholds,
    pillMode: stats.length > 0 ? 'randomization' : undefined,
    pValue,
    precision: 4,
  });

}

/**
 * @param {number[]} stats
 * @param {number} observed
 * @param {'left'|'right'|'both'} direction
 */
function computePValue(stats, observed, direction) {
  let extremeCount = 0;
  for (const s of stats) {
    if (direction === 'right' && s >= observed) extremeCount++;
    else if (direction === 'left' && s <= observed) extremeCount++;
    else if (direction === 'both' && Math.abs(s) >= Math.abs(observed)) extremeCount++;
  }
  return { pValue: extremeCount / stats.length, extremeCount };
}

/**
 * @param {number[]} stats
 * @param {number} observed
 * @param {number} pValue
 * @param {number} extremeCount
 * @param {'left'|'right'|'both'} direction
 */
function displayResults(stats, observed, pValue, extremeCount, direction) {
  let strength;
  if (pValue < 0.01) strength = 'very strong';
  else if (pValue < 0.05) strength = 'strong';
  else if (pValue < 0.10) strength = 'moderate';
  else strength = 'little';

  const dirLabel = direction === 'both' ? 'two-sided'
    : direction === 'right' ? 'right-tail' : 'left-tail';
  const altSymbol = direction === 'both' ? '\u2260'
    : direction === 'right' ? '>' : '<';
  const comparison = direction === 'both' ? '|r| \u2265' : direction === 'right' ? 'r \u2265' : 'r \u2264';

  if (resultDiv) {
    resultDiv.innerHTML = `
      <p><strong>Null Distribution</strong> (${stats.length} simulations)</p>
      <p>Observed r = ${formatStat(observed, 4)}</p>
      <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
      <p><strong>p-value:</strong> ${formatStat(pValue, 0, 'pvalue')}</p>
      <p class="interpretation">${extremeCount} of ${stats.length} shuffled datasets had ${comparison} ${formatStat(direction === 'both' ? Math.abs(observed) : observed, 4)}. This provides ${strength} evidence against H\u2080: \u03C1 = 0 (H\u2090: \u03C1 ${altSymbol} 0).</p>
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
  mechanismInitialized = false;
  seed = Math.random().toString(36).slice(2, 10);
  if (chartContainer) chartContainer.innerHTML = '';
  if (resultDiv) resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'run a simulation to see results')}</p>`;
  if (resetBtn) resetBtn.hidden = true;
  if (mechanismStrip) mechanismStrip.hidden = true;
}

// ─── Helpers ───

/**
 * Compute simple regression coefficients for the regression line overlay.
 * @param {number[]} x
 * @param {number[]} y
 * @returns {{slope: number, intercept: number}}
 */
function computeRegression(x, y) {
  const n = Math.min(x.length, y.length);
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX += x[i];
    sumY += y[i];
    sumXY += x[i] * y[i];
    sumX2 += x[i] * x[i];
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}
