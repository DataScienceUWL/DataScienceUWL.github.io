// @ts-check
/**
 * Conclusion Practice page controller.
 * Generates randomized hypothesis test scenarios from bundled datasets,
 * lets students practice writing formal + practical conclusions,
 * then reveals model answers with progressive scaffolding.
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
const formalInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('formal-input'));
const practicalInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('practical-input'));
const checkBtn = /** @type {HTMLButtonElement} */ (document.getElementById('check-answer'));
const showAnswerBtn = /** @type {HTMLButtonElement} */ (document.getElementById('show-answer'));
const nextBtn = /** @type {HTMLButtonElement} */ (document.getElementById('next-scenario'));
const modelFormalDiv = /** @type {HTMLElement} */ (document.getElementById('model-formal'));
const modelFormalText = /** @type {HTMLElement} */ (document.getElementById('model-formal-text'));
const modelPracticalDiv = /** @type {HTMLElement} */ (document.getElementById('model-practical'));
const modelPracticalText = /** @type {HTMLElement} */ (document.getElementById('model-practical-text'));
const keyElementsDiv = /** @type {HTMLElement} */ (document.getElementById('key-elements'));
const keyElementsList = /** @type {HTMLElement} */ (document.getElementById('key-elements-list'));
const selfAssessDiv = /** @type {HTMLElement} */ (document.getElementById('self-assess'));
const srAnnounce = document.getElementById('sr-announce');

/** @param {string} msg */
function announce(msg) {
  if (srAnnounce) { srAnnounce.textContent = ''; requestAnimationFrame(() => { srAnnounce.textContent = msg; }); }
}

// ── Score tracking ──────────────────────────────────────────────────
let completed = 0;
const ratings = { 'got-it': 0, 'mostly': 0, 'needs-work': 0 };

function updateScoreDisplay() {
  if (!scoreDisplay) return;
  if (completed === 0) { scoreDisplay.textContent = ''; return; }
  scoreDisplay.textContent = `${ratings['got-it']} got it · ${ratings['mostly']} mostly · ${ratings['needs-work']} needs work`;
}

// ── Scenario types ──────────────────────────────────────────────────

/**
 * @typedef {Object} Scenario
 * @property {string} datasetName
 * @property {string} testType
 * @property {string} testLabel
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
 * Build rendered hypothesis HTML using KaTeX.
 * @param {string} param - LaTeX parameter symbol (e.g. '\\mu', 'p')
 * @param {number|string} nullVal
 * @param {string} alt - 'less' | 'greater' | 'two-sided'
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

  if (ctx.test === 'one-mean') {
    const vals = rows.map(/** @param {any} r */ r => Number(r[ctx.response])).filter(isFinite);
    if (vals.length < 3) return null;
    const { mean, sd, n } = basicStats(vals);
    const res = tTest(mean, sd, n, ctx.nullValue, ctx.alternative);
    return {
      datasetName: ds.name, testType: 'one-mean', testLabel: 'One-Sample t-Test',
      hypotheses: buildHypotheses('\\mu', ctx.nullValue, ctx.alternative),
      resultsDisplay: `${tex('n')} = ${n}, &ensp;${tex('\\bar{x}')} = ${mean.toFixed(2)}, &ensp;${tex('s')} = ${sd.toFixed(2)}<br>${tex('t')} = ${res.t.toFixed(3)}, &ensp;${tex('\\text{df}')} = ${res.df}, &ensp;p-value = ${fmtP(res.p)}`,
      pValue: res.p, alpha, alternative: ctx.alternative,
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
      datasetName: ds.name, testType: 'paired', testLabel: 'Paired t-Test',
      hypotheses: buildHypotheses('\\mu_d', mu0, ctx.alternative),
      resultsDisplay: `${tex('n')} = ${n} pairs, &ensp;${tex('\\bar{d}')} = ${mean.toFixed(2)}, &ensp;${tex('s_d')} = ${sd.toFixed(2)}<br>${tex('t')} = ${res.t.toFixed(3)}, &ensp;${tex('\\text{df}')} = ${res.df}, &ensp;p-value = ${fmtP(res.p)}`,
      pValue: res.p, alpha, alternative: ctx.alternative,
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
      datasetName: ds.name, testType: 'two-means', testLabel: 'Two-Sample t-Test (Welch)',
      hypotheses: buildHypotheses('\\mu_1 - \\mu_2', 0, ctx.alternative),
      resultsDisplay: `${groups[0]}: ${tex('n')}=${s1.n}, ${tex('\\bar{x}')}=${s1.mean.toFixed(2)} &ensp;|&ensp; ${groups[1]}: ${tex('n')}=${s2.n}, ${tex('\\bar{x}')}=${s2.mean.toFixed(2)}<br>${tex('t')} = ${res.t.toFixed(3)}, &ensp;${tex('\\text{df}')} = ${res.df}, &ensp;p-value = ${fmtP(res.p)}`,
      pValue: res.p, alpha, alternative: ctx.alternative,
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
      datasetName: ds.name, testType: 'one-prop', testLabel: 'One-Proportion z-Test',
      hypotheses: buildHypotheses('p', ctx.nullValue, ctx.alternative),
      resultsDisplay: `${tex('n')} = ${n}, &ensp;successes = ${x}, &ensp;${tex('\\hat{p}')} = ${res.pHat.toFixed(4)}<br>${tex('z')} = ${res.z.toFixed(3)}, &ensp;p-value = ${fmtP(res.p)}`,
      pValue: res.p, alpha, alternative: ctx.alternative,
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
      datasetName: ds.name, testType: 'two-props', testLabel: 'Two-Proportion z-Test',
      hypotheses: buildHypotheses('p_1 - p_2', 0, ctx.alternative),
      resultsDisplay: `${groups[0]}: ${x1}/${n1} &ensp;|&ensp; ${groups[1]}: ${x2}/${n2}<br>${tex('z')} = ${z.toFixed(3)}, &ensp;p-value = ${fmtP(p)}`,
      pValue: p, alpha, alternative: ctx.alternative,
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
      datasetName: ds.name, testType: 'chisq', testLabel: 'Chi-Square Test of Independence',
      hypotheses: `${h0}<br>${ha}`,
      resultsDisplay: `${nR} × ${nC} table, &ensp;${tex('n')} = ${n}<br>${tex('\\chi^2')} = ${chiSq.toFixed(3)}, &ensp;${tex('\\text{df}')} = ${df}, &ensp;p-value = ${fmtP(p)}`,
      pValue: p, alpha, alternative: 'greater',
      statName: '\u03C7\u00B2', statValue: chiSq.toFixed(3),
      parameter: ctx.parameter, claim: ctx.claim,
    };
  }

  return null;
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
          if (scenario) built.push(scenario);
        }
      } catch { /* skip failed loads */ }
    }

    scenarios = shuffle(built);
    if (scenarios.length === 0) {
      scenarioCard.innerHTML = '<p>No scenarios available. Check that datasets have inferenceContexts.</p>';
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

  scenarioCard.innerHTML = `
    <h3>${s.testLabel}: ${s.datasetName}</h3>
    <div class="hypotheses">${s.hypotheses}</div>
    <p>Significance level: ${tex('\\alpha')} = ${s.alpha}</p>
    <div class="test-results">${s.resultsDisplay}</div>
  `;

  // Reset UI state
  formalInput.value = '';
  practicalInput.value = '';
  modelFormalDiv.classList.add('hidden');
  modelPracticalDiv.classList.add('hidden');
  keyElementsDiv.classList.add('hidden');
  selfAssessDiv.classList.add('hidden');
  checkBtn.disabled = false;
  showAnswerBtn.disabled = true;

  formalInput.focus();
  announce(`Scenario ${(idx % scenarios.length) + 1}: ${s.testLabel} for ${s.datasetName}.`);
}

