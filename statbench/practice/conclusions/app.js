// @ts-check
/**
 * Conclusion Practice — Mad Libs fill-in-the-blank edition.
 *
 * Presents hypothesis test results and has students complete
 * structured conclusions via dropdowns and radio-button claim selection.
 */

import { generateConclusions, evidenceStrength } from '../../js/conclusions.js';
import { initHelp } from '../../js/page-utils.js';

initHelp();

// Wait for KaTeX to load (deferred script)
await new Promise((resolve) => {
  if (typeof katex !== 'undefined') return resolve(undefined);
  const check = setInterval(() => {
    if (typeof katex !== 'undefined') { clearInterval(check); resolve(undefined); }
  }, 50);
});

/** Render LaTeX to HTML string. */
function tex(latex, display = false) {
  return katex.renderToString(latex, { throwOnError: false, displayMode: display });
}

// Wait for jStat so we can compute test results
const jstatMod = await import('jstat');
const jStat = jstatMod.default || jstatMod;

// ── DOM references ──────────────────────────────────────────────────
const scenarioCard = /** @type {HTMLElement} */ (document.getElementById('scenario-card'));
const scenarioCounter = /** @type {HTMLElement} */ (document.getElementById('scenario-counter'));
const scoreDisplay = /** @type {HTMLElement} */ (document.getElementById('score-display'));
const claimSection = /** @type {HTMLElement} */ (document.getElementById('claim-section'));
const claimOptionsList = /** @type {HTMLElement} */ (document.getElementById('claim-options'));
const claimFeedback = /** @type {HTMLElement} */ (document.getElementById('claim-feedback'));
const formalSection = /** @type {HTMLElement} */ (document.getElementById('formal-section'));
const formalSentence = /** @type {HTMLElement} */ (document.getElementById('formal-sentence'));
const formalFeedback = /** @type {HTMLElement} */ (document.getElementById('formal-feedback'));
const practicalSection = /** @type {HTMLElement} */ (document.getElementById('practical-section'));
const practicalSentence = /** @type {HTMLElement} */ (document.getElementById('practical-sentence'));
const practicalFeedback = /** @type {HTMLElement} */ (document.getElementById('practical-feedback'));
const actionButtons = /** @type {HTMLElement} */ (document.getElementById('action-buttons'));
const checkBtn = /** @type {HTMLButtonElement} */ (document.getElementById('check-answer'));
const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById('next-scenario'));
const scoreSummary = /** @type {HTMLElement} */ (document.getElementById('score-summary'));
const srAnnounce = document.getElementById('sr-announce');

/** @param {string} msg */
function announce(msg) {
  if (srAnnounce) { srAnnounce.textContent = ''; requestAnimationFrame(() => { srAnnounce.textContent = msg; }); }
}

// ── Score tracking ──────────────────────────────────────────────────
let totalBlanks = 0;
let correctBlanks = 0;
let scenariosAttempted = 0;

function updateScoreDisplay() {
  if (!scoreDisplay) return;
  if (scenariosAttempted === 0) { scoreDisplay.textContent = ''; return; }
  scoreDisplay.textContent = `${correctBlanks}/${totalBlanks} blanks correct across ${scenariosAttempted} scenarios`;
}

// ── Scenario types ──────────────────────────────────────────────────

/**
 * @typedef {Object} Scenario
 * @property {string} datasetName
 * @property {string} testType
 * @property {string} hypotheses - HTML string with rendered math
 * @property {string} resultsDisplay - HTML string with rendered math
 * @property {number} pValue
 * @property {number} alpha
 * @property {string} alternative
 * @property {string} statName
 * @property {string} statValue
 * @property {string} [parameter]
 * @property {number|string} [nullValue]
 * @property {string} [claim]
 * @property {Object} ctx - raw inferenceContext for distractor generation
 */

/** @type {Scenario[]} */
let scenarios = [];
let currentIndex = 0;

// ── Statistical computations ────────────────────────────────────────

/**
 * @param {number[]} arr
 * @returns {{ mean: number, sd: number, n: number }}
 */
function basicStats(arr) {
  const n = arr.length;
  const mean = arr.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(arr.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1));
  return { mean, sd, n };
}

function tTest(xbar, s, n, mu0, alt) {
  const se = s / Math.sqrt(n);
  const t = (xbar - mu0) / se;
  const df = n - 1;
  let p;
  if (alt === 'less') p = jStat.studentt.cdf(t, df);
  else if (alt === 'greater') p = 1 - jStat.studentt.cdf(t, df);
  else p = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));
  return { t, df, p, se };
}

