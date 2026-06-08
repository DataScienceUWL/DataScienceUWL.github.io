// @ts-check
/**
 * One-Way ANOVA inference page for StatLens.
 * Computes the F-test for equality of means across 3+ groups.
 * Always right-tailed (no alternative selector needed).
 */

import * as jstatModule from 'jstat';
import { setJStat, pdfF, fInv } from '../../js/distributions.js';
import { anovaF, anovaFSummary } from '../../js/inference.js';
import { drawCurve, computeDomain, addInferenceAnnotations } from '../../js/curve.js';
import { drawBoxplot } from '../../js/boxplot.js';
import { renderConditionsDiagnostic } from '../../js/conditions.js';
import { initTabs, initDataPanel, announce, initHelp, getActiveTabId, getTabHintText, buildSimLink, parseGroupSummary, setPageTitle } from '../../js/page-utils.js';
import { parseParams } from '../../js/url-params.js';
import { mean, sd, detectPrecision, formatStat } from '../../js/stats.js';
import { generateConclusions, findContext } from '../../js/conclusions.js';

initHelp();

/** Render LaTeX to HTML string via KaTeX. */
const tex = (/** @type {string} */ latex, display = false) =>
  katex.renderToString(latex, { throwOnError: false, displayMode: display });

const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── Initialize jStat ────────────────────────────────────────────────
const jStat = jstatModule.default || jstatModule;
setJStat(jStat);

// ── DOM elements ────────────────────────────────────────────────────
const chartContainer = document.getElementById('chart-container');
const resultDiv = document.getElementById('result-summary');
const conditionsCheckpoint = /** @type {HTMLElement} */ (document.getElementById('conditions-checkpoint'));
const dataSummary = document.getElementById('data-summary');
const dataPreview = document.getElementById('data-preview');
const varSelectorsDiv = document.getElementById('var-selectors');
const groupVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('group-var-select'));
const responseVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('response-var-select'));
const alphaSelect = /** @type {HTMLSelectElement} */ (document.getElementById('alpha-level'));
const numGroupsInput = /** @type {HTMLInputElement} */ (document.getElementById('num-groups'));
const groupFieldsets = document.getElementById('group-fieldsets');

// ── State ───────────────────────────────────────────────────────────

/** @type {Record<string, number[]>} */
let groupedData = {};
/** @type {string[]} */
let groupNames = [];
let dataPrecision = 1;

/** @type {{ headers: string[], types: string[], data: Array<Record<string,any>> } | null} */
let parsedCache = null;

let fromSummary = false;

/** @type {import('../../js/conclusions.js').ConclusionContext|null} */
let currentContext = null;
let currentSourceName = '';

// ── Initialization ──────────────────────────────────────────────────
initTabs({ hintTarget: resultDiv, hintAction: 'enter data to see results' });

const dataPanel = initDataPanel({
  autoCollapse: true, stickyControls: true, showPreview: true,
  // ANOVA requires a grouping variable with 3+ levels and >=3 obs per group
  // (REQ-024). 2-level datasets route to the two-sample t tool; single-record
  // groups (e.g. urban_owner) are excluded. Fields come from datasets.json.
  datasetFilter: ds => ds.hasNumeric && ds.hasCategorical && ds.groupLevels >= 3 && ds.minGroupN >= 3,
  onDataset: loadFromDataset,
  onText: loadFromParsed,
  onClear: clearData,
});

alphaSelect?.addEventListener('change', () => {
  if (groupNames.length >= 2) runAnalysis();
});

groupVarSelect?.addEventListener('change', reExtractGroups);
responseVarSelect?.addEventListener('change', reExtractGroups);

// ── Summary input ───────────────────────────────────────────────────

/** Build group fieldsets for summary input. */
function buildGroupFieldsets() {
  if (!groupFieldsets) return;
  const n = parseInt(numGroupsInput?.value ?? '3', 10) || 3;
  groupFieldsets.innerHTML = '';
  for (let i = 0; i < n; i++) {
    const fs = document.createElement('fieldset');
    fs.innerHTML = `
      <legend>Group ${i + 1}</legend>
      <label>Label:
        <input type="text" class="grp-label" value="Group ${i + 1}" placeholder="e.g., Treatment">
      </label>
      <label>n:
        <input type="number" class="grp-n" min="2" step="1" placeholder="30">
      </label>
      <label>Mean:
        <input type="number" class="grp-mean" step="any" placeholder="23.5">
      </label>
      <label>SD:
        <input type="number" class="grp-sd" min="0" step="any" placeholder="4.2">
      </label>
    `;
    groupFieldsets.appendChild(fs);
  }
}

