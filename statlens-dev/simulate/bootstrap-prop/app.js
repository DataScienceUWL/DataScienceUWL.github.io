// @ts-check
/**
 * Bootstrap CI: One Proportion page.
 * Resamples binary (0/1) data with replacement to build a bootstrap
 * distribution of p̂. The distribution is discrete and "lumpy" —
 * a key pedagogical contrast with the smooth bootstrap mean distribution.
 */

import { initSimPage } from '../../js/sim-app.js';

initSimPage({
  mode: 'bootstrap',
  proportion: true,
});
