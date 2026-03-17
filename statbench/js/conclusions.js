// @ts-check
/**
 * Hypothesis test conclusion generator.
 *
 * Produces formal (reject/fail to reject H₀) and practical
 * (evidence-based, plain-language) conclusions for all inference pages.
 *
 * @module conclusions
 */

/**
 * Evidence-strength scale based on p-value.
 * @param {number} p
 * @returns {string}
 */
export function evidenceStrength(p) {
  if (p < 0.001) return 'very strong';
  if (p < 0.01) return 'strong';
  if (p < 0.05) return 'moderate';
  if (p < 0.10) return 'weak';
  return 'little to no';
}

/**
 * Build the Hₐ phrase in plain language.
 * @param {string} testType
 * @param {string} alternative - 'less' | 'greater' | 'two-sided'
 * @param {string} [parameter] - e.g. "the population mean mercury level"
 * @param {number|string} [nullValue]
 * @returns {string}
 */
function buildHaPhrase(testType, alternative, parameter, nullValue) {
  const param = parameter || defaultParameter(testType);
  const nv = nullValue != null ? nullValue : defaultNullValue(testType);

  if (testType === 'chisq' || testType === 'anova') {
    return param; // e.g. "there is an association between X and Y" or "at least one mean differs"
  }

  const dir = alternative === 'less' ? 'less than'
    : alternative === 'greater' ? 'greater than'
    : 'different from';

  return `${param} is ${dir} ${nv}`;
}

/**
 * Default parameter description when none is provided.
 * @param {string} testType
 * @returns {string}
 */
function defaultParameter(testType) {
  switch (testType) {
    case 'one-mean': return 'the population mean';
    case 'paired': return 'the population mean difference';
    case 'two-means': return 'the difference in population means';
    case 'one-prop': return 'the population proportion';
    case 'two-props': return 'the difference in population proportions';
    case 'chisq': return 'there is an association between the variables';
    case 'anova': return 'at least one population mean differs from the others';
    case 'slope': return 'the population slope';
    default: return 'the parameter';
  }
}

/**
 * Default null value when none is provided.
 * @param {string} testType
 * @returns {number|string}
 */
function defaultNullValue(testType) {
  switch (testType) {
    case 'two-means':
    case 'two-props':
    case 'paired':
    case 'slope':
      return 0;
    default:
      return 'the hypothesized value';
  }
}

/**
 * Format a p-value for display in conclusion text.
 * @param {number} p
 * @returns {string}
 */
function formatP(p) {
  if (p < 0.0001) return '< 0.0001';
  if (p < 0.001) return '< 0.001';
  return `= ${p.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')}`;
}

/**
 * @typedef {Object} ConclusionContext
 * @property {string} [parameter] - Plain-language parameter, e.g. "the population mean mercury level in dolphins"
 * @property {number|string} [nullValue] - Null hypothesis value
 * @property {string} [claim] - Plain-language claim for practical conclusion
 * @property {string} [units] - Measurement units
 */

/**
 * @typedef {Object} ConclusionInput
 * @property {number} pValue
 * @property {number} alpha
 * @property {string} alternative - 'less' | 'greater' | 'two-sided'
 * @property {string} testType - 'one-mean' | 'paired' | 'two-means' | 'one-prop' | 'two-props' | 'chisq' | 'anova' | 'slope'
 * @property {string} statName - 't', 'z', 'chi-sq'
 * @property {string} statValue - formatted test statistic
 * @property {ConclusionContext} [context]
 */

/**
 * @typedef {Object} ConclusionResult
 * @property {string} formal - Formal conclusion (reject/fail to reject H₀)
 * @property {string|null} practical - Practical conclusion (plain language), null if no claim
 * @property {string} decision - 'reject' | 'fail to reject'
 * @property {string} evidenceWord - 'sufficient' | 'insufficient'
 * @property {string} strength - Evidence strength phrase
 * @property {boolean} sig - Whether result is statistically significant
 */

/**
 * Generate formal and practical conclusions for a hypothesis test.
 * @param {ConclusionInput} opts
 * @returns {ConclusionResult}
 */
export function generateConclusions(opts) {
  const { pValue, alpha: rawAlpha, alternative, testType, statName, statValue, context } = opts;
  // Round alpha to avoid floating-point artifacts (e.g. 1 - 0.95 = 0.050000000000000044)
  const alpha = parseFloat(rawAlpha.toPrecision(6));
  const sig = pValue < alpha;
  const strength = evidenceStrength(pValue);
  const decision = sig ? 'reject' : 'fail to reject';
  const evidenceWord = sig ? 'sufficient' : 'insufficient';

  const parameter = context?.parameter;
  const nullValue = context?.nullValue;
  const claim = context?.claim;

  // ── Formal conclusion ──
  const haPhrase = buildHaPhrase(testType, alternative, parameter, nullValue);
  const formal = (testType === 'chisq' || testType === 'anova')
    ? (sig
      ? `At \u03b1 = ${alpha}, we reject H\u2080. There is sufficient evidence that ${haPhrase}.`
      : `At \u03b1 = ${alpha}, we fail to reject H\u2080. There is insufficient evidence that ${haPhrase}.`)
    : `At \u03b1 = ${alpha}, we ${decision} H\u2080. There is ${evidenceWord} evidence that ${haPhrase}.`;

  // ── Practical conclusion ──
  const pDisplay = formatP(pValue);
  const citation = `${statName} = ${statValue}, p ${pDisplay}`;
  let practical = null;
  if (claim) {
    practical = sig
      ? `The data provide ${strength} evidence that ${claim} (${citation}).`
      : `The data do not provide sufficient evidence that ${claim} (${citation}).`;
  }

  return { formal, practical, decision, evidenceWord, strength, sig };
}

/**
 * Find the matching inference context for a given test type in a dataset.
 * @param {any} dataset - Full dataset JSON object
 * @param {string} testType - e.g. 'one-mean', 'two-props'
 * @returns {ConclusionContext|null}
 */
export function findContext(dataset, testType) {
  if (!dataset?.inferenceContexts) return null;
  return dataset.inferenceContexts.find(
    /** @param {any} c */ c => c.test === testType
  ) || null;
}