buildGroupFieldsets();

numGroupsInput?.addEventListener('change', () => {
  let n = parseInt(numGroupsInput.value, 10) || 3;
  n = Math.max(2, Math.min(10, n));
  numGroupsInput.value = String(n);
  buildGroupFieldsets();
});

document.getElementById('add-group')?.addEventListener('click', () => {
  let n = parseInt(numGroupsInput?.value ?? '3', 10);
  if (n >= 10) return;
  n++;
  if (numGroupsInput) numGroupsInput.value = String(n);
  buildGroupFieldsets();
});

document.getElementById('remove-group')?.addEventListener('click', () => {
  let n = parseInt(numGroupsInput?.value ?? '3', 10);
  if (n <= 2) return;
  n--;
  if (numGroupsInput) numGroupsInput.value = String(n);
  buildGroupFieldsets();
});

const loadSummaryBtn = document.getElementById('load-summary');
if (loadSummaryBtn) {
  loadSummaryBtn.addEventListener('click', () => {
    if (!groupFieldsets) return;

    const labels = /** @type {HTMLInputElement[]} */ ([...groupFieldsets.querySelectorAll('.grp-label')]);
    const ns = /** @type {HTMLInputElement[]} */ ([...groupFieldsets.querySelectorAll('.grp-n')]);
    const means = /** @type {HTMLInputElement[]} */ ([...groupFieldsets.querySelectorAll('.grp-mean')]);
    const sds = /** @type {HTMLInputElement[]} */ ([...groupFieldsets.querySelectorAll('.grp-sd')]);

    /** @type {string[]} */
    const names = [];
    /** @type {number[]} */
    const nArr = [];
    /** @type {number[]} */
    const meanArr = [];
    /** @type {number[]} */
    const sdArr = [];

    for (let i = 0; i < labels.length; i++) {
      const label = labels[i].value.trim() || `Group ${i + 1}`;
      const n = parseInt(ns[i].value, 10);
      const m = parseFloat(means[i].value);
      const s = parseFloat(sds[i].value);

      if (!isFinite(n) || n < 2) { announce(`Group ${i + 1}: sample size must be at least 2.`); return; }
      if (!isFinite(m)) { announce(`Group ${i + 1}: enter a valid mean.`); return; }
      if (!isFinite(s) || s < 0) { announce(`Group ${i + 1}: enter a valid non-negative SD.`); return; }

      names.push(label);
      nArr.push(n);
      meanArr.push(m);
      sdArr.push(s);
    }

    if (names.length < 2) { announce('Need at least 2 groups.'); return; }

    loadFromSummaryStats(names, nArr, meanArr, sdArr);
  });
}

// ── Data loading ────────────────────────────────────────────────────

/**
 * @param {any} ds
 */
function loadFromDataset(ds) {
  if (!ds.rows || !ds.variables) return;

  currentSourceName = ds.name || '';
  const ctx = findContext(ds, 'anova');
  currentContext = ctx;

  const catVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'categorical');
  const numVars = ds.variables.filter(/** @param {any} v */ v => v.type === 'numeric');

  if (catVars.length === 0 || numVars.length === 0) {
    announce('This dataset needs at least one categorical and one numeric variable.');
    return;
  }

  const headers = ds.variables.map(/** @param {any} v */ v => v.name);
  const types = ds.variables.map(/** @param {any} v */ v => v.type);
  parsedCache = { headers, types, data: ds.rows };

  showVarSelectors(
    catVars.map(/** @param {any} v */ v => v.name),
    numVars.map(/** @param {any} v */ v => v.name)
  );

  // Auto-select from context
  if (ctx?.groupVar && groupVarSelect) groupVarSelect.value = ctx.groupVar;
  if (ctx?.responseVar && responseVarSelect) responseVarSelect.value = ctx.responseVar;

  extractGroups();
}

/**
 * @param {{ headers: string[], types: string[], data: Array<Record<string,any>> }} parsed
 * @param {string} _sourceName
 */
function loadFromParsed(parsed, _sourceName) {
  currentSourceName = '';
  currentContext = null;

  const catCols = parsed.headers.filter((_, i) => parsed.types[i] === 'categorical');
  const numCols = parsed.headers.filter((_, i) => parsed.types[i] === 'numeric');

  if (catCols.length === 0 || numCols.length === 0) {
    announce('Data needs at least one categorical column (groups) and one numeric column (values).');
    return;
  }

  parsedCache = parsed;
  showVarSelectors(catCols, numCols);
  extractGroups();
}

/**
 * @param {string[]} catCols
 * @param {string[]} numCols
 */
