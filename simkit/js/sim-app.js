// @ts-check
/**
 * Shared simulation page logic for SimKit.
 * Handles data input (URL params, paste), simulation controls, chart rendering, and results.
 */

import { parseParams } from './url-params.js';
import { parseCSV } from './csv-parser.js';
import { createRng } from './prng.js';
import { mean, median, sd, quantile, resample, permute } from './stats.js';
import { bootstrapCI, permutationPValue } from './sim-engine.js';
import { drawHistogram } from './histogram.js';
import { drawDotplot } from './dotplot.js';
/**
 * @typedef {object} SimConfig
 * @property {'bootstrap'|'randomization'} mode
 * @property {string} [statLabel] - Display label for the statistic (randomization mode)
 * @property {(g1: number[], g2: number[]) => number} [testStat] - For randomization: compute observed stat
 * @property {boolean} [twoGroup] - Whether this is a two-group test
 * @property {boolean} [proportion] - Whether this is a proportion-based test (categorical outcome encoded as 0/1)
 */

/**
 * Initialize a simulation page.
 * @param {SimConfig} config
 */
export function initSimPage(config) {
  const urlParams = parseParams(window.location.search);

  // DOM elements
  const chartContainer = document.getElementById('chart-container');
  const resultDiv = document.getElementById('result-summary');
  const announceDiv = document.getElementById('sr-announce');
  const resetBtn = /** @type {HTMLButtonElement} */ (document.getElementById('reset-btn'));
  const ciSelect = /** @type {HTMLSelectElement} */ (document.getElementById('ci-level'));
  const seedNotice = document.getElementById('seed-notice');
  const dataSummary = document.getElementById('data-summary');
  const dataPreview = document.getElementById('data-preview');
  const pasteArea = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-area'));
  const loadPastedBtn = document.getElementById('load-pasted');
  const clearBtn = document.getElementById('clear-btn');
  const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
  const datasetDesc = document.getElementById('dataset-desc');
  const bootStatSelect = /** @type {HTMLSelectElement} */ (document.getElementById('boot-stat'));

  // Bootstrap stat functions keyed by select value
  /** @type {Record<string, {fn: (d: number[]) => number, label: string}>} */
  const BOOT_STATS = {
    mean:   { fn: (d) => mean(d),             label: 'Sample Mean' },
    median: { fn: (d) => median(d),           label: 'Sample Median' },
    sd:     { fn: (d) => sd(d),               label: 'Sample Std Dev' },
    q1:     { fn: (d) => quantile(d, 0.25),   label: 'Q1 (25th %ile)' },
    q3:     { fn: (d) => quantile(d, 0.75),   label: 'Q3 (75th %ile)' },
  };

  /** Get the current bootstrap stat function and label. */
  function getBootstrapStat() {
    const key = bootStatSelect?.value ?? 'mean';
    return BOOT_STATS[key] ?? BOOT_STATS.mean;
  }

  // Generate bar buttons
  const genBtns = /** @type {NodeListOf<HTMLButtonElement>} */ (
    document.querySelectorAll('.gen-btn'));

  // Mechanism strip elements
  const mechanismStrip = document.getElementById('mechanism-strip');
  const mechanismDescEl = document.getElementById('mechanism-description');

  // One-sample bootstrap mechanism (specific elements)
  const originalContentEl = document.getElementById('original-sample-content');
  const resampleContentEl = document.getElementById('resample-content');
  const bootstrapSampleEl = document.getElementById('bootstrap-sample');
  const origNEl = document.getElementById('orig-n');
  const origMeanEl = document.getElementById('orig-mean');
  const resampleMeanEl = document.getElementById('resample-mean');
  const resampleToggle = document.getElementById('resample-view-toggle');

  // Two-group mechanism (bootstrap two-sample and randomization)
  const mechOriginalContent = document.getElementById('mech-original-content');
  const mechResampleContent = document.getElementById('mech-resample-content');

  /** Threshold: show individual chips below this, histogram above. */
  const CHIP_THRESHOLD = 30;
  /** @type {'summary'|'histogram'} */
  let resampleViewMode = 'summary';
  /** @type {number[]} */
  let lastResample = [];

  // Tab handling
  const tabs = document.querySelectorAll('[role="tab"]');
  const panels = document.querySelectorAll('[role="tabpanel"]');
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const t of tabs) t.setAttribute('aria-selected', 'false');
      for (const p of panels) p.hidden = true;
      tab.setAttribute('aria-selected', 'true');
      const panelId = tab.getAttribute('aria-controls');
      const panel = document.getElementById(panelId);
      if (panel) panel.hidden = false;
    });
  }

  // Hypothesis display elements (randomization tests)
  const hypothesisDisplay = document.getElementById('hypothesis-display');
  const altDirectionSelect = /** @type {HTMLSelectElement} */ (document.getElementById('alt-direction'));
  const swapGroupsBtn = document.getElementById('swap-groups');
  const hGroup1 = document.getElementById('h-group1');
  const hGroup2 = document.getElementById('h-group2');
  const haGroup1 = document.getElementById('ha-group1');
  const haGroup2 = document.getElementById('ha-group2');

  // Success outcome selector (proportion tests)
  const successSelector = document.getElementById('success-selector');
  const successOutcomeSelect = /** @type {HTMLSelectElement} */ (document.getElementById('success-outcome'));

  /** @type {number[]} */
  let data1 = [];
  /** @type {number[]} */
  let data2 = [];
  let group1Name = 'Group 1';
  let group2Name = 'Group 2';

  // Raw categorical data for proportion tests (needed for re-encoding on success change)
  /** @type {string[]} */
  let rawOutcomes1 = [];
  /** @type {string[]} */
  let rawOutcomes2 = [];
  let successOutcome = '';

  // Accumulated stats and RNG
  /** @type {number[]} */
  let allStats = [];
  /** @type {(() => number)|null} */
  let rng = null;

  // Seed: use URL seed for reproducibility (graded work), otherwise random each session
  const urlSeed = urlParams.seed;
  let seed = urlSeed ?? Math.random().toString(36).slice(2, 10);
  if (urlSeed && seedNotice) {
    seedNotice.hidden = false;
    seedNotice.textContent = `Seed: ${urlSeed}`;
  }

  // Apply URL params
  if (urlParams.data) {
    data1 = urlParams.data;
    showDataLoaded();
  }
  if (urlParams.ci && ciSelect) {
    ciSelect.value = String(urlParams.ci);
  }

  // ─── Data loading ───

  if (loadPastedBtn && pasteArea) {
    loadPastedBtn.addEventListener('click', () => {
      const text = pasteArea.value.trim();
      if (!text) return;

      try {
        const parsed = parseCSV(text);
        if (parsed.headers.length > 0 && parsed.data.length > 0) {
          const numIdx = parsed.types.indexOf('numeric');
          const catIdx = parsed.types.indexOf('categorical');

          if (config.proportion) {
            // Proportion test: two categorical columns
            const catIndices = parsed.types
              .map((t, i) => t === 'categorical' ? i : -1)
              .filter(i => i >= 0);
            if (catIndices.length >= 2) {
              const groupCol = parsed.headers[catIndices[0]];
              const outcomeCol = parsed.headers[catIndices[1]];
              const groups = [...new Set(parsed.data.map(r => r[groupCol]))];
              const outcomes = [...new Set(parsed.data.map(r => r[outcomeCol]))];
              if (groups.length >= 2) {
                group1Name = groups[0];
                group2Name = groups[1];
                rawOutcomes1 = parsed.data
                  .filter(r => r[groupCol] === groups[0])
                  .map(r => r[outcomeCol]);
                rawOutcomes2 = parsed.data
                  .filter(r => r[groupCol] === groups[1])
                  .map(r => r[outcomeCol]);
                populateSuccessSelector(outcomes);
                encodeProportionData();
                showDataLoaded();
                return;
              }
            }
          } else if (config.twoGroup && catIdx >= 0 && numIdx >= 0) {
            const groupCol = parsed.headers[catIdx];
            const valCol = parsed.headers[numIdx];
            const groups = [...new Set(parsed.data.map(r => r[groupCol]))];
            if (groups.length >= 2) {
              group1Name = groups[0];
              group2Name = groups[1];
              data1 = parsed.data
                .filter(r => r[groupCol] === groups[0])
                .map(r => parseFloat(r[valCol]))
                .filter(v => isFinite(v));
              data2 = parsed.data
                .filter(r => r[groupCol] === groups[1])
                .map(r => parseFloat(r[valCol]))
                .filter(v => isFinite(v));
              showDataLoaded();
              return;
            }
          }

          if (numIdx >= 0) {
            const colName = parsed.headers[numIdx];
            data1 = parsed.data
              .map(row => parseFloat(row[colName]))
              .filter(v => isFinite(v));
            showDataLoaded();
            return;
          }
        }
      } catch {
        // Fall through to simple parse
      }

      const values = text.split(/[\n,]+/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(Number)
        .filter(v => isFinite(v));

      if (values.length > 0) {
        data1 = values;
        showDataLoaded();
      }
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      data1 = [];
      data2 = [];
      resetSimulation();
      if (pasteArea) pasteArea.value = '';
      if (dataPreview) dataPreview.hidden = true;
      if (dataSummary) dataSummary.textContent = '\u2014';
      for (const btn of genBtns) btn.disabled = true;
      if (mechanismStrip) mechanismStrip.hidden = true;
      if (successSelector) successSelector.hidden = true;
      if (hypothesisDisplay) hypothesisDisplay.hidden = true;
      const groupOrderEl = document.getElementById('group-order');
      if (groupOrderEl) groupOrderEl.hidden = true;
      announce('Data cleared.');
    });
  }

  function showDataLoaded() {
    if (dataPreview) dataPreview.hidden = false;
    if (dataSummary) {
      if (config.proportion && data2.length > 0) {
        const p1 = mean(data1);
        const p2 = mean(data2);
        const s1 = data1.filter(v => v === 1).length;
        const s2 = data2.filter(v => v === 1).length;
        dataSummary.textContent =
          `${group1Name}: ${s1}/${data1.length} (p̂ = ${p1.toFixed(3)}) | ` +
          `${group2Name}: ${s2}/${data2.length} (p̂ = ${p2.toFixed(3)})`;
      } else if (config.twoGroup && data2.length > 0) {
        dataSummary.textContent =
          `${group1Name}: n = ${data1.length}, x̄ = ${mean(data1).toFixed(2)} | ` +
          `${group2Name}: n = ${data2.length}, x̄ = ${mean(data2).toFixed(2)}`;
      } else {
        const n = data1.length;
        const m = mean(data1);
        const s = sd(data1);
        dataSummary.textContent = `n = ${n}, mean = ${m.toFixed(2)}, SD = ${s.toFixed(2)}`;
      }
    }
    for (const btn of genBtns) btn.disabled = false;
    // Clear stale results
    resultDiv.innerHTML = '<p class="hint">Data loaded. Click a generate button to begin.</p>';
    // Show mechanism strip
    if (mechanismStrip) {
      if (config.mode === 'bootstrap' && !config.twoGroup && originalContentEl) {
        // One-sample bootstrap: original sample chips/histogram
        mechanismStrip.hidden = false;
        renderOriginalSample();
      } else if (config.twoGroup) {
        // Two-group: show original group summaries
        mechanismStrip.hidden = false;
        renderTwoGroupOriginal();
      }
    }
    // Show hypothesis display (randomization tests)
    if (config.mode === 'randomization' && config.twoGroup && hypothesisDisplay) {
      hypothesisDisplay.hidden = false;
      updateHypothesisDisplay();
    }
    // Show group order (two-sample bootstrap)
    const groupOrderEl = document.getElementById('group-order');
    const groupOrderLabel = document.getElementById('group-order-label');
    if (config.mode === 'bootstrap' && config.twoGroup && groupOrderEl && groupOrderLabel) {
      groupOrderEl.hidden = false;
      groupOrderLabel.textContent = `${group1Name} − ${group2Name}`;
    }
    announce(`Data loaded: n = ${data1.length}`);
  }

  function updateHypothesisDisplay() {
    if (hGroup1) hGroup1.textContent = group1Name;
    if (hGroup2) hGroup2.textContent = group2Name;
    if (haGroup1) haGroup1.textContent = group1Name;
    if (haGroup2) haGroup2.textContent = group2Name;
  }

  // ─── Proportion helpers ───

  /**
   * Populate the success-outcome dropdown with available outcomes.
   * @param {string[]} outcomes
   */
  function populateSuccessSelector(outcomes) {
    if (!successOutcomeSelect || !successSelector) return;
    successOutcomeSelect.innerHTML = '';
    for (const o of outcomes) {
      const opt = document.createElement('option');
      opt.value = o;
      opt.textContent = o;
      successOutcomeSelect.appendChild(opt);
    }
    successOutcome = outcomes[0];
    successSelector.hidden = false;
  }

  /** Encode raw categorical outcomes as 1 (success) / 0 (not success). */
  function encodeProportionData() {
    data1 = rawOutcomes1.map(o => o === successOutcome ? 1 : 0);
    data2 = rawOutcomes2.map(o => o === successOutcome ? 1 : 0);
  }

  // Success outcome change → re-encode and reset
  if (successOutcomeSelect) {
    successOutcomeSelect.addEventListener('change', () => {
      successOutcome = successOutcomeSelect.value;
      encodeProportionData();
      if (allStats.length > 0) resetSimulation();
      showDataLoaded();
      announce(`Success outcome changed to "${successOutcome}".`);
    });
  }

  // ─── Dataset selector ───

  /**
   * Resolve the path to the data/ directory from the current page.
   * Uses the <base> href or infers from the CSS stylesheet link.
   */
  function dataPath(file) {
    // Try to compute from the known CSS path (../../../css/style.css → ../../../data/)
    const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
    if (link) {
      const href = link.getAttribute('href');
      const prefix = href.replace(/css\/style\.css$/, '');
      return `${prefix}data/${file}`;
    }
    // Fallback: assume root-relative
    return `/data/${file}`;
  }

  /** @type {Array<{id:string,name:string,description:string,type:string,chapter:string,n:number}>} */
  let datasetIndex = [];

  if (datasetSelect) {
    fetch(dataPath('datasets.json'))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((index) => {
        const relevant = index.filter(ds => {
          if (config.mode === 'bootstrap' && config.twoGroup) return ds.type === 'randomization';
          if (config.mode === 'bootstrap') return ds.type === 'bootstrap';
          if (config.proportion) return ds.type === 'randomization_prop';
          if (config.twoGroup) return ds.type === 'randomization';
          return ds.type === 'randomization' || ds.type === 'randomization_prop';
        });
        datasetIndex = relevant;

        for (const ds of relevant) {
          const opt = document.createElement('option');
          opt.value = ds.id;
          opt.textContent = `${ds.name} (n = ${ds.n})`;
          datasetSelect.appendChild(opt);
        }
      })
      .catch(() => {
        if (datasetDesc) datasetDesc.textContent = 'Could not load datasets.';
      });

    datasetSelect.addEventListener('change', () => {
      const id = datasetSelect.value;
      if (!id) {
        if (datasetDesc) datasetDesc.textContent = '';
        return;
      }
      const meta = datasetIndex.find(d => d.id === id);
      if (meta && datasetDesc) {
        datasetDesc.textContent = meta.description;
      }
      loadDataset(id);
    });
  }

  /**
   * Fetch and load a bundled dataset by ID.
   * @param {string} id
   */
  function loadDataset(id) {
    fetch(dataPath(`${id}.json`))
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((ds) => {
        resetSimulation();

        if (config.mode === 'bootstrap' && !config.twoGroup) {
          // Single numeric variable — extract first numeric column
          const numVar = ds.variables.find(v => v.type === 'numeric');
          if (!numVar) return;
          data1 = ds.rows.map(r => r[numVar.name]).filter(v => isFinite(v));
          data2 = [];
        } else if (config.proportion) {
          // Two categorical variables: group + outcome → encode as 0/1
          const catVars = ds.variables.filter(v => v.type === 'categorical');
          if (catVars.length < 2) return;
          const groupVar = catVars[0];
          const outcomeVar = catVars[1];
          const groups = [...new Set(ds.rows.map(r => r[groupVar.name]))];
          const outcomes = [...new Set(ds.rows.map(r => r[outcomeVar.name]))];
          group1Name = groups[0];
          group2Name = groups[1];
          rawOutcomes1 = ds.rows
            .filter(r => r[groupVar.name] === groups[0])
            .map(r => r[outcomeVar.name]);
          rawOutcomes2 = ds.rows
            .filter(r => r[groupVar.name] === groups[1])
            .map(r => r[outcomeVar.name]);
          populateSuccessSelector(outcomes);
          encodeProportionData();
        } else {
          // Two-group: categorical grouping + numeric outcome
          const catVar = ds.variables.find(v => v.type === 'categorical');
          const numVar = ds.variables.find(v => v.type === 'numeric');
          if (!catVar || !numVar) return;
          const groups = [...new Set(ds.rows.map(r => r[catVar.name]))];
          group1Name = groups[0];
          group2Name = groups[1];
          data1 = ds.rows
            .filter(r => r[catVar.name] === groups[0])
            .map(r => r[numVar.name])
            .filter(v => isFinite(v));
          data2 = ds.rows
            .filter(r => r[catVar.name] === groups[1])
            .map(r => r[numVar.name])
            .filter(v => isFinite(v));
        }

        showDataLoaded();
        announce(`Loaded dataset: ${ds.name}`);
      })
      .catch(() => {
        announce('Failed to load dataset.');
      });
  }

  /** Map alternative hypothesis selection to tail direction. */
  function getDirection() {
    const alt = altDirectionSelect?.value ?? 'greater';
    if (alt === 'greater') return /** @type {const} */ ('right');
    if (alt === 'less') return /** @type {const} */ ('left');
    return /** @type {const} */ ('both');
  }

  // Swap groups button
  if (swapGroupsBtn) {
    swapGroupsBtn.addEventListener('click', () => {
      [data1, data2] = [data2, data1];
      [group1Name, group2Name] = [group2Name, group1Name];
      [rawOutcomes1, rawOutcomes2] = [rawOutcomes2, rawOutcomes1];
      if (allStats.length > 0) resetSimulation();
      showDataLoaded();
      announce(`Swapped groups: ${group1Name} − ${group2Name}`);
    });
  }

  // Alt hypothesis change → reset if simulation has run (tail changed)
  if (altDirectionSelect) {
    altDirectionSelect.addEventListener('change', () => {
      if (allStats.length > 0) {
        // Re-render chart with new tail shading without resetting
        const observedStat = config.testStat(data1, data2);
        const direction = getDirection();
        renderChart(allStats, null, observedStat, direction);
        const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
        displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);
      }
    });
  }

  // ─── Generate bar ───

  for (const btn of genBtns) {
    btn.addEventListener('click', () => {
      const count = parseInt(btn.dataset.count, 10);
      if (data1.length === 0) {
        announce('Please load data first.');
        return;
      }
      generateSamples(count);
    });
  }

  /**
   * Generate N samples/permutations and add to the accumulation.
   * @param {number} count
   */
  function generateSamples(count) {
    if (!rng) rng = createRng(seed);

    if (config.mode === 'bootstrap') {
      const statFn = getBootstrapStat().fn;
      /** @type {number[]} */
      let lastResampleValues = [];

      if (config.twoGroup && data2.length > 0) {
        // Two-sample bootstrap: resample each group independently
        /** @type {number[]} */ let lastRs1 = [];
        /** @type {number[]} */ let lastRs2 = [];
        for (let i = 0; i < count; i++) {
          const rs1 = resample(data1, rng);
          const rs2 = resample(data2, rng);
          lastRs1 = rs1;
          lastRs2 = rs2;
          const stat = statFn(rs1) - statFn(rs2);
          allStats.push(stat);
        }
        showTwoGroupMechanism(lastRs1, lastRs2, count === 1);
      } else {
        // One-sample bootstrap
        for (let i = 0; i < count; i++) {
          const rs = resample(data1, rng);
          lastResampleValues = rs;
          allStats.push(statFn(rs));
        }
      }

      const ciLevel = parseInt(ciSelect?.value ?? '95', 10);
      let ci = null;
      const CI_MIN = 20; // Don't show CI lines until this many resamples
      if (allStats.length >= 10) {
        const result = bootstrapCI([...allStats], ciLevel);
        ci = result.ci;
        displayBootstrapResults(allStats, result.ci, result.se, ciLevel);
      } else {
        resultDiv.innerHTML = `<p><strong>Bootstrap Distribution</strong> (${allStats.length} resamples)</p>
          <p>Need at least 10 resamples for CI estimate.</p>`;
      }
      // Track new dots for highlight (only in dotplot range)
      if (allStats.length <= 200) {
        if (count === 1) {
          lastStatIndex = allStats.length - 1;
        } else {
          batchHighlightIndices = new Set();
          for (let j = allStats.length - count; j < allStats.length; j++) {
            batchHighlightIndices.add(j);
          }
        }
      }
      // Only show CI lines once we have enough resamples for stability
      renderChart(allStats, allStats.length >= CI_MIN ? ci : null);

      // Show last resample in mechanism strip (one-sample only)
      if (!config.twoGroup) {
        lastResample = lastResampleValues;
        showResample(lastResampleValues, count === 1);
      }

      announce(`Generated ${count} resample${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
    } else {
      const observedStat = config.testStat(data1, data2);
      const direction = getDirection();

      /** @type {number[]} */ let lastG1 = [];
      /** @type {number[]} */ let lastG2 = [];
      for (let i = 0; i < count; i++) {
        const [g1, g2] = permute(data1, data2, rng);
        lastG1 = g1;
        lastG2 = g2;
        const stat = config.testStat(g1, g2);
        allStats.push(stat);
      }

      showTwoGroupMechanism(lastG1, lastG2, count === 1);
      if (allStats.length <= 200) {
        if (count === 1) {
          lastStatIndex = allStats.length - 1;
        } else {
          batchHighlightIndices = new Set();
          for (let j = allStats.length - count; j < allStats.length; j++) {
            batchHighlightIndices.add(j);
          }
        }
      }
      renderChart(allStats, null, observedStat, direction);
      const { pValue, extremeCount } = permutationPValue(allStats, observedStat, direction);
      displayRandomizationResults(allStats, observedStat, pValue, extremeCount, direction);
      announce(`Generated ${count} shuffle${count > 1 ? 's' : ''}. Total: ${allStats.length}`);
    }

    if (resetBtn) resetBtn.hidden = false;
  }

  // ─── Resample visualization ───

  function renderOriginalSample() {
    if (!originalContentEl) return;
    originalContentEl.innerHTML = '';

    if (data1.length <= CHIP_THRESHOLD) {
      // Small dataset: show individual value chips
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Original sample values');
      const sorted = [...data1].sort((a, b) => a - b);
      for (const v of sorted) {
        const dot = document.createElement('span');
        dot.className = 'sample-dot';
        dot.textContent = formatChipValue(v);
        dot.title = String(v);
        container.appendChild(dot);
      }
      originalContentEl.appendChild(container);
    } else {
      // Large dataset: show mini histogram
      const container = document.createElement('div');
      container.className = 'mini-chart';
      drawHistogram(container, data1, {
        id: 'orig-hist',
        xLabel: '',
        titleText: 'Original sample distribution',
        numBins: Math.min(Math.ceil(Math.sqrt(data1.length)), 40),
        animate: false,
        margin: { top: 5, right: 10, bottom: 25, left: 35 },
      });
      originalContentEl.appendChild(container);
    }

    if (origNEl) origNEl.textContent = String(data1.length);
    if (origMeanEl) origMeanEl.textContent = mean(data1).toFixed(2);
  }

  // ─── Two-group mechanism strip ───

  /** Render original group summaries in the mechanism strip. */
  function renderTwoGroupOriginal() {
    if (!mechOriginalContent) return;
    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;
    const statSymbol = config.proportion ? 'p̂' : 'x̄';
    const s1 = statFn(data1);
    const s2 = statFn(data2);
    mechOriginalContent.innerHTML = `
      <div class="mech-group-row"><span class="mech-group-name">${group1Name}:</span>
        <span class="mech-group-stat">n = ${data1.length}, ${statSymbol} = ${s1.toFixed(4)}</span></div>
      <div class="mech-group-row"><span class="mech-group-name">${group2Name}:</span>
        <span class="mech-group-stat">n = ${data2.length}, ${statSymbol} = ${s2.toFixed(4)}</span></div>
      <div class="mech-diff">diff = ${(s1 - s2).toFixed(4)}</div>
    `;
  }

  /**
   * Show the two-group mechanism after a simulation step.
   * @param {number[]} g1 - Group 1 values (resample or shuffled)
   * @param {number[]} g2 - Group 2 values (resample or shuffled)
   * @param {boolean} [flash]
   */
  function showTwoGroupMechanism(g1, g2, flash = false) {
    if (!mechResampleContent || !mechanismDescEl) return;
    const statFn = config.mode === 'bootstrap' ? getBootstrapStat().fn : mean;
    const statSymbol = config.proportion ? 'p̂' : 'x̄';
    const s1 = statFn(g1);
    const s2 = statFn(g2);
    mechResampleContent.innerHTML = `
      <div class="mech-group-row"><span class="mech-group-name">${group1Name}:</span>
        <span class="mech-group-stat">n = ${g1.length}, ${statSymbol} = ${s1.toFixed(4)}</span></div>
      <div class="mech-group-row"><span class="mech-group-name">${group2Name}:</span>
        <span class="mech-group-stat">n = ${g2.length}, ${statSymbol} = ${s2.toFixed(4)}</span></div>
      <div class="mech-diff">diff = ${(s1 - s2).toFixed(4)}</div>
    `;

    if (config.mode === 'bootstrap') {
      mechanismDescEl.textContent = 'Resample each group independently with replacement';
    } else {
      mechanismDescEl.textContent = 'Shuffle group labels · same values, new grouping';
    }
    mechanismDescEl.hidden = false;

    if (flash && mechanismStrip) {
      mechanismStrip.classList.remove('mechanism-flash');
      void mechanismStrip.offsetWidth;
      mechanismStrip.classList.add('mechanism-flash');
    }
  }

  /**
   * Show the bootstrap resample using the current view mode.
   * @param {number[]} resampleValues
   * @param {boolean} [flash] - Whether to flash the statistic (for +1)
   */
  function showResample(resampleValues, flash = false) {
    if (!resampleContentEl || !bootstrapSampleEl) return;
    bootstrapSampleEl.hidden = false;

    if (resampleViewMode === 'histogram') {
      showResampleHistogram(resampleValues);
    } else {
      showResampleSummary(resampleValues);
    }

    if (resampleMeanEl) {
      const stat = getBootstrapStat();
      resampleMeanEl.textContent = stat.fn(resampleValues).toFixed(4);
      const statLabelEl = document.getElementById('resample-stat-label');
      if (statLabelEl) {
        const shortName = stat.label.replace('Sample ', '').toLowerCase();
        statLabelEl.textContent = `Resample ${shortName}`;
      }
    }
    if (resampleToggle) {
      resampleToggle.textContent = resampleViewMode === 'summary' ? 'Histogram' : 'Summary';
    }

    // Mechanism description: summarize what "with replacement" did
    if (mechanismDescEl) {
      /** @type {Map<number, number>} */
      const counts = new Map();
      for (const v of resampleValues) {
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const uniqueOriginal = new Set(data1);
      let notSelected = 0;
      let repeated = 0;
      for (const v of uniqueOriginal) {
        const c = counts.get(v) ?? 0;
        if (c === 0) notSelected++;
        if (c > 1) repeated++;
      }
      mechanismDescEl.textContent =
        `Resample with replacement · ${repeated} value${repeated !== 1 ? 's' : ''} repeated · ${notSelected} not selected`;
      mechanismDescEl.hidden = false;
    }

    // Flash animation for +1 to emphasize statistic → dot connection
    if (flash && mechanismStrip) {
      mechanismStrip.classList.remove('mechanism-flash');
      // Force reflow to restart animation
      void mechanismStrip.offsetWidth;
      mechanismStrip.classList.add('mechanism-flash');
    }
  }

  /**
   * Summary view: chips (small n) or text counts (large n).
   * @param {number[]} resampleValues
   */
  function showResampleSummary(resampleValues) {
    resampleContentEl.innerHTML = '';

    /** @type {Map<number, number>} */
    const counts = new Map();
    for (const v of resampleValues) {
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }

    if (data1.length <= CHIP_THRESHOLD) {
      const container = document.createElement('div');
      container.className = 'sample-dots';
      container.setAttribute('role', 'img');
      container.setAttribute('aria-label', 'Bootstrap resample values');
      const sorted = [...data1].sort((a, b) => a - b);
      const remaining = new Map(counts);
      for (const v of sorted) {
        const timesDrawn = remaining.get(v) ?? 0;
        const dot = document.createElement('span');
        dot.className = 'sample-dot';
        if (timesDrawn === 0) {
          dot.classList.add('not-drawn');
        } else if (timesDrawn > 1) {
          dot.classList.add('multi-drawn');
        }
        dot.textContent = formatChipValue(v);
        dot.title = timesDrawn === 0 ? 'Not selected'
          : timesDrawn === 1 ? 'Selected once'
          : `Selected ${timesDrawn} times`;
        if (timesDrawn > 1) {
          const badge = document.createElement('sup');
          badge.className = 'draw-count';
          badge.textContent = `\u00d7${timesDrawn}`;
          dot.appendChild(badge);
        }
        container.appendChild(dot);
        if (timesDrawn > 0) {
          remaining.set(v, timesDrawn - 1);
        }
      }
      resampleContentEl.appendChild(container);
    } else {
      let notSelected = 0, once = 0, twice = 0, threeOrMore = 0;
      const uniqueOriginal = new Set(data1);
      for (const v of uniqueOriginal) {
        const c = counts.get(v) ?? 0;
        if (c === 0) notSelected++;
        else if (c === 1) once++;
        else if (c === 2) twice++;
        else threeOrMore++;
      }
      const summary = document.createElement('div');
      summary.className = 'resample-summary';
      summary.innerHTML = `
        <div class="resample-bar">
          <span class="rs-chip not-drawn">${notSelected} not selected</span>
          <span class="rs-chip">${once} selected once</span>
          <span class="rs-chip multi-drawn">${twice} selected twice</span>
          ${threeOrMore > 0 ? `<span class="rs-chip multi-drawn">${threeOrMore} selected 3+ times</span>` : ''}
        </div>
      `;
      resampleContentEl.appendChild(summary);
    }
  }

  /**
   * Histogram view: mini histogram of the resample values.
   * @param {number[]} resampleValues
   */
  function showResampleHistogram(resampleValues) {
    resampleContentEl.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'mini-chart';
    drawHistogram(container, resampleValues, {
      id: 'resample-hist',
      xLabel: '',
      titleText: 'Bootstrap resample distribution',
      numBins: Math.min(Math.ceil(Math.sqrt(resampleValues.length)), 40),
      animate: false,
      margin: { top: 5, right: 10, bottom: 25, left: 35 },
    });
    resampleContentEl.appendChild(container);
  }

  // Toggle button
  if (resampleToggle) {
    resampleToggle.addEventListener('click', () => {
      resampleViewMode = resampleViewMode === 'summary' ? 'histogram' : 'summary';
      if (lastResample.length > 0) {
        showResample(lastResample);
      }
    });
  }

  // Re-render when CI level changes
  if (ciSelect) {
    ciSelect.addEventListener('change', () => {
      if (allStats.length >= 10) {
        const ciLevel = parseInt(ciSelect.value, 10);
        const result = bootstrapCI([...allStats], ciLevel);
        displayBootstrapResults(allStats, result.ci, result.se, ciLevel);
        const CI_MIN = 20;
        renderChart(allStats, allStats.length >= CI_MIN ? result.ci : null);
      }
    });
  }

  // Reset when bootstrap stat changes (mixing stats would be meaningless)
  if (bootStatSelect) {
    bootStatSelect.addEventListener('change', () => {
      if (allStats.length > 0) {
        resetSimulation();
        // Re-show original sample since data is still loaded
        if (data1.length > 0) {
          showDataLoaded();
        }
        announce(`Statistic changed to ${getBootstrapStat().label}. Simulation reset.`);
      }
    });
  }

  /**
   * Format a value for display in a chip.
   * Uses fewer decimals for integers, more for precise values.
   * @param {number} v
   * @returns {string}
   */
  function formatChipValue(v) {
    if (Number.isInteger(v)) return String(v);
    // Show up to 2 decimal places, trimming trailing zeros
    return parseFloat(v.toFixed(2)).toString();
  }

  // ─── Reset ───

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetSimulation();
      announce('Simulation reset.');
    });
  }

  function resetSimulation() {
    allStats = [];
    rng = null;
    // New random seed each reset (unless URL-locked for graded work)
    if (!urlSeed) {
      seed = Math.random().toString(36).slice(2, 10);
    }
    chartContainer.innerHTML = '';
    resultDiv.innerHTML = '<p class="placeholder">Load data and run a simulation to see results.</p>';
    if (resetBtn) resetBtn.hidden = true;
    if (bootstrapSampleEl) bootstrapSampleEl.hidden = true;
    if (mechResampleContent) mechResampleContent.innerHTML = '';
    if (mechanismDescEl) mechanismDescEl.hidden = true;
  }

  // ─── Chart rendering ───

  /** Index of single newest dot for +1 highlight, or -1. */
  let lastStatIndex = -1;
  /** Indices of batch-added dots for +10 highlight, or null. */
  /** @type {Set<number>|null} */
  let batchHighlightIndices = null;

  /**
   * @param {number[]} stats
   * @param {[number,number]} [ci]
   * @param {number} [observedStat]
   * @param {'left'|'right'|'both'} [direction]
   */
  function renderChart(stats, ci, observedStat, direction) {
    chartContainer.innerHTML = '';
    const n = stats.length;
    const titleText = `${config.mode === 'bootstrap' ? 'Bootstrap' : 'Randomization'} Distribution`;
    let xLabel;
    if (config.mode === 'bootstrap') {
      const sl = getBootstrapStat().label;
      xLabel = config.twoGroup ? `Diff in ${sl}s` : sl;
    } else {
      xLabel = config.statLabel ?? '';
    }

    // Expand domain to include the observed stat so the line is always visible
    /** @type {[number,number]|undefined} */
    let domain;
    if (observedStat != null && stats.length > 0) {
      const lo = Math.min(...stats, observedStat);
      const hi = Math.max(...stats, observedStat);
      const pad = (hi - lo) * 0.05 || 0.5;
      domain = [lo - pad, hi + pad];
    }

    // Highlight new dots in dotplot mode
    const highlightIndex = lastStatIndex >= 0 ? lastStatIndex : -1;
    const highlightIndices = batchHighlightIndices ?? undefined;

    if (n <= 200) {
      drawDotplot(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText,
        isExtreme: observedStat != null
          ? (v) => isExtreme(v, observedStat, direction)
          : undefined,
        observedStat,
        ciLines: ci ?? undefined,
        animate: false,
        domain,
        highlightIndex,
        highlightIndices,
      });
    } else {
      drawHistogram(chartContainer, stats, {
        id: 'sim-chart',
        xLabel,
        titleText,
        isTail: observedStat != null
          ? (v) => isExtreme(v, observedStat, direction)
          : undefined,
        observedStat: observedStat ?? undefined,
        ciLines: ci ?? undefined,
        animate: false,
        domain,
      });
    }
    lastStatIndex = -1; // Reset after rendering
    batchHighlightIndices = null;
  }

  /**
   * @param {number} v
   * @param {number} obs
   * @param {'left'|'right'|'both'} [dir]
   */
  function isExtreme(v, obs, dir) {
    if (dir === 'left') return v <= obs;
    if (dir === 'both') return Math.abs(v) >= Math.abs(obs);
    return v >= obs;
  }

  function displayBootstrapResults(stats, ci, se, ciLevel) {
    const m = mean(stats);
    const statLabel = getBootstrapStat().label;
    const paramLabel = config.twoGroup
      ? `Difference in ${statLabel}s (${group1Name} − ${group2Name})`
      : statLabel;
    // Plain-language interpretation
    const shortLabel = statLabel.replace(/^Sample\s+/i, '').toLowerCase();
    const paramName = config.twoGroup
      ? `difference in population ${shortLabel}s`
      : `true population ${shortLabel}`;
    resultDiv.innerHTML = `
      <p><strong>Bootstrap Distribution</strong> (${stats.length} resamples)</p>
      <p>${paramLabel}: ${m.toFixed(4)}</p>
      <p>SE: ${se.toFixed(4)}</p>
      <p><strong>${ciLevel}% Confidence Interval:</strong> (${ci[0].toFixed(4)}, ${ci[1].toFixed(4)})</p>
      <p class="interpretation">The middle ${ciLevel}% of bootstrap statistics fall between ${ci[0].toFixed(2)} and ${ci[1].toFixed(2)}. We are ${ciLevel}% confident that the ${paramName} is in this interval.</p>
      ${stats.length < 50 ? '<p class="hint">CI is approximate with few resamples. Generate more for stability.</p>' : ''}
    `;
  }

  /**
   * @param {number[]} stats
   * @param {number} observedStat
   * @param {number} pValue
   * @param {number} extremeCount
   * @param {'left'|'right'|'both'} direction
   */
  function displayRandomizationResults(stats, observedStat, pValue, extremeCount, direction) {
    const dirLabel = direction === 'both' ? 'two-sided'
      : direction === 'right' ? 'right-tail' : 'left-tail';
    let obsLabel;
    if (config.proportion) {
      obsLabel = `p̂<sub>${group1Name}</sub> − p̂<sub>${group2Name}</sub> = ${observedStat.toFixed(4)}`;
    } else if (config.twoGroup) {
      obsLabel = `x̄<sub>${group1Name}</sub> − x̄<sub>${group2Name}</sub> = ${observedStat.toFixed(4)}`;
    } else {
      obsLabel = observedStat.toFixed(4);
    }
    // Plain-language interpretation
    let strength;
    if (pValue < 0.01) strength = 'very strong';
    else if (pValue < 0.05) strength = 'strong';
    else if (pValue < 0.10) strength = 'moderate';
    else strength = 'little';
    const nullDesc = config.proportion
      ? 'no difference in population proportions'
      : 'no difference in population means';
    resultDiv.innerHTML = `
      <p><strong>Randomization Distribution</strong> (${stats.length} shuffles)</p>
      <p>Observed statistic: ${obsLabel}</p>
      <p>Extreme count: ${extremeCount} of ${stats.length} (${dirLabel})</p>
      <p><strong>p-value:</strong> ${pValue.toFixed(4)}</p>
      <p class="interpretation">${extremeCount} of ${stats.length} shuffled statistics were at least as extreme as the observed value. This provides ${strength} evidence against H₀ (${nullDesc}).</p>
    `;
  }

  function announce(msg) {
    if (announceDiv) announceDiv.textContent = msg;
  }

  // ─── Keyboard shortcuts ───

  const helpDialog = /** @type {HTMLDialogElement} */ (document.getElementById('keyboard-help'));
  if (helpDialog) {
    document.addEventListener('keydown', (e) => {
      if (e.target !== document.body) return;
      if (e.ctrlKey || e.metaKey) return;
      if (e.key === '?') helpDialog.showModal();
      if (e.key === '1') genBtns[0]?.click();
      if (e.key === '2') genBtns[1]?.click();
      if (e.key === '3') genBtns[2]?.click();
      if (e.key === '4') genBtns[3]?.click();
      if (e.key === '0' && resetBtn && !resetBtn.hidden) resetBtn.click();
    });
    const closeBtn = helpDialog.querySelector('button');
    if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
  }
}
