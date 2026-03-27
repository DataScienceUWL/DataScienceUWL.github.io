// @ts-check

/**
 * Parametric data generation module.
 * Generates synthetic datasets from distribution specifications using sfc32 PRNG.
 * All algorithms are deterministic and must match the Python oracle exactly.
 *
 * Supported distributions: normal, gamma, exponential, bernoulli, binomial,
 * poisson, uniform, lognormal, chisq, t, categorical.
 *
 * @module datagen
 */

import { createRng } from './prng.js';

/* ─── Distribution Samplers ─────────────────────────────────────────────── */

/**
 * Generate a single Normal(μ, σ) variate via Box-Muller transform.
 * Consumes exactly 2 PRNG draws per call.
 * @param {() => number} rng
 * @param {number} mu
 * @param {number} sigma
 * @returns {number}
 */
function sampleNormal(rng, mu, sigma) {
  const u1 = rng();
  const u2 = rng();
  return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/**
 * Generate a single Gamma(shape, scale) variate via Marsaglia-Tsang method.
 * For shape >= 1, uses the standard M-T algorithm.
 * For shape < 1, uses Ahrens-Dieter: Gamma(a) = Gamma(a+1) * U^(1/a).
 * @param {() => number} rng
 * @param {number} shape - Shape parameter α (must be > 0)
 * @param {number} scale - Scale parameter β (must be > 0)
 * @returns {number}
 */
function sampleGamma(rng, shape, scale) {
  if (shape <= 0 || scale <= 0) {
    throw new RangeError('Gamma parameters must be positive');
  }

  // For shape < 1, use Ahrens-Dieter boost
  let boost = 1;
  let a = shape;
  if (a < 1) {
    boost = Math.pow(rng(), 1 / a);
    a = a + 1;
  }

  // Marsaglia-Tsang for shape >= 1
  const d = a - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    let x, v;
    do {
      x = sampleNormal(rng, 0, 1);
      v = 1 + c * x;
    } while (v <= 0);

    v = v * v * v;
    const u = rng();

    // Squeeze test
    if (u < 1 - 0.0331 * (x * x) * (x * x)) {
      return d * v * scale * boost;
    }
    // Full test
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) {
      return d * v * scale * boost;
    }
  }
}

/**
 * Generate a single Exponential(λ) variate via inverse CDF.
 * @param {() => number} rng
 * @param {number} lambda - Rate parameter (must be > 0)
 * @returns {number}
 */
function sampleExponential(rng, lambda) {
  return -Math.log(rng()) / lambda;
}

/**
 * Generate a single Bernoulli(prob) variate.
 * @param {() => number} rng
 * @param {number} prob - Success probability in [0, 1]
 * @returns {number} 0 or 1
 */
function sampleBernoulli(rng, prob) {
  return rng() < prob ? 1 : 0;
}

/**
 * Generate a single Binomial(trials, prob) variate via sum of Bernoulli draws.
 * @param {() => number} rng
 * @param {number} trials - Number of trials (positive integer)
 * @param {number} prob - Success probability in [0, 1]
 * @returns {number} Integer in [0, trials]
 */
function sampleBinomial(rng, trials, prob) {
  let sum = 0;
  for (let i = 0; i < trials; i++) {
    if (rng() < prob) sum++;
  }
  return sum;
}

/**
 * Generate a single Poisson(λ) variate via Knuth's algorithm.
 * @param {() => number} rng
 * @param {number} lambda - Rate parameter (must be > 0)
 * @returns {number} Non-negative integer
 */
function samplePoisson(rng, lambda) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rng();
  } while (p > L);
  return k - 1;
}

/**
 * Generate a single Uniform(a, b) variate.
 * @param {() => number} rng
 * @param {number} a - Lower bound
 * @param {number} b - Upper bound
 * @returns {number}
 */
function sampleUniform(rng, a, b) {
  return a + rng() * (b - a);
}