// ── Step 1: Check My Answer → show key elements checklist ───────────

checkBtn.addEventListener('click', () => {
  const s = scenarios[currentIndex % scenarios.length];
  const sig = s.pValue < s.alpha;

  const elements = [
    `State the decision: "${sig ? 'reject' : 'fail to reject'} ${tex('H_0')}" (never say "accept ${tex('H_0')}")`,
    `Reference the significance level (${tex(`\\alpha = ${s.alpha}`)})`,
    `Use "${sig ? 'sufficient' : 'insufficient'} evidence" language`,
    s.claim ? `Include the context: what the claim is about in plain language` : null,
    `Cite the test statistic and p-value`,
    sig ? null : `Do NOT conclude that ${tex('H_0')} is true — only that there is not enough evidence against it`,
  ].filter(Boolean);

  keyElementsList.innerHTML = elements.map(e => `<li>${e}</li>`).join('');
  keyElementsDiv.classList.remove('hidden');

  checkBtn.disabled = true;
  showAnswerBtn.disabled = false;
  showAnswerBtn.focus();
  announce('Key elements checklist shown. Review your answer, then click Show Model Answer.');
});

// ── Step 2: Show Model Answer ───────────────────────────────────────

showAnswerBtn.addEventListener('click', () => {
  const s = scenarios[currentIndex % scenarios.length];

  const conclusions = generateConclusions({
    pValue: s.pValue,
    alpha: s.alpha,
    alternative: s.alternative,
    testType: s.testType,
    statName: s.statName,
    statValue: s.statValue,
    context: {
      parameter: s.parameter,
      nullValue: s.nullValue,
      claim: s.claim,
    },
  });

  modelFormalText.textContent = conclusions.formal;
  modelFormalDiv.classList.remove('hidden');

  if (conclusions.practical) {
    modelPracticalText.textContent = conclusions.practical;
    modelPracticalDiv.classList.remove('hidden');
  }

  showAnswerBtn.disabled = true;
  selfAssessDiv.classList.remove('hidden');
  announce('Model answer revealed. Rate how your answer compared.');
});

// ── Step 3: Self-assessment ─────────────────────────────────────────

selfAssessDiv.addEventListener('click', (e) => {
  const btn = /** @type {HTMLElement} */ (e.target).closest('[data-rating]');
  if (!btn) return;
  const rating = /** @type {string} */ (btn.getAttribute('data-rating'));
  if (rating in ratings) {
    ratings[/** @type {keyof typeof ratings} */ (rating)]++;
  }
  completed++;
  updateScoreDisplay();
  selfAssessDiv.classList.add('hidden');
  announce(`Rated "${btn.textContent}". Click Next Scenario to continue.`);
  nextBtn.focus();
});

// ── Next scenario ───────────────────────────────────────────────────

nextBtn.addEventListener('click', () => {
  showScenario(currentIndex + 1);
});

// ── Initialize ──────────────────────────────────────────────────────
loadScenarios();
