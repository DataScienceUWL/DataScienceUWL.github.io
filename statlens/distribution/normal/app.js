// @ts-check
import { initDistCalculator } from '../../js/dist-app.js';
import { pdfNormal, normalCDF, normalInv, setJStat } from '../../js/distributions.js';

// In browser, jStat is loaded via importmap
import('jstat').then(jstat => {
  setJStat(jstat.default || jstat);

  initDistCalculator({
    name: 'Normal',
    type: 'normal',
    xSymbol: 'z',
    xSymbolFactory: (p) => (p.mu === 0 && p.sigma === 1) ? 'z' : 'x',
    params: [
      { id: 'param-mu', label: 'Mean (μ)', paramKey: 'mu', defaultValue: 0 },
      { id: 'param-sigma', label: 'SD (σ)', paramKey: 'sigma', defaultValue: 1, min: 0.001, step: 'any' },
    ],
    pdfFactory: (p) => (x) => pdfNormal(x, p.mu, p.sigma),
    cdfFactory: (p) => (x) => normalCDF(x, p.mu, p.sigma),
    invFactory: (p) => (prob) => normalInv(prob, p.mu, p.sigma),
    domainParams: (p) => ({ mu: p.mu, sigma: p.sigma }),
  });
});