/**
 * Generate a single Chi-squared(df) variate = Gamma(df/2, 2).
 * @param {() => number} rng
 * @param {number} df - Degrees of freedom (must be > 0)
 * @returns {number}
 */
function sampleChisq(rng, df) {
  return sampleGamma(rng, df / 2, 2);
}

/**
 * Generate a single t(df) variate = Normal / sqrt(ChiSq/df).
 * @param {() => number} rng
 * @param {number} df - Degrees of freedom (must be > 0)
 * @returns {number}
 */
function sampleT(rng, df) {
  const z = sampleNormal(rng, 0, 1);
  const chi = sampleChisq(rng, df);
  return z / Math.sqrt(chi / df);
}

/**
 * Generate a single Lognormal(μ, σ) variate = exp(Normal(μ, σ)).
 * @param {() => number} rng
 * @param {number} mu - Mean of the underlying normal
 * @param {number} sigma - SD of the underlying normal
 * @returns {number}
 */
function sampleLognormal(rng, mu, sigma) {
  return Math.exp(sampleNormal(rng, mu, sigma));
}

/**
 * Generate a single categorical variate from named categories with probabilities.
 * @param {() => number} rng
 * @param {string[]} categories - Category labels
 * @param {number[]} probs - Probability for each category (must sum to ~1)
 * @returns {string} One of the category labels
 */
function sampleCategorical(rng, categories, probs) {
  const u = rng();
  let cumulative = 0;
  for (let i = 0; i < categories.length; i++) {
    cumulative += probs[i];
    if (u < cumulative) return categories[i];
  }
  return categories[categories.length - 1];
}

/* ─── Sampler Registry ──────────────────────────────────────────────────── */

/**
 * @typedef {object} DistConfig
 * @property {string} distribution - Distribution family name
 * @property {Object<string, number>} [params] - Distribution parameters
 * @property {number} n - Sample size
 * @property {string} [var] - Variable name
 * @property {string} [label] - Display label
 * @property {string} [units] - Units of measurement (e.g., 'inches', 'kg')
 * @property {number} [round] - Decimal places to round to
 * @property {number} [clip_min] - Lower bound for clipping
 * @property {number} [clip_max] - Upper bound for clipping
 * @property {Array<Object<string, number>>} [transforms] - Post-generation transforms
 * @property {Object<string, [number, number]>} [param_ranges] - Ranges for seed-based param selection
 * @property {number} [version] - Algorithm version (default 1)
 * @property {string[]} [cats] - Category labels (categorical distribution)
 * @property {number[]} [probs] - Category probabilities (categorical distribution)
 */

/**
 * Draw one sample from the specified distribution.
 * @param {() => number} rng
 * @param {string} dist - Distribution name
 * @param {Object<string, number>} p - Distribution parameters
 * @returns {number|string}
 */
function drawOne(rng, dist, p) {
  switch (dist) {
  case 'normal':      return sampleNormal(rng, p.mu ?? 0, p.sigma ?? 1);
  case 'gamma':       return sampleGamma(rng, p.shape ?? 1, p.scale ?? 1);
  case 'exponential': return sampleExponential(rng, p.lambda ?? 1);
  case 'bernoulli':   return sampleBernoulli(rng, p.prob ?? 0.5);
  case 'binomial':    return sampleBinomial(rng, p.trials ?? 10, p.prob ?? 0.5);
  case 'poisson':     return samplePoisson(rng, p.lambda ?? 1);
  case 'uniform':     return sampleUniform(rng, p.a ?? 0, p.b ?? 1);
  case 'chisq':       return sampleChisq(rng, p.df ?? 1);
  case 't':           return sampleT(rng, p.df ?? 1);
  case 'lognormal':   return sampleLognormal(rng, p.mu ?? 0, p.sigma ?? 1);
  default:
    throw new Error(`Unknown distribution: ${dist}`);
  }
}

/* ─── Transform Pipeline ────────────────────────────────────────────────── */

/**
 * Apply post-generation transforms to a value.
 * @param {number} val
 * @param {DistConfig} config
 * @returns {number}
 */