function welchT(x1, s1, n1, x2, s2, n2, alt) {
  const se = Math.sqrt(s1 ** 2 / n1 + s2 ** 2 / n2);
  const t = (x1 - x2) / se;
  const num = (s1 ** 2 / n1 + s2 ** 2 / n2) ** 2;
  const den = (s1 ** 2 / n1) ** 2 / (n1 - 1) + (s2 ** 2 / n2) ** 2 / (n2 - 1);
  const df = num / den;
  let p;
  if (alt === 'less') p = jStat.studentt.cdf(t, df);
  else if (alt === 'greater') p = 1 - jStat.studentt.cdf(t, df);
  else p = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));
  return { t, df: Math.round(df * 10) / 10, p, se };
}

function propZ(x, n, p0, alt) {
  const pHat = x / n;
  const se = Math.sqrt(p0 * (1 - p0) / n);
  const z = (pHat - p0) / se;
  let p;
  if (alt === 'less') p = jStat.normal.cdf(z, 0, 1);
  else if (alt === 'greater') p = 1 - jStat.normal.cdf(z, 0, 1);
  else p = 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1));
  return { z, p, pHat, se };
}

// ── Hypothesis and results formatting with KaTeX ────────────────────

/**
 * @param {string} param - LaTeX parameter symbol
 * @param {number|string} nullVal
 * @param {string} alt
 * @returns {string} HTML
 */
function buildHypotheses(param, nullVal, alt) {
  const sym = alt === 'less' ? '<' : alt === 'greater' ? '>' : '\\neq';
  const h0 = tex(`H_0: ${param} = ${nullVal}`);
  const ha = tex(`H_a: ${param} ${sym} ${nullVal}`);
  return `${h0}<br>${ha}`;
}

/** @param {number} p */
function fmtP(p) {
  if (p < 0.0001) return '< 0.0001';
  return p.toFixed(4);
}

// ── Build scenario from dataset ─────────────────────────────────────