function showVarSelectors(catCols, numCols) {
  if (!varSelectorsDiv || !groupVarSelect || !responseVarSelect) return;

  const needSelector = catCols.length > 1 || numCols.length > 1;

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

  varSelectorsDiv.hidden = !needSelector;
}

function reExtractGroups() {
  extractGroups();
}

function extractGroups() {
  if (!parsedCache || !groupVarSelect || !responseVarSelect) return;

  const groupCol = groupVarSelect.value;
  const valCol = responseVarSelect.value;
  if (!groupCol || !valCol) return;

  /** @type {Record<string, number[]>} */
  const groups = {};
  /** @type {string[]} */
  const names = [];

  for (const row of parsedCache.data) {
    const g = String(row[groupCol]);
    const v = parseFloat(row[valCol]);
    if (!isFinite(v)) continue;
    if (!groups[g]) {
      groups[g] = [];
      names.push(g);
    }
    groups[g].push(v);
  }

  if (names.length < 2) {
    announce('The grouping variable must have at least two levels.');
    return;
  }

  groupedData = groups;
  groupNames = names;
  fromSummary = false;
  dataPrecision = detectPrecision(names.flatMap(n => groups[n]));

  showDataSummary();
  runAnalysis();
}

function showDataSummary() {
  if (dataSummary) {
    const totalN = groupNames.reduce((s, n) => s + groupedData[n].length, 0);
    const namePrefix = currentSourceName ? `${currentSourceName}: ` : '';
    dataSummary.textContent = `${namePrefix}${groupNames.length} groups, N = ${totalN}`;
  }
  // Update H₀ with actual group names
  const h0Text = document.getElementById('h0-text');
  if (h0Text && groupNames.length >= 2) {
    const muList = groupNames.map(name => `μ<sub>${name}</sub>`).join(' = ');
    h0Text.innerHTML = `${muList} (all ${groupNames.length} group means are equal)`;
  }
}

function clearData() {
  groupedData = {};
  groupNames = [];
  parsedCache = null;
  fromSummary = false;
  currentContext = null;
  currentSourceName = '';
  if (dataPreview) dataPreview.hidden = true;
  if (varSelectorsDiv) varSelectorsDiv.hidden = true;
  if (chartContainer) chartContainer.innerHTML = '';
  if (conditionsCheckpoint) conditionsCheckpoint.hidden = true;
  if (resultDiv) {
    resultDiv.innerHTML = `<p class="placeholder">${getTabHintText(getActiveTabId(), 'enter data to see results')}</p>`;
  }
}

// ── Analysis ────────────────────────────────────────────────────────

function getAlpha() {
  return parseFloat(alphaSelect?.value ?? '0.05');
}

function runAnalysis() {
  if (groupNames.length < 2) return;

  const groupArrays = groupNames.map(n => groupedData[n]);
  const result = anovaF(groupArrays, groupNames);

  renderChart(result);
  renderResults(result);
  showConditionsCheckpoint();
  announceResult(result);
}

// ── Conditions checkpoint ────────────────────────────────────────────

/**
 * Show an expandable "Check Conditions" panel with inline diagnostic plots.
 * Does NOT auto-diagnose — students view the plots and decide for themselves.
 */
function showConditionsCheckpoint() {
  if (!conditionsCheckpoint) return;

  const dsId = dataPanel.currentDatasetId;
  const simLink = dsId
    ? buildSimLink('simulate/randomization-anova/', { dataset: dsId })
    : buildSimLink('simulate/randomization-anova/');

  const hasRawData = !fromSummary && Object.keys(groupedData).length > 0;

  conditionsCheckpoint.innerHTML = `
    <p>${hasRawData
      ? '<button type="button" class="conditions-toggle" aria-expanded="false" aria-controls="conditions-panel">Check Conditions</button>'
      : '<strong>Check Conditions</strong> (no raw data available for diagnostic plots)'}
    &nbsp; | &nbsp; Alternative: <a href="${simLink}">ANOVA Randomization Test</a> (no conditions required).</p>
    ${hasRawData ? '<div id="conditions-panel" class="conditions-panel" hidden><div id="conditions-chart"></div>' +
      (dsId ? `<p class="hint" style="margin-top:0.5rem">For further investigation, <a href="${buildSimLink('explore/grouped/', { dataset: dsId })}" target="_blank" rel="noopener">explore this dataset</a> in a new tab.</p>` : '') +
      '</div>' : ''}`;
  conditionsCheckpoint.hidden = false;

  // Wire up toggle
  const toggle = conditionsCheckpoint.querySelector('.conditions-toggle');
  const panel = conditionsCheckpoint.querySelector('#conditions-panel');
  const chartEl = conditionsCheckpoint.querySelector('#conditions-chart');
  if (toggle && panel && chartEl) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      panel.hidden = expanded;
      if (!expanded && chartEl.children.length === 0) {
        renderConditionsChart(/** @type {HTMLElement} */ (chartEl));
      }
    });
  }
}