function applyTransforms(val, config) {
  // Apply transforms array (from generator block)
  if (config.transforms) {
    for (const t of config.transforms) {
      if ('round' in t) {
        const factor = Math.pow(10, t.round);
        val = Math.round(val * factor) / factor;
      }
      if ('clip_min' in t) val = Math.max(val, t.clip_min);
      if ('clip_max' in t) val = Math.min(val, t.clip_max);
    }
  }

  // Apply top-level round / clip (from inline URL params)
  if (config.round != null) {
    const factor = Math.pow(10, config.round);
    val = Math.round(val * factor) / factor;
  }
  if (config.clip_min != null) val = Math.max(val, config.clip_min);
  if (config.clip_max != null) val = Math.min(val, config.clip_max);

  return val;
}

/* ─── Parameter Range Resolution ────────────────────────────────────────── */

/**
 * Resolve param_ranges using the RNG to select values within ranges.
 * Draws one uniform per ranged parameter, in sorted key order.
 * @param {() => number} rng
 * @param {Object<string, number>} baseParams - Base parameter values
 * @param {Object<string, [number, number]>} ranges - Parameter ranges
 * @returns {Object<string, number>} Resolved parameters
 */
function resolveParamRanges(rng, baseParams, ranges) {
  const resolved = { ...baseParams };
  const keys = Object.keys(ranges).sort();
  for (const key of keys) {
    const [lo, hi] = ranges[key];
    resolved[key] = lo + rng() * (hi - lo); // lerp(lo, hi, rng())
  }
  return resolved;
}

/* ─── Main Generation Functions ─────────────────────────────────────────── */

/**
 * Generate a dataset from a distribution configuration.
 * @param {DistConfig} config - Distribution specification
 * @param {string} seed - PRNG seed string
 * @param {Object<string, number>} [overrides] - URL param overrides for distribution params
 * @returns {{ values: (number|string)[], variable: string, label: string, units: string, n: number, params: Object<string, number> }}
 */
export function generateFromConfig(config, seed, overrides) {
  const MAX_N = 10000;
  const rng = createRng(seed);
  const dist = config.distribution;
  const rawN = overrides?.n ?? config.n;
  const n = Math.min(Math.max(rawN, 1), MAX_N);

  // Start with base params, resolve ranges, then apply overrides
  let params = { ...(config.params ?? {}) };
  if (config.param_ranges) {
    params = resolveParamRanges(rng, params, config.param_ranges);
  }
  // URL overrides take precedence
  if (overrides) {
    for (const [k, v] of Object.entries(overrides)) {
      if (k !== 'n' && typeof v === 'number' && isFinite(v)) {
        params[k] = v;
      }
    }
  }

  // Validate distribution parameters
  if ((dist === 'normal' || dist === 'lognormal') && params.sigma != null && params.sigma < 0) {
    params.sigma = Math.abs(params.sigma);
  }
  if (dist === 'exponential' && params.lambda != null && params.lambda <= 0) {
    params.lambda = 1;
  }
  if ((dist === 'gamma' || dist === 'chisq') && params.shape != null && params.shape <= 0) {
    params.shape = 1;
  }
  if (dist === 'gamma' && params.scale != null && params.scale <= 0) {
    params.scale = 1;
  }
  if ((dist === 'binomial' || dist === 'bernoulli') && params.prob != null) {
    params.prob = Math.max(0, Math.min(1, params.prob));
  }
  if (dist === 'binomial' && params.trials != null && params.trials < 1) {
    params.trials = 1;
  }
  if ((dist === 'chisq' || dist === 't') && params.df != null && params.df < 1) {
    params.df = 1;
  }
  if (dist === 'uniform' && params.a != null && params.b != null && params.a >= params.b) {
    params.b = params.a + 1;
  }

  // Generate values
  /** @type {(number|string)[]} */
  const values = new Array(n);

  if (dist === 'categorical') {
    const cats = config.cats ?? ['A', 'B'];
    const probs = config.probs ?? cats.map(() => 1 / cats.length);
    for (let i = 0; i < n; i++) {
      values[i] = sampleCategorical(rng, cats, probs);
    }
  } else {
    for (let i = 0; i < n; i++) {
      values[i] = applyTransforms(/** @type {number} */ (drawOne(rng, dist, params)), config);
    }
  }

  return {
    values,
    variable: config.var ?? 'x',
    label: config.label ?? config.var ?? 'x',
    units: config.units ?? '',
    n,
    params
  };
}

