// @ts-check
/**
 * ANOVA Randomization Test page.
 * Shuffles group labels to build a null distribution of the F statistic.
 * Always right-tailed (F ≥ 0).
 */

import { createRng, shuffle } from '../../js/prng.js';
import { fStat, mean, sd, formatStat, detectPrecision } from '../../js/stats.js';
import { computeBins } from '../../js/histogram.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { announce, initTabs, initKeyboardShortcuts, initPlayPause, initMechanismCollapse, initDataPanel, computeHighlights, animateDropToChart, flyDataStream, createExpertToggle, updateTabHint, getActiveTabId, getTabHintText, initHelp, setPageTitle } from '../../js/page-utils.js';
import { renderSimChart, resolveChartType } from '../../js/chart-defaults.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';

initHelp();

// ─── DOM elements ───

const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const mechanismStrip = document.getElementById('mechanism-strip');
const mechObservedBoxplots = document.getElementById('mech-observed-boxplots');
const mechShuffledBoxplots = document.getElementById('mech-shuffled-boxplots');
const mechObservedF = document.getElementById('mech-observed-f');
const mechShuffledF = document.getElementById('mech-shuffled-f');
const mechanismDescEl = document.getElementById('mechanism-description');
const simTitleEl = document.getElementById('sim-title');
const hypothesisDisplay = document.getElementById('hypothesis-display');

const groupVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('group-var-select'));
const responseVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('response-var-select'));
const varSelectors = document.getElementById('var-selectors');

const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
  document.querySelectorAll('.gen-btn'));

// Controls section (for expert toggle)
const controlsSection = document.getElementById('controls');

// Add expert toggle link next to generate bar
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
/** Whether the mechanism strip has been initialized (deferred to first generate). */
let mechanismInitialized = false;

/** @type {string[]} */
let groupNames = [];
/** @type {Record<string, number[]>} */
let groupedValues = {};
/** @type {number[]} */
let allValues = [];
let observedF = 0;
let totalN = 0;
let currentSourceName = '';
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');
let dataPrecision = 2;

/** @type {Array<Record<string, any>>} */
let currentRows = [];
/** @type {Array<{name:string, type:string}>} */
let currentVarInfo = [];

/** @type {{population?:string, parameter?:string, nullClaim?:string, test?:string, groupVar?:string, responseVar?:string, claim?:string}} */
let datasetContext = {};

// ─── Variable selectors ───

function populateVarSelectors() {
  if (!groupVarSelect || !responseVarSelect) return;

  const catCols = currentVarInfo.filter(v => v.type === 'categorical').map(v => v.name);
  const numCols = currentVarInfo.filter(v => v.type === 'numeric').map(v => v.name);

  groupVarSelect.innerHTML = '';
  for (const col of catCols) {
    const opt = document.createElement('option');
    opt.value = col;
    opt.textContent = col;
    groupVarSelect.appendChild(opt);
  }

  responseVarSelect.innerHTML = '';
  for (const col of numCols) {
    const opt = document.createElement('option');
    opt.value = col;
    opt.textContent = col;
    responseVarSelect.appendChild(opt);
  }

  if (varSelectors) varSelectors.hidden = catCols.length === 0 || numCols.length === 0;
}

/** Extract groups from current data using selected variables. */
function extractGroups() {
  const gVar = groupVarSelect?.value;
  const rVar = responseVarSelect?.value;
  if (!gVar || !rVar || currentRows.length === 0) return false;

  /** @type {Record<string, number[]>} */
  const groups = {};
  for (const row of currentRows) {
    const g = String(row[gVar]);
    const v = Number(row[rVar]);
    if (!isFinite(v)) continue;
    if (!groups[g]) groups[g] = [];
    groups[g].push(v);
  }

  const names = Object.keys(groups);
  if (names.length < 2) {
    announce('Need at least 2 groups for ANOVA.');
    return false;
  }

  groupNames = names;
  groupedValues = groups;
  allValues = names.flatMap(n => groups[n]);
  totalN = allValues.length;
  dataPrecision = Math.min(2, detectPrecision(allValues));

  const groupArrays = names.map(n => groups[n]);
  observedF = fStat(groupArrays);

  return true;
}

groupVarSelect?.addEventListener('change', () => {
  if (extractGroups()) showDataLoaded();
});
responseVarSelect?.addEventListener('change', () => {
  if (extractGroups()) showDataLoaded();
});

// ─── Data loading ───

