// @ts-check

/**
 * URL parameter parsing module.
 * Parses query strings into StatLensParams objects with validation and sanitization.
 * @module url-params
 */

/** @type {number} Maximum number of inline data values */
export const MAX_DATA_LENGTH = 10_000;

/** Parameters that should be parsed as positive integers */
const INT_PARAMS = new Set(['n', 'B', 'ci', 'df', 'df1', 'df2', 'n1', 'n2', 'trials', 'round']);

/** Parameters that should be parsed as floats */
const FLOAT_PARAMS = new Set([
    'mu', 'sigma', 'p', 'min', 'max', 'mu1', 'mu2',
    'sigma1', 'sigma2', 'p1', 'p2', 'rho',
    'intercept', 'slope', 'sigma_error', 'x_min', 'x_max',
    'decimals', 'clip_min', 'clip_max', 'null_value', 'alpha',
    'shape', 'scale', 'lambda', 'prob', 'a', 'b'
]);

/** Parameters that should remain as sanitized strings */
const STRING_PARAMS = new Set([
    'seed', 'gen_seed', 'gen', 'stat', 'direction', 'tail', 'dataset',
    'csv', 'json', 'dist',
    'var', 'x', 'y', 'group', 'response', 'label', 'units', 'context',
    'success', 'failure', 'group1', 'group2', 'var1', 'var2',
    'x_label', 'y_label', 'summary', 'alt'
]);

/**
 * Sanitize a string value — strip HTML tags and control characters.
 * @param {string} s
 * @returns {string}
 */
function sanitize(s) {
    return s.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f]/g, '').trim();
}

/**
 * Parse URL query parameters into a StatLensParams object.
 * @param {string} [queryString] - URL query string to parse (defaults to location.search in browser)
 * @returns {import('./types.js').StatLensParams}
 */
export function parseParams(queryString) {
    if (queryString === undefined) {
        if (typeof location !== 'undefined') {
            queryString = location.search;
        } else {
            queryString = '';
        }
    }

    // Strip leading '?' if present
    if (queryString.startsWith('?')) {
        queryString = queryString.slice(1);
    }

    const urlParams = new URLSearchParams(queryString);
    /** @type {import('./types.js').StatLensParams} */
    const params = {};

    // Parse inline data
    if (urlParams.has('data')) {
        const raw = urlParams.get('data') || '';
        const values = raw.split(',')
            .map(s => s.trim())
            .filter(s => s.length > 0)
            .map(s => parseFloat(s))
            .filter(v => isFinite(v));

        if (values.length > MAX_DATA_LENGTH) {
            params.data = values.slice(0, MAX_DATA_LENGTH);
        } else {
            params.data = values;
        }
    }

    // Parse comma-separated string lists
    if (urlParams.has('cats')) {
        // Stored as raw string — splitting happens in datagen
        params.cats = sanitize(urlParams.get('cats') || '');
    }
    if (urlParams.has('probs')) {
        params.probs = sanitize(urlParams.get('probs') || '');
    }

    // Parse all other known parameters
    for (const [key, value] of urlParams.entries()) {
        if (key === 'data' || key === 'cats' || key === 'probs') continue;

        if (INT_PARAMS.has(key)) {
            const parsed = parseInt(value, 10);
            // round=0 is valid (round to integers), so allow >= 0 for 'round'
            const minVal = key === 'round' ? 0 : 1;
            if (isFinite(parsed) && parsed >= minVal) {
                /** @type {any} */ (params)[key] = parsed;
            }
        } else if (FLOAT_PARAMS.has(key)) {
            const parsed = parseFloat(value);
            if (isFinite(parsed)) {
                /** @type {any} */ (params)[key] = parsed;
            }
        } else if (STRING_PARAMS.has(key)) {
            let sanitized = sanitize(value);
            if (key === 'seed') {
                sanitized = sanitized.slice(0, 100);
            } else if (key === 'csv' || key === 'json') {
                // Allow URL characters but validate it looks like a URL
                sanitized = value.trim().slice(0, 2000);
                if (!sanitized.startsWith('http://') && !sanitized.startsWith('https://')) {
                    continue;
                }
            } else if (key === 'dataset') {
                // Prevent path traversal
                sanitized = sanitized.replace(/[^a-zA-Z0-9_-]/g, '');
            } else if (key === 'summary') {
                // Allow label:n:mean:sd,... format (colons, periods, commas, spaces, hyphens)
                sanitized = sanitized.replace(/[^a-zA-Z0-9_.:, -]/g, '').slice(0, 2000);
            } else if (key === 'alt') {
                // Alternative hypothesis direction
                sanitized = sanitized.replace(/[^a-z-]/g, '');
                if (!['less', 'greater', 'two-sided'].includes(sanitized)) {
                    continue;
                }
            } else if (key === 'label' || key === 'units' || key === 'x_label' || key === 'y_label') {
                // Display-facing params: preserve case, allow spaces
                sanitized = sanitized.replace(/[^a-zA-Z0-9_ ()-]/g, '').slice(0, 200);
            } else {
                // General string params: alphanumeric + underscore, lowercased
                sanitized = sanitized.replace(/[^a-zA-Z0-9_ -]/g, '').toLowerCase();
            }
            if (sanitized.length > 0) {
                /** @type {any} */ (params)[key] = sanitized;
            }
        }
        // Unknown params are silently ignored
    }

    return params;
}
