// @ts-check
/**
 * Paired t-Test page controller.
 * Computes a paired t-test and CI on the differences (var1 - var2),
 * displays results and a t-distribution curve with shaded p-value region.
 */

import { setJStat, pdfT } from '../../js/distributions.js';
import { pairedT, pairedTSummary } from '../../js/inference.js';
import { drawCurve, computeDomain, addInferenceAnnotations } from '../../js/curve.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { renderConditionsDiagnostic } from '../../js/conditions.js';
import { initTabs, initDataPanel, announce, initHelp, initHypToggle, getActiveTabId, getTabHintText, buildSimLink, setPageTitle } from '../../js/page-utils.js';

initHelp();
import { parseCSV } from '../../js/csv-parser.js';
import { formatStat, detectPrecision, mean, sd } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';
import * as d3Selection from 'd3-selection';

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
const inputAlt = initHypToggle('input-alt', () => { if (currentDiffs || fromSummary) showResults(); });
const inputConf = /** @type {HTMLInputElement} */ (document.getElementById('input-conf'));

const varSelectors = /** @type {HTMLElement} */ (document.getElementById('variable-selectors'));
const var1Select = /** @type {HTMLSelectElement} */ (document.getElementById('var1-select'));
const var2Select = /** @type {HTMLSelectElement} */ (document.getElementById('var2-select'));
const dataSummary = document.getElementById('data-summary');

// ── State ──────────────────────────────────────────────────────────
/** @type {number[] | null} */
let currentDiffs = null;
let var1Name = '';
let var2Name = '';
/** @type {Array<Record<string, any>> | null} */
let currentRows = null;
/** @type {string[]} */
let numericCols = [];

// Summary-input state
let fromSummary = false;
let summaryDbar = 0;
let summarySd = 0;
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

// ── Helpers ────────────────────────────────────────────────────────

function populateVarSelectors(cols) {
  numericCols = cols;
  if (cols.length < 2) {
    varSelectors.hidden = true;
    announce('Need at least 2 numeric columns for paired data.');
    return;
  }

  varSelectors.hidden = false;
  var1Select.innerHTML = '';
  var2Select.innerHTML = '';
  for (const col of cols) {
    const opt1 = document.createElement('option');
    opt1.value = col; opt1.textContent = col;
    var1Select.appendChild(opt1);
    const opt2 = document.createElement('option');
    opt2.value = col; opt2.textContent = col;
    var2Select.appendChild(opt2);
  }
  var1Select.value = cols[0];
  var2Select.value = cols.length > 1 ? cols[1] : cols[0];
}

function loadFromSelections() {
  if (!currentRows || numericCols.length < 2) return;
  const col1 = var1Select.value;
  const col2 = var2Select.value;
  if (col1 === col2) { announce('Please select two different variables.'); return; }

  var1Name = col1;
  var2Name = col2;
  const diffs = [];
  for (const row of currentRows) {
    const v1 = Number(row[col1]);
    const v2 = Number(row[col2]);
    if (isFinite(v1) && isFinite(v2)) diffs.push(v1 - v2);
  }

  if (diffs.length < 2) {
    announce(`Fewer than 2 valid pairs found for "${col1}" and "${col2}".`);
    return;
  }

  currentDiffs = diffs;
  fromSummary = false;
  if (dataSummary) {
    const name = dataPanel.currentSourceName;
    const prefix = name ? `${name}: ` : '';
    const d = detectPrecision(diffs);
    dataSummary.textContent = `${prefix}${diffs.length} pairs (${col1} \u2212 ${col2}), d\u0304 = ${formatStat(mean(diffs), d)}, s_d = ${formatStat(sd(diffs), d)}`;
  }
  showResults();
  announce(`Loaded ${diffs.length} paired differences (${col1} \u2212 ${col2}).`);
}

// ── Data Panel ─────────────────────────────────────────────────────

function handleDataset(ds, _meta) {
  if (!ds.variables || !ds.rows) { announce('Dataset has no usable data.'); return; }
  const cols = ds.variables
    .filter(/** @param {any} v */ v => v.type === 'numeric')
    .map(/** @param {any} v */ v => v.name);
  if (cols.length < 2) { announce('This dataset needs at least 2 numeric variables for a paired test.'); return; }

  const ctx = findContext(ds, 'paired');
  currentContext = ctx;
  if (ctx) {
    if (ctx.nullValue != null) inputMu0.value = String(ctx.nullValue);
    if (ctx.alternative) inputAlt.setValue(ctx.alternative);
    syncNullDisplay();
  }

  currentRows = ds.rows;
  populateVarSelectors(cols);
  loadFromSelections();
}

