// @ts-check
import { initSimPage } from '../../js/sim-app.js';
import { mean } from '../../js/stats.js';

initSimPage({
  mode: 'randomization',
  statLabel: 'Difference in Means',
  twoGroup: true,
  testStat: (g1, g2) => mean(g1) - mean(g2),
});
