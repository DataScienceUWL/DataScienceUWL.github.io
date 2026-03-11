// @ts-check
import { initDistCalculator } from '../../js/dist-app.js';
import { pdfF, fCDF, fInv, setJStat } from '../../js/distributions.js';

import('jstat').then(jstat => {
  setJStat(jstat.default || jstat);

  initDistCalculator({
    name: 'F',
    type: 'F',
    xSymbol: 'F',
    params: [
      { id: 'param-df1', label: 'Numerator df', paramKey: 'df1', defaultValue: 3, min: 1 },
      { id: 'param-df2', label: 'Denominator df', paramKey: 'df2', defaultValue: 20, min: 1 },
    ],
    pdfFactory: (p) => (x) => pdfF(x, p.df1, p.df2),
    cdfFactory: (p) => (x) => fCDF(x, p.df1, p.df2),
    invFactory: (p) => (prob) => fInv(prob, p.df1, p.df2),
    domainParams: (p) => ({ df1: p.df1, df2: p.df2, invCdf: (prob) => fInv(prob, p.df1, p.df2) }),
  });
});
