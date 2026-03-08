// @ts-check

/**
 * Seeded PRNG module — sfc32 algorithm with cyrb128 seed hashing.
 * Zero dependencies, fully deterministic across all browsers.
 * @module prng
 */

/**
 * Hash a string seed into four 32-bit unsigned integers.
 * @param {string} str
 * @returns {[number, number, number, number]}
 */
function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277,
        h3 = 1013904242, h4 = 2773480762;
    for (let i = 0, k; i < str.length; i++) {
        k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    return [(h1^h2^h3^h4)>>>0, (h2^h1)>>>0, (h3^h1)>>>0, (h4^h1)>>>0];
}

/**
 * sfc32 PRNG — 128-bit state, passes PractRand.
 * @param {number} a
 * @param {number} b
 * @param {number} c
 * @param {number} d
 * @returns {() => number} Function returning next float in [0, 1)
 */
function sfc32(a, b, c, d) {
    return function() {
        a |= 0; b |= 0; c |= 0; d |= 0;
        let t = (a + b | 0) + d | 0;
        d = d + 1 | 0;
        a = b ^ b >>> 9;
        b = c + (c << 3) | 0;
        c = (c << 21 | c >>> 11);
        c = c + t | 0;
        return (t >>> 0) / 4294967296;
    };
}

/**
 * Create a seeded PRNG (sfc32 algorithm with cyrb128 seed hash).
 * @param {string|number} seed - Seed value (converted to string internally)
 * @returns {() => number} A function that returns the next float in [0, 1)
 */
export function createRng(seed) {
    const [a, b, c, d] = cyrb128(String(seed));
    return sfc32(a, b, c, d);
}

/**
 * Fisher-Yates in-place shuffle.
 * @param {Array<*>} arr - Array to shuffle (MUTATED in place)
 * @param {() => number} rng - PRNG function from createRng()
 * @returns {Array<*>} The same array reference, now shuffled
 */
export function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = (rng() * (i + 1)) | 0;
        const tmp = arr[i];
        arr[i] = arr[j];
        arr[j] = tmp;
    }
    return arr;
}

/**
 * Sample n items from arr with replacement.
 * @param {Array<*>} arr - Source array (not mutated)
 * @param {number} n - Number of items to draw
 * @param {() => number} rng - PRNG function
 * @returns {Array<*>} New array of length n
 * @throws {RangeError} If arr is empty or n < 0
 */
export function sampleWithReplacement(arr, n, rng) {
    if (arr.length === 0 && n > 0) {
        throw new RangeError('Cannot sample from empty array');
    }
    if (n < 0) {
        throw new RangeError('n must be non-negative');
    }
    const result = new Array(n);
    for (let i = 0; i < n; i++) {
        result[i] = arr[(rng() * arr.length) | 0];
    }
    return result;
}

/**
 * Random integer in [lo, hi] (inclusive both ends).
 * @param {number} lo - Lower bound (integer)
 * @param {number} hi - Upper bound (integer)
 * @param {() => number} rng - PRNG function
 * @returns {number} Integer in [lo, hi]
 */
export function randInt(lo, hi, rng) {
    if (lo > hi) { const tmp = lo; lo = hi; hi = tmp; }
    return lo + ((rng() * (hi - lo + 1)) | 0);
}

/**
 * Generate a normally-distributed random variate via Box-Muller transform.
 * @param {number} mu - Mean
 * @param {number} sigma - Standard deviation
 * @param {() => number} rng - PRNG function
 * @returns {number} A single normal variate
 */
export function randNormal(mu, sigma, rng) {
    if (sigma === 0) return mu;
    const u1 = rng();
    const u2 = rng();
    return mu + sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Export cyrb128 for testing
export { cyrb128 };