function handleText(parsed, sourceName) {
  currentContext = null;
  const cols = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
  if (cols.length < 2) { announce('Need at least 2 numeric columns for paired data.'); return; }
  currentRows = parsed.data;
  populateVarSelectors(cols);
  loadFromSelections();
}

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  datasetFilter: ds => ds.type === 'paired',
  onDataset: handleDataset,
  onText: handleText,
  onClear: () => {
    currentDiffs = null;
    currentRows = null;
    numericCols = [];
    fromSummary = false;
    currentContext = null;
    varSelectors.hidden = true;
    controlsSection.hidden = true;
    chartAndResults.hidden = true;
    chartContainer.innerHTML = '';
    resultsPanel.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'click Compute')}</p>`;
  },
});

// ── Variable selector change listeners ────────────────────────────
var1Select.addEventListener('change', () => { if (currentRows) loadFromSelections(); });
var2Select.addEventListener('change', () => { if (currentRows) loadFromSelections(); });

// ── Summary input handler ────────────────────────────────────────
const loadSummaryBtn = document.getElementById('load-summary');
if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    const dbarInput = /** @type {HTMLInputElement} */ (document.getElementById('input-dbar'));
    const sdInput = /** @type {HTMLInputElement} */ (document.getElementById('input-sd'));
    const nInput = /** @type {HTMLInputElement} */ (document.getElementById('input-n'));

    const dbar = parseFloat(dbarInput?.value);
    const sd = parseFloat(sdInput?.value);
    const n = parseInt(nInput?.value, 10);

    if (!isFinite(dbar)) { announce('Enter a valid mean difference.'); return; }
    if (!isFinite(sd) || sd <= 0) { announce('Enter a valid positive standard deviation.'); return; }
    if (!isFinite(n) || n < 2) { announce('Sample size must be at least 2.'); return; }

    fromSummary = true;
    summaryDbar = dbar;
    summarySd = sd;
    summaryN = n;
    currentDiffs = null;
    currentRows = null;
    currentContext = null;
    varSelectors.hidden = true;
    showResults();
    announce(`Loaded summary: d̄ = ${dbar}, s_d = ${sd}, n = ${n}.`);
  });
}

// ── Null value mirror ─────────────────────────────────────────────
const nullDisplay = document.getElementById('null-display');
function syncNullDisplay() {
  if (nullDisplay) nullDisplay.textContent = inputMu0.value || '0';
}
inputMu0.addEventListener('input', syncNullDisplay);
syncNullDisplay();

// ── Parameter change listeners ─────────────────────────────────────
inputMu0.addEventListener('input', () => { if (currentDiffs || fromSummary) showResults(); });
// Note: alternative change handler is wired via initHypToggle callback above
inputConf.addEventListener('input', () => { if (currentDiffs || fromSummary) showResults(); });

// ── Core: compute and display ──────────────────────────────────────

function showResults() {
  if (!currentDiffs && !fromSummary) return;
  if (currentDiffs && currentDiffs.length < 2) return;

  const mu0 = Number(inputMu0.value) || 0;
  const alternative = /** @type {'less'|'greater'|'two-sided'} */ (inputAlt.getValue());
  const confLevel = Math.min(0.99, Math.max(0.80, Number(inputConf.value) || 0.95));

  const result = fromSummary
    ? pairedTSummary(summaryDbar, summarySd, summaryN, { mu0, alternative, confLevel })
    : pairedT(currentDiffs, { mu0, alternative, confLevel });

  const d = fromSummary
    ? Math.max(detectPrecision([summaryDbar]), detectPrecision([summarySd]))
    : detectPrecision(currentDiffs);

  // Conditions checkpoint
  showConditionsCheckpoint();

  controlsSection.hidden = false;
  chartAndResults.hidden = false;

  drawChart(result);
  renderResults(result, d, mu0, alternative, confLevel);

  // Update page title
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: currentDiffs?.length });

  announce(
    `t = ${result.tStat.toFixed(3)}, df = ${result.df}, ` +
    `p-value = ${formatStat(result.pValue, d, 'pvalue')}. ` +
    `${(confLevel * 100).toFixed(0)}% CI: (${formatStat(result.ciLower, d)}, ${formatStat(result.ciUpper, d)}).`
  );
}

// ── Conditions checkpoint ────────────────────────────────────────────

function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const dsId = dataPanel.currentDatasetId;
  const bootLink = dsId
    ? buildSimLink('simulate/bootstrap-paired/', { dataset: dsId })
    : buildSimLink('simulate/bootstrap-paired/');

  const hasRawData = !fromSummary && currentDiffs && currentDiffs.length > 0;

  conditionsCheckpoint.innerHTML = `
    <p>${hasRawData
      ? '<button type="button" class="conditions-toggle" aria-expanded="false" aria-controls="conditions-panel">Check Conditions</button>'
      : '<strong>Check Conditions</strong> (no raw data available for diagnostic plots)'}
    &nbsp; | &nbsp; Alternative: <a href="${bootLink}">Bootstrap Paired CI</a> (no conditions required).</p>
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
        const diffLabel = var1Name && var2Name
          ? `${var1Name} \u2212 ${var2Name}`
          : 'Differences';
        renderConditionsDiagnostic(/** @type {HTMLElement} */ (chartEl), /** @type {number[]} */ (currentDiffs), {
          varName: diffLabel,
          context: 'paired',
        });
      }
    });
  }
}