function buildScenario(ds, ctx) {
  const rows = ds.rows;
  const alpha = 0.05;

  /** @type {Partial<Scenario>} */
  const base = { datasetName: ds.name, alpha, ctx };

  if (ctx.test === 'one-mean') {
    const vals = rows.map(/** @param {any} r */ r => Number(r[ctx.response])).filter(isFinite);
    if (vals.length < 3) return null;
    const { mean, sd, n } = basicStats(vals);
    const res = tTest(mean, sd, n, ctx.nullValue, ctx.alternative);
    return {
      ...base, testType: 'one-mean',
      hypotheses: buildHypotheses('\\mu', ctx.nullValue, ctx.alternative),
      resultsDisplay: `${tex('n')} = ${n}, &ensp;${tex('\\bar{x}')} = ${mean.toFixed(2)}, &ensp;${tex('s')} = ${sd.toFixed(2)}<br>${tex('t')} = ${res.t.toFixed(3)}, &ensp;${tex('\\text{df}')} = ${res.df}, &ensp;p-value = ${fmtP(res.p)}`,
      pValue: res.p, alternative: ctx.alternative,
      statName: 't', statValue: res.t.toFixed(3),
      parameter: ctx.parameter, nullValue: ctx.nullValue, claim: ctx.claim,
    };
  }

  if (ctx.test === 'paired') {
    const diffs = [];
    for (const row of rows) {
      const v1 = Number(row[ctx.var1]);
      const v2 = Number(row[ctx.var2]);
      if (isFinite(v1) && isFinite(v2)) diffs.push(v1 - v2);
    }
    if (diffs.length < 3) return null;
    const { mean, sd, n } = basicStats(diffs);
    const mu0 = ctx.nullValue ?? 0;
    const res = tTest(mean, sd, n, mu0, ctx.alternative);
    return {
      ...base, testType: 'paired',
      hypotheses: buildHypotheses('\\mu_d', mu0, ctx.alternative),
      resultsDisplay: `${tex('n')} = ${n} pairs, &ensp;${tex('\\bar{d}')} = ${mean.toFixed(2)}, &ensp;${tex('s_d')} = ${sd.toFixed(2)}<br>${tex('t')} = ${res.t.toFixed(3)}, &ensp;${tex('\\text{df}')} = ${res.df}, &ensp;p-value = ${fmtP(res.p)}`,
      pValue: res.p, alternative: ctx.alternative,
      statName: 't', statValue: res.t.toFixed(3),
      parameter: ctx.parameter, nullValue: mu0, claim: ctx.claim,
    };
  }

  if (ctx.test === 'two-means') {
    const groupCol = ctx.groupVar;
    const valCol = ctx.responseVar;
    const groups = [...new Set(rows.map(/** @param {any} r */ r => r[groupCol]))];
    if (groups.length < 2) return null;
    const g1 = rows.filter(/** @param {any} r */ r => r[groupCol] === groups[0]).map(/** @param {any} r */ r => Number(r[valCol])).filter(isFinite);
    const g2 = rows.filter(/** @param {any} r */ r => r[groupCol] === groups[1]).map(/** @param {any} r */ r => Number(r[valCol])).filter(isFinite);
    if (g1.length < 2 || g2.length < 2) return null;
    const s1 = basicStats(g1);
    const s2 = basicStats(g2);
    const res = welchT(s1.mean, s1.sd, s1.n, s2.mean, s2.sd, s2.n, ctx.alternative);
    return {
      ...base, testType: 'two-means',
      hypotheses: buildHypotheses('\\mu_1 - \\mu_2', 0, ctx.alternative),
      resultsDisplay: `${groups[0]}: ${tex('n')}=${s1.n}, ${tex('\\bar{x}')}=${s1.mean.toFixed(2)} &ensp;|&ensp; ${groups[1]}: ${tex('n')}=${s2.n}, ${tex('\\bar{x}')}=${s2.mean.toFixed(2)}<br>${tex('t')} = ${res.t.toFixed(3)}, &ensp;${tex('\\text{df}')} = ${res.df}, &ensp;p-value = ${fmtP(res.p)}`,
      pValue: res.p, alternative: ctx.alternative,
      statName: 't', statValue: res.t.toFixed(3),
      parameter: ctx.parameter, nullValue: 0, claim: ctx.claim,
    };
  }

  if (ctx.test === 'one-prop') {
    const vals = rows.map(/** @param {any} r */ r => String(r[ctx.variable]));
    const n = vals.length;
    const x = vals.filter(v => v === ctx.successLabel).length;
    if (n < 5) return null;
    const res = propZ(x, n, ctx.nullValue, ctx.alternative);
    return {
      ...base, testType: 'one-prop',
      hypotheses: buildHypotheses('p', ctx.nullValue, ctx.alternative),
      resultsDisplay: `${tex('n')} = ${n}, &ensp;successes = ${x}, &ensp;${tex('\\hat{p}')} = ${res.pHat.toFixed(4)}<br>${tex('z')} = ${res.z.toFixed(3)}, &ensp;p-value = ${fmtP(res.p)}`,
      pValue: res.p, alternative: ctx.alternative,
      statName: 'z', statValue: res.z.toFixed(3),
      parameter: ctx.parameter, nullValue: ctx.nullValue, claim: ctx.claim,
    };
  }

  if (ctx.test === 'two-props') {
    const groupCol = ctx.groupVar;
    const outcomeCol = ctx.responseVar;
    const groups = [...new Set(rows.map(/** @param {any} r */ r => r[groupCol]))];
    if (groups.length < 2) return null;
    const g1Rows = rows.filter(/** @param {any} r */ r => r[groupCol] === groups[0]);
    const g2Rows = rows.filter(/** @param {any} r */ r => r[groupCol] === groups[1]);
    const x1 = g1Rows.filter(/** @param {any} r */ r => r[outcomeCol] === ctx.successLabel).length;
    const x2 = g2Rows.filter(/** @param {any} r */ r => r[outcomeCol] === ctx.successLabel).length;
    const n1 = g1Rows.length;
    const n2 = g2Rows.length;
    const pPool = (x1 + x2) / (n1 + n2);
    const se = Math.sqrt(pPool * (1 - pPool) * (1 / n1 + 1 / n2));
    const z = (x1 / n1 - x2 / n2) / se;
    let p;
    if (ctx.alternative === 'less') p = jStat.normal.cdf(z, 0, 1);
    else if (ctx.alternative === 'greater') p = 1 - jStat.normal.cdf(z, 0, 1);
    else p = 2 * (1 - jStat.normal.cdf(Math.abs(z), 0, 1));
    return {
      ...base, testType: 'two-props',
      hypotheses: buildHypotheses('p_1 - p_2', 0, ctx.alternative),
      resultsDisplay: `${groups[0]}: ${x1}/${n1} &ensp;|&ensp; ${groups[1]}: ${x2}/${n2}<br>${tex('z')} = ${z.toFixed(3)}, &ensp;p-value = ${fmtP(p)}`,
      pValue: p, alternative: ctx.alternative,
      statName: 'z', statValue: z.toFixed(3),
      parameter: ctx.parameter, nullValue: 0, claim: ctx.claim,
    };
  }

  if (ctx.test === 'chisq') {
    const rVar = ctx.rowVar;
    const cVar = ctx.colVar;
    const rCats = /** @type {string[]} */ ([]);
    const cCats = /** @type {string[]} */ ([]);
    /** @type {Map<string, Map<string, number>>} */
    const table = new Map();
    for (const r of rows) {
      const rv = String(r[rVar]);
      const cv = String(r[cVar]);
      if (!rCats.includes(rv)) rCats.push(rv);
      if (!cCats.includes(cv)) cCats.push(cv);
      if (!table.has(rv)) table.set(rv, new Map());
      const rm = /** @type {Map<string,number>} */ (table.get(rv));
      rm.set(cv, (rm.get(cv) ?? 0) + 1);
    }
    const observed = rCats.map(rv => cCats.map(cv => table.get(rv)?.get(cv) ?? 0));
    const n = rows.length;
    const nR = rCats.length;
    const nC = cCats.length;
    const df = (nR - 1) * (nC - 1);
    const rowTotals = observed.map(r => r.reduce((a, b) => a + b, 0));
    const colTotals = Array.from({ length: nC }, (_, j) => observed.reduce((s, r) => s + r[j], 0));
    let chiSq = 0;
    for (let i = 0; i < nR; i++) {
      for (let j = 0; j < nC; j++) {
        const exp = rowTotals[i] * colTotals[j] / n;
        chiSq += (observed[i][j] - exp) ** 2 / exp;
      }
    }
    const p = 1 - jStat.chisquare.cdf(chiSq, df);
    const h0 = tex(`H_0\\text{: ${rVar} and ${cVar} are independent}`);
    const ha = tex(`H_a\\text{: There is an association between ${rVar} and ${cVar}}`);
    return {
      ...base, testType: 'chisq',
      hypotheses: `${h0}<br>${ha}`,
      resultsDisplay: `${nR} \u00D7 ${nC} table, &ensp;${tex('n')} = ${n}<br>${tex('\\chi^2')} = ${chiSq.toFixed(3)}, &ensp;${tex('\\text{df}')} = ${df}, &ensp;p-value = ${fmtP(p)}`,
      pValue: p, alternative: 'greater',
      statName: '\u03C7\u00B2', statValue: chiSq.toFixed(3),
      parameter: ctx.parameter, claim: ctx.claim,
    };
  }

  return null;
}

