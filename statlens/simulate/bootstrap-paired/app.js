// @ts-check
/**
 * Bootstrap CI: Paired Differences page.
 * Takes two paired numeric columns, computes differences (col2 − col1),
 * then bootstraps the differences to build a CI for the mean difference.
 */

import { initSimPage } from '../../js/sim-app.js';

initSimPage({
  mode: 'bootstrap',
  paired: true,
});