/**
 * Load parsed CSV data (shared by paste + file).
 * @param {{headers:string[], types:string[], data:Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function loadParsedData(parsed, sourceName) {
  const catCols = parsed.headers.filter((h, i) => parsed.types[i] === 'categorical');
  const numCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

  if (catCols.length < 1 || numCols.length < 1) {
    announce('Need at least one categorical column and one numeric column.');
    return;
  }

  currentRows = parsed.data;
  currentVarInfo = parsed.headers.map((h, i) => ({ name: h, type: parsed.types[i] }));
  currentSourceName = sourceName;
  datasetContext = {};

  populateVarSelectors();
  if (extractGroups()) showDataLoaded();
}

const dataApi = initDataPanel({
  autoCollapse: true,
  stickyControls: true,
  showPreview: true,
  // Permutation F-test (ANOVA) requires a grouping variable with 3+ levels and
  // >=3 obs per group (REQ-024). 2-level datasets give a degenerate (df1=1)
  // F-test and belong in the two-means tools; single-record groups are excluded.
  datasetFilter: ds => ds.hasNumeric && ds.hasCategorical && ds.groupLevels >= 3 && ds.minGroupN >= 3,
  onDataset: (ds) => {
    resetSimulation();
    currentSourceName = ds.name || '';

    // Find ANOVA inference context if available
    const contexts = ds.inferenceContexts || [];
    const anovaCtx = contexts.find(/** @param {any} c */ c => c.test === 'anova');
    datasetContext = anovaCtx || {};

    currentRows = ds.rows;
    currentVarInfo = (ds.variables || []).map(/** @param {any} v */ v =>
      typeof v === 'object' ? v : { name: v, type: 'unknown' }
    );

    populateVarSelectors();

    // Auto-select variables from context
    if (anovaCtx?.groupVar && groupVarSelect) {
      groupVarSelect.value = anovaCtx.groupVar;
    }
    if (anovaCtx?.responseVar && responseVarSelect) {
      responseVarSelect.value = anovaCtx.responseVar;
    }

    if (extractGroups()) {
      showDataLoaded();
      announce(`${ds.name}.`);
    }
  },
  onText: loadParsedData,
  onClear: () => {
    currentRows = [];
    currentVarInfo = [];
    groupedValues = {};
    groupNames = [];
    allValues = [];
    currentSourceName = '';
    datasetContext = {};
    resetSimulation();
    if (dataPreview) dataPreview.hidden = true;
    if (dataSummary) dataSummary.textContent = '\u2014';
    if (varSelectors) varSelectors.hidden = true;
    if (hypothesisDisplay) hypothesisDisplay.hidden = true;
    for (const btn of genBtns) btn.disabled = true;
    if (mechanismStrip) mechanismStrip.hidden = true;
    announce('Data cleared.');
  },
});

// ─── Show data ───