/**
 * Render diagnostic plots into the conditions panel.
 * @param {HTMLElement} container
 */
function renderConditionsChart(container) {
  if (Object.keys(groupedData).length === 0) return;
  const responseVar = responseVarSelect?.value || '';

  renderConditionsDiagnostic(container, groupedData, {
    varName: responseVar,
    context: 'anova',
  });
}

// ── Chart rendering ─────────────────────────────────────────────────

/**
 * @param {import('../../js/inference.js').AnovaResult} r
 */
function renderChart(r) {
  if (!chartContainer) return;
  chartContainer.innerHTML = '';

  if (!isFinite(r.fStat) || r.dfBetween <= 0 || r.dfWithin <= 0) return;

  const dfB = r.dfBetween;
  const dfW = r.dfWithin;
  const pdfFn = /** @param {number} x */ (x) => pdfF(x, dfB, dfW);
  const domain = computeDomain('F', { invCdf: (/** @type {number} */ p) => fInv(p, dfB, dfW) });

  const chart = drawCurve(chartContainer, pdfFn, domain, {
    xLabel: 'F',
    yLabel: 'Density',
    titleText: `F-distribution (df\u2081 = ${dfB}, df\u2082 = ${dfW})`,
    descText: `ANOVA F-test: F = ${r.fStat.toFixed(3)}, shaded area = p-value`,
    id: 'anova-f-curve',
    tail: 'right',
    critValue: r.fStat,
  });

  addInferenceAnnotations(chart, {
    statValue: r.fStat,
    statLabel: 'F',
    pValue: r.pValue,
    pdfFn,
    tail: 'right',
  });

}


// ── Results rendering ───────────────────────────────────────────────

/**
 * @param {import('../../js/inference.js').AnovaResult} r
 */
function renderResults(r) {
  if (!resultDiv) return;
  const totalN = r.groupNs.reduce((a, b) => a + b, 0);
  setPageTitle(baseTitle, dataPanel.currentSourceName, { n: totalN });

  const d = dataPrecision;
  const alpha = getAlpha();
  const pStr = formatStat(r.pValue, d, 'pvalue');

  // Group summary table
  const groupRows = r.groupNames.map((name, i) =>
    `<tr><td>${esc(name)}</td><td>${r.groupNs[i]}</td><td>${formatStat(r.groupMeans[i], d)}</td><td>${formatStat(r.groupSDs[i], d)}</td></tr>`
  ).join('');

  // ANOVA decomposition table
  const anovaTable = `
    <div class="anova-table-container">
      <table class="anova-table" aria-label="ANOVA decomposition table">
        <thead>
          <tr><th>Source</th><th>df</th><th>SS</th><th>MS</th><th>F</th><th>p-value</th></tr>
        </thead>
        <tbody>
          <tr>
            <td class="source-col">Between</td>
            <td>${r.dfBetween}</td>
            <td>${formatStat(r.ssBetween, d)}</td>
            <td>${formatStat(r.msBetween, d)}</td>
            <td>${formatStat(r.fStat, d)}</td>
            <td>${pStr}</td>
          </tr>
          <tr>
            <td class="source-col">Within</td>
            <td>${r.dfWithin}</td>
            <td>${formatStat(r.ssWithin, d)}</td>
            <td>${formatStat(r.msWithin, d)}</td>
            <td></td>
            <td></td>
          </tr>
          <tr>
            <td class="source-col">Total</td>
            <td>${r.dfBetween + r.dfWithin}</td>
            <td>${formatStat(r.ssTotal, d)}</td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  `;

  // F formula via KaTeX
  const V = '\\textcolor{#569BBD}';
  const S = '\\textcolor{#7B2D8E}';
  const P = '\\textcolor{#2e7d32}';

  const fFormula = tex(`\\begin{aligned}
    F &= \\frac{\\text{MS}_{\\text{between}}}{\\text{MS}_{\\text{within}}}
    = \\frac{${V}{${formatStat(r.msBetween, d)}}}{${V}{${formatStat(r.msWithin, d)}}}
    = ${S}{${formatStat(r.fStat, d)}}
  \\end{aligned}`, true);

  // Conclusions
  const conclusions = generateConclusions({
    pValue: r.pValue,
    alpha,
    testType: 'anova',
    statName: 'F',
    statValue: formatStat(r.fStat, d),
    context: {
      parameter: currentContext?.parameter,
      claim: currentContext?.claim,
    },
  });

  // Suggest two-means if only 2 groups
  const twoGroupNote = r.groupNames.length === 2
    ? '<p class="hint"><strong>Note:</strong> With only 2 groups, a <a href="../two-means/">two-sample t-test</a> is equivalent and provides a confidence interval for the difference in means.</p>'
    : '';

  resultDiv.innerHTML = `
    <h3>Group Summaries</h3>
    <table class="results-table" aria-label="Group summary statistics">
      <thead>
        <tr><th>Group</th><th>${tex('n')}</th><th>${tex('\\bar{x}')}</th><th>${tex('s')}</th></tr>
      </thead>
      <tbody>${groupRows}</tbody>
    </table>

    <div class="formula-display">
      <h3>ANOVA Table</h3>
      ${anovaTable}
    </div>

    <div class="formula-display">
      <h3>F Statistic</h3>
      ${fFormula}
      <p class="formula-detail">${tex(`\\text{df}_{\\text{between}} = ${P}{${r.dfBetween}}, \\quad \\text{df}_{\\text{within}} = ${P}{${r.dfWithin}}`)}</p>
      <p class="formula-detail">${tex(`\\text{p-value} = ${P}{${pStr}}`)}</p>
    </div>

    <div class="interpretation">
      <p><strong>Formal conclusion:</strong> ${conclusions.formal}</p>
      ${conclusions.practical ? `<p><strong>Practical conclusion:</strong> ${conclusions.practical}</p>` : ''}
    </div>
    ${twoGroupNote}
  `;
}