/**
 * Build a DistConfig from inline URL parameters.
 * @param {import('./types.js').StatLensParams} urlParams
 * @returns {DistConfig|null} Config if ?dist= is present, null otherwise
 */
export function configFromUrlParams(urlParams) {
  const dist = /** @type {string|undefined} */ (/** @type {any} */ (urlParams).dist);
  if (!dist) return null;

  const n = urlParams.n;
  if (!n || n < 1) return null;

  // Collect distribution-specific params from URL
  /** @type {Object<string, number>} */
  const params = {};
  const paramKeys = ['mu', 'sigma', 'shape', 'scale', 'lambda', 'prob',
    'trials', 'a', 'b', 'df'];
  for (const key of paramKeys) {
    const val = /** @type {any} */ (urlParams)[key];
    if (val != null && typeof val === 'number') {
      params[key] = val;
    }
  }

  // Handle p → prob mapping (URL uses ?prob= to avoid conflict with ?p=)
  // Already handled since 'prob' is in paramKeys

  /** @type {DistConfig} */
  const config = {
    distribution: dist,
    params,
    n,
    var: urlParams.var ?? 'x',
    label: urlParams.label ?? urlParams.var ?? 'x',
    units: urlParams.units ?? '',
  };

  // Optional transforms from URL
  if (urlParams.decimals != null) config.round = urlParams.decimals;
  if (/** @type {any} */ (urlParams).round != null) config.round = /** @type {any} */ (urlParams).round;
  if (urlParams.clip_min != null) config.clip_min = urlParams.clip_min;
  if (urlParams.clip_max != null) config.clip_max = urlParams.clip_max;

  // Categorical params
  if (dist === 'categorical' && urlParams.cats) {
    config.cats = urlParams.cats.split(',').map(s => s.trim());
    if (urlParams.probs) {
      config.probs = urlParams.probs.split(',').map(s => parseFloat(s.trim())).filter(isFinite);
    }
  }

  return config;
}

/**
 * Build a DistConfig from a dataset JSON's generator block.
 * @param {{ distribution: string, params?: Object<string, number>, n?: number, transforms?: Array<Object<string, number>>, param_ranges?: Object<string, [number, number]>, version?: number, variable_name?: string, units?: string, display?: { label?: string } }} generator - The generator block from the dataset JSON
 * @param {import('./types.js').StatLensParams} urlParams - For overrides
 * @returns {DistConfig}
 */
export function configFromGenerator(generator, urlParams) {
  /** @type {DistConfig} */
  const config = {
    distribution: generator.distribution,
    params: { ...(generator.params ?? {}) },
    n: urlParams.n ?? generator.n ?? 100,
    transforms: generator.transforms,
    param_ranges: generator.param_ranges,
    version: generator.version ?? 1,
  };

  // Variable name from generator or URL
  if (generator.variable_name) config.var = generator.variable_name;
  if (urlParams.var) config.var = urlParams.var;
  if (generator.display?.label) config.label = generator.display.label;
  if (urlParams.label) config.label = urlParams.label;
  if (generator.units) config.units = generator.units;
  if (urlParams.units) config.units = urlParams.units;

  return config;
}

/* ─── Exports for testing ───────────────────────────────────────────────── */

export {
  sampleNormal,
  sampleGamma,
  sampleExponential,
  sampleBernoulli,
  sampleBinomial,
  samplePoisson,
  sampleUniform,
  sampleChisq,
  sampleT,
  sampleLognormal,
  sampleCategorical,
  resolveParamRanges,
};