// ── Distractor generation ───────────────────────────────────────────

/**
 * Generate 4 claim options: 1 correct + 3 distractors.
 * Returns array of {text, type} where type is 'correct', 'null', 'sample', 'proof'.
 * @param {Scenario} s
 * @returns {{text: string, type: string}[]}
 */
function generateClaimOptions(s) {
  const ctx = s.ctx;
  const testType = s.testType;
  const claim = s.claim || '';
  const parameter = s.parameter || '';

  /** @type {{text: string, type: string}[]} */
  const options = [];

  // Correct claim — always "that [claim]"
  options.push({ text: `that ${claim}`, type: 'correct' });

  if (testType === 'one-mean') {
    // Null-as-conclusion: states null as if true
    options.push({
      text: `that ${parameter} is ${ctx.nullValue}`,
      type: 'null'
    });
    // Sample language
    const sampleStat = parameter.replace(/population mean/i, 'sample mean').replace(/^the population /, 'the sample ');
    const dir = ctx.alternative === 'less' ? 'less than'
      : ctx.alternative === 'greater' ? 'greater than' : 'different from';
    options.push({
      text: `that ${sampleStat} is ${dir} ${ctx.nullValue}`,
      type: 'sample'
    });
    // Proof language
    options.push({
      text: `that we proved ${claim}`,
      type: 'proof'
    });
  } else if (testType === 'paired') {
    const mu0 = ctx.nullValue ?? 0;
    options.push({
      text: `that ${parameter} is ${mu0}`,
      type: 'null'
    });
    const sampleParam = parameter.replace(/population mean/i, 'sample mean').replace(/^the population /, 'the sample ');
    const dir = ctx.alternative === 'less' ? 'less than'
      : ctx.alternative === 'greater' ? 'greater than' : 'different from';
    options.push({
      text: `that ${sampleParam} is ${dir} ${mu0}`,
      type: 'sample'
    });
    options.push({
      text: `that we proved ${claim}`,
      type: 'proof'
    });
  } else if (testType === 'one-prop') {
    options.push({
      text: `that ${parameter} is ${ctx.nullValue}`,
      type: 'null'
    });
    const sampleParam = parameter.replace(/population proportion/i, 'sample proportion')
      .replace(/true proportion/i, 'sample proportion')
      .replace(/true complication rate/i, 'sample complication rate')
      .replace(/^the population /, 'the sample ');
    const dir = ctx.alternative === 'less' ? 'less than'
      : ctx.alternative === 'greater' ? 'greater than' : 'different from';
    options.push({
      text: `that ${sampleParam} is ${dir} ${ctx.nullValue}`,
      type: 'sample'
    });
    options.push({
      text: `that we proved ${claim}`,
      type: 'proof'
    });
  } else if (testType === 'two-means') {
    options.push({
      text: `that there is no difference in population means between the groups`,
      type: 'null'
    });
    options.push({
      text: `that the sample means are different between the groups`,
      type: 'sample'
    });
    // Causal language for two-means (often experiments)
    const groups = extractGroups(ctx);
    options.push({
      text: `that ${groups.g1} causes a change in the response compared to ${groups.g2}`,
      type: 'proof'
    });
  } else if (testType === 'two-props') {
    options.push({
      text: `that there is no difference in population proportions between the groups`,
      type: 'null'
    });
    options.push({
      text: `that the sample proportions are different between the groups`,
      type: 'sample'
    });
    const groups = extractGroups(ctx);
    options.push({
      text: `that ${groups.g1} causes a change in the outcome compared to ${groups.g2}`,
      type: 'proof'
    });
  } else if (testType === 'chisq') {
    const rVar = ctx.rowVar || 'variable 1';
    const cVar = ctx.colVar || 'variable 2';
    options.push({
      text: `that ${rVar} and ${cVar} are independent`,
      type: 'null'
    });
    options.push({
      text: `that in our sample, ${rVar} and ${cVar} are related`,
      type: 'sample'
    });
    options.push({
      text: `that ${rVar} causes changes in ${cVar}`,
      type: 'proof'
    });
  } else {
    // Fallback distractors
    options.push({ text: `that the null hypothesis is true`, type: 'null' });
    options.push({ text: `that the sample statistic differs from the null value`, type: 'sample' });
    options.push({ text: `that we proved the alternative hypothesis`, type: 'proof' });
  }

  return options;
}