/**
 * Render results panel with formula display.
 * @param {import('../../js/inference.js').PairedResult} r
 * @param {number} d
 * @param {number} mu0
 * @param {string} alternative
 * @param {number} confLevel
 */
function renderResults(r, d, mu0, alternative, confLevel) {
  const confPct = (confLevel * 100).toFixed(0);
  const pStr = formatStat(r.pValue, d, 'pvalue');
  const alpha = 1 - confLevel;
  const tStar = ((r.ciUpper - r.ciLower) / 2 / r.se).toFixed(3);

  const conclusions = generateConclusions({
    pValue: r.pValue, alpha, alternative,
    testType: 'paired',
    statName: 't',
    statValue: r.tStat.toFixed(3),
    context: {
      parameter: currentContext?.parameter,
      nullValue: mu0,
      claim: currentContext?.claim,
    },
  });

  const diffLabel = var1Name && var2Name
    ? `${var1Name} \u2212 ${var2Name}`
    : 'group 1 \u2212 group 2';

  const V = '\\textcolor{#569BBD}';
  const S = '\\textcolor{#7B2D8E}';
  const P = '\\textcolor{#2e7d32}';

  const testFormula = tex(`\\begin{aligned}
    t &= \\frac{\\bar{d} - \\mu_0}{s_d \\,/\\, \\sqrt{n}} \\\\[8pt]
    &= \\frac{${V}{${formatStat(r.dbar, d)}} - ${V}{${mu0}}}{${V}{${formatStat(r.sd, d)}} \\,/\\, \\sqrt{${V}{${r.n}}}} \\\\[8pt]
    &= ${S}{${r.tStat.toFixed(4)}}
  \\end{aligned}`, true);

  const ciFormula = tex(`\\begin{aligned}
    &\\bar{d} \\pm t^{\\!*} \\cdot \\frac{s_d}{\\sqrt{n}} \\\\[8pt]
    &${V}{${formatStat(r.dbar, d)}} \\pm ${V}{${tStar}} \\cdot \\frac{${V}{${formatStat(r.sd, d)}}}{\\sqrt{${V}{${r.n}}}} \\\\[8pt]
    &= ${P}{(${formatStat(r.ciLower, d)},\\; ${formatStat(r.ciUpper, d)})}
  \\end{aligned}`, true);

  resultsPanel.innerHTML = `
    <h3>Paired Differences</h3>
    <table class="results-table" aria-label="Paired differences summary">
      <tbody>
        <tr><th scope="row">${tex('n')} (pairs)</th><td>${r.n}</td></tr>
        <tr><th scope="row">${tex('\\bar{d}')}</th><td>${formatStat(r.dbar, d)}</td></tr>
        <tr><th scope="row">${tex('s_d')}</th><td>${formatStat(r.sd, d)}</td></tr>
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
      <p><strong>Differences:</strong> d = ${diffLabel}</p>
      <p>The mean difference ${tex('\\bar{d}')} = ${formatStat(r.dbar, d)} is ${Math.abs(r.tStat).toFixed(2)} SEs
        ${r.tStat >= 0 ? 'above' : 'below'} ${tex('\\mu_0')} = ${mu0}.</p>
      <p><strong>Formal conclusion:</strong> ${conclusions.formal}</p>
      ${conclusions.practical ? `<p><strong>Practical conclusion:</strong> ${conclusions.practical}</p>` : ''}
      <p>${confPct}% CI for ${tex('\\mu_d')}: (${formatStat(r.ciLower, d)}, ${formatStat(r.ciUpper, d)}).</p>
    </div>
  `;
}

/**
 * Draw the t-distribution curve with shaded p-value region.
 * @param {import('../../js/inference.js').PairedResult} result
 */
function drawChart(result) {
  chartContainer.innerHTML = '';

  const { tStat, df, alternative } = result;
  const pdfFn = (/** @type {number} */ x) => pdfT(x, df);
  const domain = computeDomain('t', { df });

  /** @type {'left'|'right'|'both'|undefined} */
  let tail;
  /** @type {number|undefined} */
  let critValue, critLow, critHigh;

  if (alternative === 'less') { tail = 'left'; critValue = tStat; }
  else if (alternative === 'greater') { tail = 'right'; critValue = tStat; }
  else { tail = 'both'; critLow = -Math.abs(tStat); critHigh = Math.abs(tStat); }

  const chart = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 't', yLabel: 'Density',
    titleText: `t distribution (df = ${df})`,
    descText: `t-distribution curve, shaded p-value area for paired t-test`,
    id: 'paired-t-chart',
    tail, critValue, critLow, critHigh,
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
