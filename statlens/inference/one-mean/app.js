// @ts-check
/**
 * One-Sample t-Test page controller.
 * Computes a one-sample t-test and CI, displays results and a
 * t-distribution curve with shaded p-value region.
 */

import { setJStat, pdfT } from '../../js/distributions.js';
import { oneMeanT, oneMeanTSummary } from '../../js/inference.js';
import { drawCurve, computeDomain, addInferenceAnnotations } from '../../js/curve.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { renderConditionsDiagnostic } from '../../js/conditions.js';
import { initTabs, initDataPanel, announce, initHelp, initHypToggle, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../js/page-utils.js';

initHelp();
import { parseCSV } from '../../js/csv-parser.js';
import { formatStat, detectPrecision, mean, sd } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';

/** Render LaTeX to HTML string via KaTeX. */
const tex = (/** @type {string} */ latex, display = false) =>
  katex.renderToString(latex, { throwOnError: false, displayMode: display });

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── Initialize jStat before anything else ──────────────────────────
const jstatMod = await import('jstat');
setJStat(jstatMod.default || jstatMod);

// ── DOM references ─────────────────────────────────────────────────
const controlsSection = /** @type {HTMLElement} */ (document.getElementById('controls'));
const chartAndResults = /** @type {HTMLElement} */ (document.getElementById('chart-and-results'));
const chartContainer = /** @type {HTMLElement} */ (document.getElementById('chart-container'));
const resultsPanel = /** @type {HTMLElement} */ (document.getElementById('results-panel'));
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));

const inputMu0 = /** @type {HTMLInputElement} */ (document.getElementById('input-mu0'));
const inputAlt = initHypToggle('input-alt', () => { if (currentData || fromSummary) showResults(); });
const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));

const varSelector = /** @type {HTMLElement} */ (document.getElementById('variable-selector'));
const varSelect = /** @type {HTMLSelectElement} */ (document.getElementById('var-select'));
const dataSummary = document.getElementById('data-summary');

// ── State ──────────────────────────────────────────────────────────
/** @type {number[] | null} */
let currentData = null;

// Summary-input state
let fromSummary = false;
let summaryXbar = 0;
let summaryS = 0;
let summaryN = 0;

/** @type {import('../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;

// ── Keyboard help dialog ───────────────────────────────────────────
const helpDialog = /** @type {HTMLDialogElement|null} */ (
  document.getElementById('keyboard-help'));
if (helpDialog) {
  const closeBtn = helpDialog.querySelector('button');
  if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '?') helpDialog.showModal();
  });
}

// ── Tabs ───────────────────────────────────────────────────────────
initTabs({ hintTarget: resultsPanel, hintAction: 'click Compute' });

// ── Data Panel ─────────────────────────────────────────────────────

/**
 * Process a loaded dataset object (from JSON).
 * @param {any} ds - Dataset JSON with .variables and .rows
 * @param {any} meta - Dataset metadata
 */
function handleDataset(ds, _meta) {
  if (!ds.variables || !ds.rows) {
    announce('Dataset has no usable data.');
    return;
  }

  const numericCols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);

  if (numericCols.length === 0) {
    announce('No numeric variables found in this dataset.');
    return;
  }

  // Load inference context if available
  const ctx = findContext(ds, 'one-mean');
  currentContext = ctx;
  if (ctx) {
    if (ctx.nullValue != null) inputMu0.value = String(ctx.nullValue);
    if (ctx.alternative) inputAlt.setValue(ctx.alternative);
    syncNullDisplay();
  }

  if (numericCols.length > 1) {
    varSelector.hidden = false;
    varSelect.innerHTML = '';
    for (const col of numericCols) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      varSelect.appendChild(opt);
    }
  } else {
    varSelector.hidden = true;
  }

  const rows = ds.rows;
  const loadColumn = (/** @type {string} */ col) => {
    const values = rows
      .map(/** @param {any} r */ r => r[col])
      .filter(/** @param {any} v */ v => v != null && isFinite(Number(v)))
      .map(Number);

    if (values.length < 2) {
      announce(`Variable "${col}" has fewer than 2 valid numeric values.`);
      return;
    }

    currentData = values;
    fromSummary = false;
    updateDataSummary(col, values);
    showResults();
    announce(`Loaded ${values.length} values from "${col}".`);
  };

  loadColumn(numericCols[0]);
  varSelect.onchange = () => loadColumn(varSelect.value);
}