/**
 * Extract group names from context.
 * @param {any} ctx
 * @returns {{g1: string, g2: string}}
 */
function extractGroups(ctx) {
  return {
    g1: ctx.group1 || 'group 1',
    g2: ctx.group2 || 'group 2',
  };
}

// ── Evidence strength acceptance ────────────────────────────────────

/**
 * The ordered scale of evidence strength labels.
 * evidenceStrength() returns: 'very strong', 'strong', 'moderate', 'weak', 'little to no'
 */
const STRENGTH_SCALE = ['very strong', 'strong', 'moderate', 'weak', 'little to no'];

/**
 * Map from dropdown values to scale entries.
 * The dropdown has: strong, moderate, weak, no
 * The evidenceStrength function returns: very strong, strong, moderate, weak, little to no
 */
const DROPDOWN_TO_SCALE = {
  'strong': ['very strong', 'strong'],
  'moderate': ['moderate'],
  'weak': ['weak'],
  'no': ['little to no'],
};

/**
 * Check if a selected strength is acceptable given the best answer.
 * Accepts the best answer and one adjacent level.
 * @param {string} selected - dropdown value: 'strong'|'moderate'|'weak'|'no'
 * @param {string} best - from evidenceStrength(): 'very strong'|'strong'|'moderate'|'weak'|'little to no'
 * @returns {boolean}
 */