function showDataLoaded() {
  resetSimulation();

  if (dataSummary) {
    const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
    dataSummary.textContent = `${namePrefix}${groupNames.length} groups, n = ${totalN}, observed F = ${formatStat(observedF, 2)}`;
  }

  if (hypothesisDisplay) {
    hypothesisDisplay.hidden = false;
    // Update H₀ with actual group count and names
    const h0Text = document.getElementById('h0-text');
    if (h0Text) {
      const k = groupNames.length;
      const muList = groupNames.map((name, i) => `μ<sub>${name}</sub>`).join(' = ');
      h0Text.innerHTML = `${muList} (all ${k} group means are equal)`;
    }
  }

  for (const btn of genBtns) btn.disabled = false;
  if (resultDiv) resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';

  // Populate mechanism strip observed panel (stays hidden until first generate)
  renderMiniBoxplots(mechObservedBoxplots, groupedValues);
  if (mechObservedF) mechObservedF.textContent = formatStat(observedF, 2);

  setPageTitle(baseTitle, currentSourceName, { n: totalN });
  announce(`Data loaded: ${groupNames.length} groups, n = ${totalN}`);

  // Scroll controls into view
  setTimeout(() => {
    const target = document.getElementById('controls') || genBtns[0]?.closest('.generate-bar');
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 100);
}

// ─── Mini boxplots for mechanism strip ───

/**
 * Render compact grouped boxplots into a mechanism panel container.
 * @param {HTMLElement|null} container
 * @param {Record<string, number[]>} groups
 */
function renderMiniBoxplots(container, groups) {
  if (!container) return;
  container.innerHTML = '';

  if (Object.keys(groups).length === 0) return;

  drawBoxplot(container, groups, {
    xLabel: responseVarSelect?.value || '',
    titleText: 'Group comparison',
    id: container.id + '-box',
    animate: false,
    showOutliers: false,
    margin: { top: 8, right: 12, bottom: 30, left: 60 },
  });
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

  // Show mechanism strip on first generate
  if (!mechanismInitialized && mechanismStrip) {
    mechanismInitialized = true;
    mechanismStrip.hidden = false;
    initMechanismCollapse(mechanismStrip);
  }

  const prevLength = allStats.length;

  if (simTitleEl) {
    simTitleEl.textContent = count === 1 ? 'This Shuffle' : 'Last Shuffle';
  }

  // Build flat arrays for shuffling
  // groupLabels[i] corresponds to allValues[i]
  /** @type {string[]} */
  const groupLabels = [];
  /** @type {number[]} */
  const valuesCopy = [];
  for (const name of groupNames) {
    for (const v of groupedValues[name]) {
      groupLabels.push(name);
      valuesCopy.push(v);
    }
  }

  /** @type {Record<string, number[]>} */
  let lastShuffledGroups = {};
  let lastF = 0;

  for (let i = 0; i < count; i++) {
    // Shuffle the group labels, keeping values fixed
    const shuffledLabels = shuffle([...groupLabels], rng);

    // Reconstruct groups from shuffled labels
    /** @type {number[][]} */
    const groups = groupNames.map(() => []);
    for (let k = 0; k < shuffledLabels.length; k++) {
      const idx = groupNames.indexOf(shuffledLabels[k]);
      groups[idx].push(valuesCopy[k]);
    }

    const f = fStat(groups);
    allStats.push(f);

    if (i === count - 1) {
      lastShuffledGroups = {};
      for (let g = 0; g < groupNames.length; g++) {
        lastShuffledGroups[groupNames[g]] = groups[g];
      }
      lastF = f;
    }
  }

  // Fire flying dots on +1 before updating the shuffled panel
  if (count === 1 && mechObservedBoxplots && mechShuffledBoxplots) {
    flyDataStream(mechObservedBoxplots, mechShuffledBoxplots);
  }

  // Update mechanism strip shuffled panel
  renderMiniBoxplots(mechShuffledBoxplots, lastShuffledGroups);
  if (mechShuffledF) {
    mechShuffledF.textContent = formatStat(lastF, 2);
    mechShuffledF.classList.toggle('highlight-last', count === 1);
  }
  if (mechanismDescEl) {
    mechanismDescEl.textContent = 'Shuffle group labels, keeping response values fixed';
    mechanismDescEl.hidden = false;
  }

  const fHi = Math.max(...allStats, observedF) * 1.05 || 1;
  /** @type {[number,number]} */
  const hlDomain = [0, fHi];

  // Pre-compute bins to lock in bin edges
  const { bins: fullBins } = computeBins(allStats, { domain: hlDomain });
  const lockedThresholds = fullBins.slice(1).map(b => b.x0);

  const { hlIndex, hlIndices, prevBinCounts } = computeHighlights(
    allStats, prevLength, count, computeBins, { domain: hlDomain, thresholds: lockedThresholds });
  const { pValue, extremeCount } = computePValue(allStats, observedF);
  displayResults(allStats, observedF, pValue, extremeCount);

  if (count === 1) {
    setTimeout(() => {
      renderChart(allStats, observedF, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
      const dropSource = document.getElementById('mech-shuffled-f');
      const chartCont = document.getElementById('chart-container');
      if (dropSource && chartCont) animateDropToChart(dropSource, chartCont);
    }, 150);
  } else {
    renderChart(allStats, observedF, hlIndex, hlIndices, prevBinCounts, hlDomain, lockedThresholds);
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

  const hi = Math.max(...stats, observed) * 1.05 || 1;
  /** @type {[number, number]} */
  const domain = hlDomain || [0, hi];
  const activeChart = resolveChartType(stats.length, 'auto');

  const { pValue } = stats.length > 0 ? computePValue(stats, observed) : { pValue: 0 };

  renderSimChart(chartContainer, stats, {
    chartType: activeChart,
    id: 'sim-chart',
    xLabel: 'F Statistic',
    titleText: 'Null Distribution',
    observedStat: observed,
    direction: 'right',
    domain,
    highlightIndex,
    highlightIndices,
    prevBinCounts,
    thresholds: hlThresholds,
    pillMode: stats.length > 0 ? 'randomization' : undefined,
    pValue,
  });

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

  // Group summary
  const groupSummaryRows = groupNames.map(name => {
    const vals = groupedValues[name];
    return `<tr><td>${name}</td><td>${vals.length}</td><td>${formatStat(mean(vals), dataPrecision)}</td><td>${formatStat(sd(vals), dataPrecision)}</td></tr>`;
  }).join('');

  const groupSummaryTable = `
    <table class="freq-table" aria-label="Group summary">
      <thead><tr><th scope="col">Group</th><th scope="col">n</th><th scope="col">Mean</th><th scope="col">SD</th></tr></thead>
      <tbody>${groupSummaryRows}</tbody>
    </table>
  `;

  // Interpretation
  const nullClaim = datasetContext.claim
    || 'the group means are all equal';

  // Try generating formal conclusions
  let conclusionHTML = '';
  if (datasetContext.parameter || datasetContext.claim) {
    const conclusions = generateConclusions({
      testType: 'anova',
      pValue,
      alpha: 0.05,
      context: datasetContext,
    });
    if (conclusions.formal) {
      conclusionHTML = `<p class="interpretation"><strong>Conclusion:</strong> ${conclusions.formal}</p>`;
    }
    if (conclusions.practical) {
      conclusionHTML += `<p class="interpretation">${conclusions.practical}</p>`;
    }
  }

  if (resultDiv) {
    resultDiv.innerHTML = `
      <p><strong>Null Distribution</strong> (${stats.length} simulations)</p>
      ${groupSummaryTable}
      <p>Observed F = ${formatStat(observed, 2)}</p>
      <p>Extreme count: ${extremeCount} of ${stats.length} (right-tail)</p>
      <p><strong>p-value:</strong> ${formatStat(pValue, 0, 'pvalue')}</p>
      <p class="interpretation">${extremeCount} of ${stats.length} shuffled datasets had F ≥ ${formatStat(observed, 2)}. This provides ${strength} evidence against H₀: ${nullClaim}.</p>
      ${conclusionHTML}
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