/**
 * Update the data summary strip with dataset info.
 * @param {string} varName
 * @param {number[]} values
 */
function updateDataSummary(varName, values) {
  if (!dataSummary) return;
  const name = dataPanel.currentSourceName;
  const prefix = name ? `${name}: ` : '';
  const d = detectPrecision(values);
  dataSummary.textContent = `${prefix}${varName}: n = ${values.length}, x\u0304 = ${formatStat(mean(values), d)}, s = ${formatStat(sd(values), d)}`;
}

/**
 * Process parsed CSV text data.
 * @param {{headers: string[], types: string[], data: Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function handleText(parsed, sourceName) {
  currentContext = null;
  const numericCols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

  if (numericCols.length === 0) {
    announce('No numeric columns found in pasted data.');
    return;
  }

  if (numericCols.length > 1) {
    varSelector.hidden = false;
    varSelect.innerHTML = '';
    for (const col of numericCols) {
      const opt = document.createElement('option');
      opt.value = col;
      opt.textContent = col;
      varSelect.appendChild(opt);
    }
  } else {
    varSelector.hidden = true;
  }

  const loadColumn = (/** @type {string} */ col) => {
    const values = parsed.data
      .map(r => r[col])
      .filter(v => v != null && isFinite(Number(v)))
      .map(Number);

    if (values.length < 2) {
      announce(`Column "${col}" has fewer than 2 valid numeric values.`);
      return;
    }

    currentData = values;
    fromSummary = false;
    updateDataSummary(col, values);
    showResults();
    announce(`Loaded ${values.length} values from "${sourceName}".`);
  };

  loadColumn(numericCols[0]);
  varSelect.onchange = () => loadColumn(varSelect.value);
}

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: ds => ds.hasNumeric === true && ds.hasCategorical === false,
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentData = null;
    fromSummary = false;
    currentContext = null;
    varSelector.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'click Compute')}</p>`;
  },
});

// ── Summary input handler ────────────────────────────────────────
const loadSummaryBtn = document.getElementById('load-summary');
if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    const xbarInput = /** @type {HTMLInputElement} */ (document.getElementById('input-xbar'));
    const sInput = /** @type {HTMLInputElement} */ (document.getElementById('input-s'));
    const nInput = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));

    const xbar = parseFloat(xbarInput?.value);
    const s = parseFloat(sInput?.value);
    const n = parseInt(nInput?.value, 10);

    if (!isFinite(xbar)) { announce('Enter a valid sample mean.'); return; }
    if (!isFinite(s) || s <= 0) { announce('Enter a valid positive standard deviation.'); return; }
    if (!isFinite(n) || n < 2) { announce('Sample size must be at least 2.'); return; }

    fromSummary = true;
    summaryXbar = xbar;
    summaryS = s;
    summaryN = n;
    currentData = null;
    currentContext = null;
    varSelector.hidden = true;
    showResults();
    announce(`Loaded summary statistics: x̄ = ${xbar}, s = ${s}, n = ${n}.`);
  });
}

// ── Null value mirror (auto-fill Hₐ display) ─────────────────────
const nullDisplay = document.getElementById('null-display');
function syncNullDisplay() {
  if (nullDisplay) nullDisplay.textContent = inputMu0.value || '0';
}
inputMu0.addEventListener('input', syncNullDisplay);
syncNullDisplay();

// ── Parameter change listeners ─────────────────────────────────────
inputMu0.addEventListener('input', () => { if (currentData || fromSummary) showResults(); });
// Note: alternative change handler is wired via initHypToggle callback above
inputConf.addEventListener('input', () => { if (currentData || fromSummary) showResults(); });

// ── Core: compute and display ──────────────────────────────────────

function showResults() {
  if (!currentData && !fromSummary) return;
  if (currentData && currentData.length < 2) return;

  const mu0 = Number(inputMu0.value) || 0;
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.getValue());
  const confLevel = Math.min(0.99, Math.max(0.80, Number(inputConf.value) || 0.95));

  // Compute
  const result = fromSummary
    ? oneMeanTSummary(summaryXbar, summaryS, summaryN, { mu0, alternative, confLevel })
    : oneMeanT(currentData, { mu0, alternative, confLevel });

  // Detect precision for formatting
  const d = fromSummary
    ? Math.max(detectPrecision([summaryXbar]), detectPrecision([summaryS]))
    : detectPrecision(currentData);

  // Conditions checkpoint
  showConditionsCheckpoint();

  // Show sections
  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  // Draw chart
  drawChart(result);

  // Render sidebar results + formulas
  renderResults(result, d, mu0, alternative, confLevel);

  // Update page title
  setPageTitle(baseTitle, dataPanel.currentSourceName, { variable: varSelect?.value, n: currentData?.length });

  // Screen reader announcement
  announce(
    `t = ${result.tStat.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, d, 'pvalue')}. ` +
    `${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, d)}, ${formatStat(result.ciUpper, d)}).`
  );
}

/**
 * Render results panel with formula display.
 * @param {import('../../js/inference.js').OneMeanResult} r
 * @param {number} d - Decimal precision
 * @param {number} mu0
 * @param {string} alternative
 * @param {number} confLevel
 */
function renderResults(r, d, mu0, alternative, confLevel) {
  const altSymbol = alternative === 'less' ? '&lt;' :
                    alternative === 'greater' ? '&gt;' : '&ne;';
  const confPct = (confLevel * 100).toFixed(0);
  const pStr = formatStat(r.pValue, d, 'pvalue');

  // Significance
  const alpha = 1 - confLevel;

  // Generate conclusions
  const conclusions = generateConclusions({
    pValue: r.pValue, alpha, alternative,
    testType: 'one-mean',
    statName: 't',
    statValue: r.tStat.toFixed(3),
    context: {
      parameter: currentContext?.parameter,
      nullValue: mu0,
      claim: currentContext?.claim,
    },
  });

  // t* for CI
  const tStar = ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3);

  const V = '\\textcolor{#569BBD}';
  const S = '\\textcolor{#7B2D8E}';
  const P = '\\textcolor{#2e7d32}';

  const testFormula = tex(`\\begin{aligned}
    t &= \\frac{\\bar{x} - \\mu_0}{s \\,/\\, \\sqrt{n}} \\\\[8pt]
    &= \\frac{${V}{${formatStat(r.xbar, d)}} - ${V}{${mu0}}}{${V}{${formatStat(r.s, d)}} \\,/\\, \\sqrt{${V}{${r.n}}}} \\\\[8pt]
    &= ${S}{${r.tStat.toFixed(4)}}
  \\end{aligned}`, true);

  const ciFormula = tex(`\\begin{aligned}
    &\\bar{x} \\pm t^{\\!*} \\cdot \\frac{s}{\\sqrt{n}} \\\\[8pt]
    &${V}{${formatStat(r.xbar, d)}} \\pm ${V}{${tStar}} \\cdot \\frac{${V}{${formatStat(r.s, d)}}}{\\sqrt{${V}{${r.n}}}} \\\\[8pt]
    &= ${P}{(${formatStat(r.ciLower, d)},\\; ${formatStat(r.ciUpper, d)})}
  \\end{aligned}`, true);

  resultsPanel.innerHTML = `
    <h3>Sample Summary</h3>
    <table class="results-table" aria-label="Sample summary">
      <tbody>
        <tr><th scope="row">${tex('n')}</th><td>${r.n}</td></tr>
        <tr><th scope="row">${tex('\\bar{x}')}</th><td>${formatStat(r.xbar, d)}</td></tr>
        <tr><th scope="row">${tex('s')}</th><td>${formatStat(r.s, d)}</td></tr>
        <tr><th scope="row">${tex('SE')}</th><td>${formatStat(r.se, d)}</td></tr>
      </tbody>
    </table>

    <div class="formula-display">
      <h3>Test Statistic</h3>
      ${testFormula}
      <p class="formula-detail">${tex(`\\text{df} = n - 1 = ${r.n} - 1 = ${P}{${r.df}}`)}</p>
      <p class="formula-detail">${tex(`\\text{p-value} = ${P}{${pStr}}`)}</p>
    </div>

    <div class="formula-display formula-ci">
      <h3>${confPct}% Confidence Interval</h3>
      ${ciFormula}
    </div>

    <div class="interpretation" aria-live="polite">
      <p>The sample mean ${tex('\\bar{x}')} = ${formatStat(r.xbar, d)} is ${Math.abs(r.tStat).toFixed(2)} standard errors
        ${r.tStat >= 0 ? 'above' : 'below'} the null value ${tex('\\mu_0')} = ${mu0}.</p>
      <p><strong>Formal conclusion:</strong> ${conclusions.formal}</p>
      ${conclusions.practical ? `<p><strong>Practical conclusion:</strong> ${conclusions.practical}</p>` : ''}
      <p>${confPct}% CI for ${tex('\\mu')}: (${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)}).</p>
    </div>
  `;
}

// ── Conditions checkpoint ────────────────────────────────────────────

function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-mean/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-mean/');

  const hasRawData = !fromSummary && currentData && currentData.length > 0;

  conditionsCheckpoint.innerHTML = `
    <p>${hasRawData
      ? '<button type="button" class="conditions-toggle" aria-expanded="false" aria-controls="conditions-panel">Check Conditions</button>'
      : '<strong>Check Conditions</strong> (no raw data available for diagnostic plots)'}
    &nbsp; | &nbsp; Alternative: <a href="${bootLink}">Bootstrap CI</a> (no conditions required).</p>
    ${hasRawData ? '<div id="conditions-panel" class="conditions-panel" hidden><div id="conditions-chart"></div>' +
      (dsId ? `<p class="hint" style="margin-top:0.5rem">For further investigation, <a href="${buildSimLink('explore/descriptive/', { dataset: dsId })}" target="_blank" rel="noopener">explore this dataset</a> in a new tab.</p>` : '') +
      '</div>' : ''}`;
  conditionsCheckpoint.hidden = false;

  const toggle = conditionsCheckpoint.querySelector('.conditions-toggle');
  const panel = conditionsCheckpoint.querySelector('#conditions-panel');
  const chartEl = conditionsCheckpoint.querySelector('#conditions-chart');
  if (toggle && panel && chartEl) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
      if (!expanded && chartEl.children.length === 0) {
        const varName = varSelect?.value || '';
        renderConditionsDiagnostic(/** @type {HTMLElement} */ (chartEl), /** @type {number[]} */ (currentData), {
          varName,
          context: 'one-sample',
        });
      }
    });
  }
}

/**
 * Draw the t-distribution curve with shaded p-value region and t-statistic marker.
 * @param {import('../../js/inference.js').OneMeanResult} result
 */
function drawChart(result) {
  chartContainer.innerHTML = '';

  const { tStat, df, alternative } = result;
  const pdfFn = (/** @type {number} */ x) => pdfT(x, df);
  const domain = computeDomain('t', { df });

  /** @type {'left'|'right'|'both'|undefined} */
  let tail;
  /** @type {number|undefined} */
  let critValue;
  /** @type {number|undefined} */
  let critLow;
  /** @type {number|undefined} */
  let critHigh;

  if (alternative === 'less') {
    tail = 'left';
    critValue = tStat;
  } else if (alternative === 'greater') {
    tail = 'right';
    critValue = tStat;
  } else {
    tail = 'both';
    critLow = -Math.abs(tStat);
    critHigh = Math.abs(tStat);
  }

  const titleText = `t distribution (df = ${df})`;
  const descText = `t-distribution curve with df = ${df}, shaded region showing p-value area`;

  const chart = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 't',
    yLabel: 'Density',
    titleText,
    descText,
    id: 'one-mean-t-chart',
    tail,
    critValue,
    critLow,
    critHigh,
  });

  addInferenceAnnotations(chart, {
    statValue: Math.abs(tStat),
    statLabel: 't',
    pValue: result.pValue,
    pdfFn,
    tail: /** @type {'left'|'right'|'both'} */ (tail),
    statValueNeg: tail === 'both' ? -Math.abs(tStat) : undefined,
  });

}