function isStrengthAcceptable(selected, best) {
  const bestIdx = STRENGTH_SCALE.indexOf(best);
  // Get all scale values the dropdown selection covers
  const selectedScaleValues = DROPDOWN_TO_SCALE[selected] || [];

  // Check if the selected value directly matches
  if (selectedScaleValues.includes(best)) return true;

  // Accept adjacent: if the best is at index i, accept i-1 or i+1
  for (const sv of selectedScaleValues) {
    const svIdx = STRENGTH_SCALE.indexOf(sv);
    if (Math.abs(svIdx - bestIdx) <= 1) return true;
  }

  return false;
}

/**
 * Get the best dropdown value for a given evidenceStrength result.
 * @param {string} strength - from evidenceStrength()
 * @returns {string} dropdown value
 */
function strengthToDropdown(strength) {
  if (strength === 'very strong' || strength === 'strong') return 'strong';
  if (strength === 'moderate') return 'moderate';
  if (strength === 'weak') return 'weak';
  return 'no';
}

// ── Load all datasets with contexts ─────────────────────────────────

async function loadScenarios() {
  try {
    const resp = await fetch('../../data/datasets.json');
    const index = await resp.json();

    const built = [];
    for (const meta of index) {
      try {
        const dsResp = await fetch(`../../data/${meta.id}.json`);
        const ds = await dsResp.json();
        if (!ds.inferenceContexts) continue;
        for (const ctx of ds.inferenceContexts) {
          const scenario = buildScenario(ds, ctx);
          if (scenario && scenario.claim) built.push(scenario);
        }
      } catch { /* skip failed loads */ }
    }

    scenarios = shuffle(built);
    if (scenarios.length === 0) {
      scenarioCard.innerHTML = '<p>No scenarios available. Check that datasets have inferenceContexts with claims.</p>';
      return;
    }
    showScenario(0);
  } catch (err) {
    scenarioCard.innerHTML = `<p>Error loading scenarios: ${/** @type {Error} */ (err).message}</p>`;
  }
}

/** Fisher-Yates shuffle. @param {any[]} arr */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Display scenario ────────────────────────────────────────────────

/** @param {number} idx */
function showScenario(idx) {
  currentIndex = idx;
  const s = scenarios[idx % scenarios.length];

  scenarioCounter.textContent = `Scenario ${(idx % scenarios.length) + 1} of ${scenarios.length}`;
  updateScoreDisplay();

  // Scenario card — show dataset name, hypotheses, results (no test type label)
  scenarioCard.innerHTML = `
    <h3>${s.datasetName}</h3>
    <div class="hypotheses">${s.hypotheses}</div>
    <p>Significance level: ${tex('\\alpha')} = ${s.alpha}</p>
    <div class="test-results">${s.resultsDisplay}</div>
  `;

  // ── Build claim options ──
  const claimOptions = generateClaimOptions(s);
  const shuffled = shuffle(claimOptions);
  claimOptionsList.innerHTML = shuffled.map((opt, i) => `
    <li>
      <label>
        <input type="radio" name="claim-choice" value="${opt.type}" id="claim-${i}"
               aria-label="Claim option ${i + 1}">
        <span>${opt.text}</span>
      </label>
    </li>
  `).join('');
  claimSection.style.display = '';
  claimFeedback.className = 'feedback-box';
  claimFeedback.textContent = '';

  // ── Build formal conclusion Mad Libs ──
  const alphaStr = s.alpha;
  formalSentence.innerHTML = `At the ${tex(`\\alpha = ${alphaStr}`)} significance level, we
    <select id="formal-decision" class="madlib-select" aria-label="Decision: reject or fail to reject">
      <option value="" selected disabled>choose...</option>
      <option value="reject">reject</option>
      <option value="fail to reject">fail to reject</option>
    </select>
    ${tex('H_0')}. There is
    <select id="formal-evidence" class="madlib-select" aria-label="Evidence: sufficient or insufficient">
      <option value="" selected disabled>choose...</option>
      <option value="sufficient">sufficient</option>
      <option value="insufficient">insufficient</option>
    </select>
    evidence <em>[selected claim above]</em>.`;
  formalSection.style.display = '';
  formalFeedback.className = 'feedback-box';
  formalFeedback.textContent = '';

  // ── Build practical conclusion Mad Libs ──
  const sig = s.pValue < s.alpha;
  practicalSentence.innerHTML = `The data
    <select id="practical-provide" class="madlib-select" aria-label="Provide or do not provide">
      <option value="" selected disabled>choose...</option>
      <option value="provide">provide</option>
      <option value="do not provide">do not provide</option>
    </select>
    <select id="practical-strength" class="madlib-select" aria-label="Evidence strength">
      <option value="" selected disabled>choose...</option>
      <option value="strong">strong</option>
      <option value="moderate">moderate</option>
      <option value="weak">weak</option>
      <option value="no">no</option>
    </select>
    evidence <em>[selected claim above]</em>.`;
  practicalSection.style.display = '';
  practicalFeedback.className = 'feedback-box';
  practicalFeedback.textContent = '';

  // ── Reset buttons ──
  actionButtons.style.display = '';
  checkBtn.disabled = false;
  nextBtn.disabled = true;

  announce(`Scenario ${(idx % scenarios.length) + 1}: ${s.datasetName}. Fill in the blanks and select a claim.`);
}

