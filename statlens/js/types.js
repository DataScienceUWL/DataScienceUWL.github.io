// @ts-check
/**
 * Shared type definitions for StatLens.
 * This file contains no runtime code — only JSDoc typedefs.
 * Import types with: @import { StatLensParams } from './types.js'
 */

/**
 * Parsed URL parameters for a StatLens page.
 * @typedef {object} StatLensParams
 * @property {number[]} [data]          - Inline numeric data from ?data=
 * @property {string}   [dataset]       - Bundled dataset name from ?dataset=
 * @property {string}   [csv]           - Remote CSV URL from ?csv=
 * @property {string}   [json]          - Remote JSON dataset URL from ?json=
 * @property {string}   [seed]          - PRNG seed string (for simulation resampling)
 * @property {string}   [gen_seed]      - PRNG seed for parametric data generation (separate from seed)
 * @property {string}   [gen]           - Generator type: normal|uniform|bernoulli|...
 * @property {string}   [dist]          - Distribution family for inline generation: normal|gamma|exponential|bernoulli|binomial|poisson|uniform|lognormal|chisq|t|categorical
 * @property {number}   [n]             - Sample size for generation
 * @property {number}   [mu]            - Mean (normal, distribution calc)
 * @property {number}   [sigma]         - SD (normal, distribution calc)
 * @property {number}   [min]           - Lower bound (uniform)
 * @property {number}   [max]           - Upper bound (uniform)
 * @property {number}   [p]             - Probability (bernoulli, proportion null hypothesis)
 * @property {number}   [prob]          - Success probability for datagen (avoids ?p= conflict)
 * @property {number}   [shape]         - Shape parameter (gamma)
 * @property {number}   [scale]         - Scale parameter (gamma)
 * @property {number}   [lambda]        - Rate parameter (exponential, poisson)
 * @property {number}   [trials]        - Number of trials (binomial)
 * @property {number}   [a]             - Lower bound (uniform)
 * @property {number}   [b]             - Upper bound (uniform)
 * @property {number}   [round]         - Decimal places for rounding (datagen)
 * @property {number}   [n1]            - Group 1 size (two-group)
 * @property {number}   [n2]            - Group 2 size (two-group)
 * @property {number}   [mu1]           - Group 1 mean (two-group means)
 * @property {number}   [mu2]           - Group 2 mean (two-group means)
 * @property {number}   [sigma1]        - Group 1 SD (two-group means)
 * @property {number}   [sigma2]        - Group 2 SD (two-group means)
 * @property {number}   [p1]            - Group 1 proportion (two-group props)
 * @property {number}   [p2]            - Group 2 proportion (two-group props)
 * @property {number}   [rho]           - Correlation (paired, regression)
 * @property {number}   [intercept]     - Regression intercept
 * @property {number}   [slope]         - Regression slope
 * @property {number}   [sigma_error]   - Regression error SD
 * @property {number}   [x_min]         - Regression x lower bound
 * @property {number}   [x_max]         - Regression x upper bound
 * @property {number}   [decimals]      - Rounding decimal places
 * @property {number}   [clip_min]      - Rejection sampling lower bound
 * @property {number}   [clip_max]      - Rejection sampling upper bound
 * @property {string}   [label]         - Variable label
 * @property {string}   [units]         - Variable units
 * @property {string}   [context]       - Named context preset
 * @property {string}   [var]           - Column name (explore tools)
 * @property {string}   [x]             - X column name (two-variable)
 * @property {string}   [y]             - Y column name (two-variable)
 * @property {string}   [group]         - Grouping column name
 * @property {string}   [response]      - Response column name
 * @property {number}   [B]             - Bootstrap/randomization replicates (default 1000)
 * @property {number}   [ci]            - CI confidence level (default 95)
 * @property {string}   [stat]          - Statistic: mean|median|sd|q1|q3|prop|diff_mean|diff_prop|chisq|F|slope
 * @property {string}   [direction]     - Tail direction: left|right|both
 * @property {number}   [null_value]    - Null hypothesis value (renamed from 'null')
 * @property {number}   [df]            - Degrees of freedom (t, chi-sq)
 * @property {number}   [df1]           - Numerator df (F)
 * @property {number}   [df2]           - Denominator df (F)
 * @property {string}   [tail]          - Shading direction (distributions): left|right|both|middle
 * @property {string}   [success]       - Success label (bernoulli)
 * @property {string}   [failure]       - Failure label (bernoulli)
 * @property {string}   [group1]        - Group 1 label (two-group)
 * @property {string}   [group2]        - Group 2 label (two-group)
 * @property {string}   [var1]          - First variable label (paired)
 * @property {string}   [var2]          - Second variable label (paired)
 * @property {string}   [x_label]       - X-axis label (regression)
 * @property {string}   [y_label]       - Y-axis label (regression)
 * @property {string}   [cats]          - Comma-separated categories (categorical gen)
 * @property {string}   [probs]         - Comma-separated probabilities (categorical gen)
 * @property {string}   [summary]       - Compact summary stats (format varies by page)
 * @property {number}   [alpha]         - Significance level (inference pages)
 * @property {string}   [alt]           - Alternative hypothesis: less|greater|two-sided
 */

/**
 * Output from a data generator.
 * @typedef {object} GeneratedData
 * @property {number[]|string[]}  values     - The generated data (single variable)
 * @property {number[]}           [values1]  - Group 1 / x / variable 1 (two-group/paired/regression)
 * @property {number[]|string[]}  [values2]  - Group 2 / y / variable 2
 * @property {string}             label      - Display label for the variable
 * @property {string}             [units]    - Units string (e.g., "inches")
 * @property {string}             fingerprint - 4-char hex fingerprint
 * @property {string}             seed       - Seed used for generation
 * @property {number}             n          - Total sample size
 * @property {Object<string,*>}   params     - Echo of generation parameters
 */

/**
 * Parsed CSV data.
 * @typedef {object} ParsedData
 * @property {string[]}                     headers   - Column names
 * @property {Object<string,string>[]}      data      - Array of row objects
 * @property {('numeric'|'categorical')[]}  types     - Inferred column types
 * @property {string}                       delimiter - Detected delimiter character
 */

/**
 * Result of simple linear regression (OLS).
 * @typedef {object} LinregResult
 * @property {number}   slope      - b1 coefficient
 * @property {number}   intercept  - b0 coefficient
 * @property {number}   r          - Pearson correlation
 * @property {number}   r2         - R-squared (coefficient of determination)
 * @property {number}   se_slope   - Standard error of slope
 * @property {number}   t_slope    - t-statistic for slope
 * @property {number}   p_slope    - p-value for slope (two-tailed)
 * @property {number[]} residuals  - Residual for each observation
 * @property {number[]} fitted     - Fitted (predicted) values
 */

/**
 * SVG chart frame returned by createChart().
 * @typedef {object} ChartFrame
 * @property {SVGSVGElement}  svg     - The root <svg> element
 * @property {SVGGElement}    inner   - The <g class="chart-inner">
 * @property {number}         width   - Inner width (viewBox width minus margins)
 * @property {number}         height  - Inner height (viewBox height minus margins)
 * @property {{top:number, right:number, bottom:number, left:number}} margin
 * @property {HTMLDivElement} wrapper - The .statlens-chart wrapper div containing the SVG + export buttons
 */

export {};  // Make this a module (required for @import to work)
