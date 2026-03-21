// @ts-check
/**
 * Bootstrap CI: Difference in Proportions page.
 * Resamples two groups of binary (0/1) data independently to build
 * a bootstrap distribution of p̂₁ − p̂₂.
 */

import { initSimPage } from '../../js/sim-app.js';

initSimPage({
  mode: 'bootstrap',
  twoGroup: true,
  proportion: true,
});