// ── Check answer ────────────────────────────────────────────────────

checkBtn.addEventListener('click', () => {
  const s = scenarios[currentIndex % scenarios.length];
  const sig = s.pValue < s.alpha;
  const bestStrength = evidenceStrength(s.pValue);

  // Correct answers
  const correctDecision = sig ? 'reject' : 'fail to reject';
  const correctEvidence = sig ? 'sufficient' : 'insufficient';
  const correctProvide = sig ? 'provide' : 'do not provide';
  const bestStrengthDropdown = strengthToDropdown(bestStrength);

  // Read student selections
  const decisionSelect = /** @type {HTMLSelectElement} */ (document.getElementById('formal-decision'));
  const evidenceSelect = /** @type {HTMLSelectElement} */ (document.getElementById('formal-evidence'));
  const provideSelect = /** @type {HTMLSelectElement} */ (document.getElementById('practical-provide'));
  const strengthSelect = /** @type {HTMLSelectElement} */ (document.getElementById('practical-strength'));
  const claimRadio = /** @type {HTMLInputElement|null} */ (document.querySelector('input[name="claim-choice"]:checked'));

  const studentDecision = decisionSelect?.value || '';
  const studentEvidence = evidenceSelect?.value || '';
  const studentProvide = provideSelect?.value || '';
  const studentStrength = strengthSelect?.value || '';
  const studentClaimType = claimRadio?.value || '';

  // Check if all fields are filled
  const allFilled = studentDecision && studentEvidence && studentProvide && studentStrength && studentClaimType;
  if (!allFilled) {
    announce('Please fill in all blanks and select a claim before checking.');
    // Highlight empty fields
    if (!studentDecision) decisionSelect.classList.add('incorrect');
    if (!studentEvidence) evidenceSelect.classList.add('incorrect');
    if (!studentProvide) provideSelect.classList.add('incorrect');
    if (!studentStrength) strengthSelect.classList.add('incorrect');
    if (!studentClaimType) {
      claimFeedback.textContent = 'Please select a claim option.';
      claimFeedback.className = 'feedback-box visible hint';
    }
    return;
  }

  // ── Grade each blank ──
  let blanksCorrect = 0;
  const blanksTotal = 5; // decision, evidence, claim, provide, strength
  const feedbackParts = /** @type {string[]} */ ([]);

  // 1. Decision
  const decisionOk = studentDecision === correctDecision;
  decisionSelect.classList.remove('correct', 'incorrect');
  decisionSelect.classList.add(decisionOk ? 'correct' : 'incorrect');
  if (decisionOk) blanksCorrect++;
  else feedbackParts.push(`Decision: We ${correctDecision} H\u2080 because p-value (${fmtP(s.pValue)}) is ${sig ? 'less' : 'greater'} than \u03B1 (${s.alpha}).`);

  // 2. Evidence word
  const evidenceOk = studentEvidence === correctEvidence;
  evidenceSelect.classList.remove('correct', 'incorrect');
  evidenceSelect.classList.add(evidenceOk ? 'correct' : 'incorrect');
  if (evidenceOk) blanksCorrect++;
  else feedbackParts.push(`Evidence: "${correctEvidence}" pairs with "${correctDecision}" H\u2080.`);

  // Check consistency: if decision is right but evidence is wrong (or vice versa), flag
  if (decisionOk !== evidenceOk) {
    feedbackParts.push(`Note: "reject" always pairs with "sufficient", and "fail to reject" always pairs with "insufficient".`);
  }

  // 3. Claim selection
  const claimOk = studentClaimType === 'correct';
  // Style the radio labels
  claimOptionsList.querySelectorAll('label').forEach(label => {
    const input = label.querySelector('input');
    label.classList.remove('correct', 'incorrect', 'correct-answer');
    if (input?.checked) {
      label.classList.add(claimOk ? 'correct' : 'incorrect');
    }
    if (!claimOk && input?.value === 'correct') {
      label.classList.add('correct-answer');
    }
  });
  if (claimOk) blanksCorrect++;
  else {
    const distractorExplanation = {
      'null': 'That option states the null hypothesis as a conclusion. We never conclude H\u2080 is true \u2014 we only fail to reject it.',
      'sample': 'That option describes the sample, not the population. Conclusions should be about the population parameter.',
      'proof': 'Statistical tests never "prove" anything, and we must be careful about claiming causation from observational data.',
    };
    feedbackParts.push(`Claim: ${distractorExplanation[studentClaimType] || 'The selected claim is not the correct contextual conclusion.'}`);
  }
  if (claimOk) {
    claimFeedback.textContent = 'Correct claim selected.';
    claimFeedback.className = 'feedback-box visible success';
  } else {
    claimFeedback.textContent = feedbackParts[feedbackParts.length - 1];
    claimFeedback.className = 'feedback-box visible error';
  }

  // 4. Provide / do not provide
  const provideOk = studentProvide === correctProvide;
  provideSelect.classList.remove('correct', 'incorrect');
  provideSelect.classList.add(provideOk ? 'correct' : 'incorrect');
  if (provideOk) blanksCorrect++;
  else feedbackParts.push(`Provide: The data "${correctProvide}" evidence when we ${correctDecision} H\u2080.`);

  // 5. Evidence strength
  const strengthOk = isStrengthAcceptable(studentStrength, bestStrength);
  strengthSelect.classList.remove('correct', 'incorrect');
  strengthSelect.classList.add(strengthOk ? 'correct' : 'incorrect');
  if (strengthOk) blanksCorrect++;
  else feedbackParts.push(`Strength: With p = ${fmtP(s.pValue)}, the evidence is best described as "${bestStrength}" (best answer: "${bestStrengthDropdown}").`);

  // If not significant, provide/strength logic: "do not provide" means strength should be "no"
  // But we already grade them independently, so just add a note
  if (!sig && studentProvide === 'do not provide' && studentStrength !== 'no') {
    // Acceptable — strength tells how close we were, even if not significant
  }

  // ── Update feedback displays ──
  // Formal feedback
  if (decisionOk && evidenceOk) {
    formalFeedback.textContent = 'Formal conclusion: all correct.';
    formalFeedback.className = 'feedback-box visible success';
  } else {
    const formalErrors = feedbackParts.filter(p =>
      p.startsWith('Decision:') || p.startsWith('Evidence:') || p.startsWith('Note:'));
    formalFeedback.innerHTML = formalErrors.map(e => `<div>${e}</div>`).join('');
    formalFeedback.className = 'feedback-box visible error';
  }

  // Practical feedback
  if (provideOk && strengthOk) {
    practicalFeedback.textContent = 'Practical conclusion: all correct.';
    practicalFeedback.className = 'feedback-box visible success';
  } else {
    const practErrors = feedbackParts.filter(p =>
      p.startsWith('Provide:') || p.startsWith('Strength:'));
    practicalFeedback.innerHTML = practErrors.map(e => `<div>${e}</div>`).join('');
    practicalFeedback.className = 'feedback-box visible error';
  }

  // ── Update score ──
  totalBlanks += blanksTotal;
  correctBlanks += blanksCorrect;
  scenariosAttempted++;
  updateScoreDisplay();

  // Show score summary for this scenario
  scoreSummary.innerHTML = `This scenario: <span class="fraction">${blanksCorrect}/${blanksTotal}</span> correct`;

  // Disable check, enable next
  checkBtn.disabled = true;
  nextBtn.disabled = false;
  nextBtn.focus();

  announce(`${blanksCorrect} of ${blanksTotal} blanks correct. ${blanksCorrect === blanksTotal ? 'Perfect!' : 'Review the feedback below.'}`);
});

// ── Next scenario ───────────────────────────────────────────────────

nextBtn.addEventListener('click', () => {
  scoreSummary.innerHTML = '';
  showScenario(currentIndex + 1);
});

// ── Initialize ──────────────────────────────────────────────────────
loadScenarios();