/**
 * @param {import('../../js/inference.js').AnovaResult} r
 */
function announceResult(r) {
  const pStr = formatStat(r.pValue, dataPrecision, 'pvalue');
  announce(
    `ANOVA: F = ${formatStat(r.fStat, dataPrecision)}, df = (${r.dfBetween}, ${r.dfWithin}), ${pStr}.`
  );
}

// ── Load from summary stats (shared by button + URL) ────────────────

/**
 * Load ANOVA from pre-computed group summaries.
 * @param {string[]} names
 * @param {number[]} nArr
 * @param {number[]} meanArr
 * @param {number[]} sdArr
 */
function loadFromSummaryStats(names, nArr, meanArr, sdArr) {
  fromSummary = true;
  parsedCache = null;
  currentContext = null;
  groupedData = {};
  groupNames = names;
  if (varSelectorsDiv) varSelectorsDiv.hidden = true;
  if (dataPreview) dataPreview.hidden = true;

  dataPrecision = Math.max(
    ...meanArr.concat(sdArr).map(v => {
      const str = String(v);
      const dot = str.indexOf('.');
      return dot === -1 ? 0 : str.length - dot - 1;
    })
  );

  const result = anovaFSummary(meanArr, sdArr, nArr, names);
  renderChart(result);
  renderResults(result);
  showConditionsCheckpoint();
  announce(`Loaded summary: ${names.length} groups.`);
}

// ── URL parameter auto-load ─────────────────────────────────────────

dataPanel.ready.then(() => {
  const params = parseParams();

  // ?alpha= sets significance level
  if (params.alpha != null && alphaSelect) {
    const a = String(params.alpha);
    if ([...alphaSelect.options].some(o => o.value === a)) {
      alphaSelect.value = a;
    }
  }

  // ?group= and ?response= set variable selectors (for dataset loads)
  if (params.group && groupVarSelect) {
    const opt = [...groupVarSelect.options].find(o => o.value === params.group);
    if (opt) {
      groupVarSelect.value = params.group;
      if (params.response && responseVarSelect) {
        const rOpt = [...responseVarSelect.options].find(o => o.value === params.response);
        if (rOpt) responseVarSelect.value = params.response;
      }
      extractGroups();
    }
  }

  // ?summary= auto-loads summary stats (overrides dataset)
  if (params.summary) {
    const parsed = parseGroupSummary(params.summary);
    if (parsed) {
      loadFromSummaryStats(parsed.labels, parsed.ns, parsed.means, parsed.sds);

      // Collapse data panel since we auto-loaded
      const dataPanelEl = document.getElementById('data-panel');
      if (dataPanelEl) dataPanelEl.hidden = true;
    }
  }
});

// ── Utility ─────────────────────────────────────────────────────────

/**
 * @param {string} s
 * @returns {string}
 */
function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
