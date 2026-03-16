// @ts-check
import { initDistCalculator } from '../../js/dist-app.js';
import { pdfT, tCDF, tInv, setJStat } from '../../js/distributions.js';

import('jstat').then(jstat => {
  setJStat(jstat.default || jstat);

  initDistCalculator({
    name: 't',
    type: 't',
    xSymbol: 't',
    params: [
      { id: 'param-df', label: 'Degrees of freedom (df)', paramKey: 'df', defaultValue: 10, min: 1 },
    ],
    pdfFactory: (p) => (x) => pdfT(x, p.df),
    cdfFactory: (p) => (x) => tCDF(x, p.df),
    invFactory: (p) => (prob) => tInv(prob, p.df),
    domainParams: (p) => ({ df: p.df }),
  });
});
