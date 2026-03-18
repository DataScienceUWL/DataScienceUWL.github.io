// @ts-check
/**
 * Randomization Test: Paired Differences page.
 * Takes two paired numeric columns, computes differences (col2 − col1),
 * then randomly flips the sign of each difference to simulate the null
 * distribution under H₀: μ_d = 0.
 */

import { initSimPage } from '../../js/sim-app.js';

initSimPage({
  mode: 'randomization',
  paired: true,
  statLabel: 'Mean Difference',
});
