// @ts-check
import { initDistCalculator } from '../../js/dist-app.js';
import { pdfChisq, chisqCDF, chisqInv, setJStat } from '../../js/distributions.js';

import('jstat').then(jstat => {
  setJStat(jstat.default || jstat);

  initDistCalculator({
    name: 'Chi-Square',
    type: 'chisq',
    xSymbol: 'χ²',
    params: [
      { id: 'param-df', label: 'Degrees of freedom (df)', paramKey: 'df', defaultValue: 5, min: 1 },
    ],
    pdfFactory: (p) => (x) => pdfChisq(x, p.df),
    cdfFactory: (p) => (x) => chisqCDF(x, p.df),
    invFactory: (p) => (prob) => chisqInv(prob, p.df),
    domainParams: (p) => ({ df: p.df, invCdf: (prob) => chisqInv(prob, p.df) }),
  });
});
