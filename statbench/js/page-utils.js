// @ts-check
/**
 * Shared utilities for standalone page modules.
 * Eliminates boilerplate duplicated across simulation, explore, and conceptual pages.
 * @module page-utils
 */

import { parseCSV, rowsToCSV, downloadCSV } from './csv-parser.js';
import { getSettings, setSettings, resetSettings, applySettings, getActivityMode, prefersReducedMotion } from './settings.js';

/**
 * Resolve the path to the data/ directory from any page.
 * Uses the stylesheet href to infer the relative prefix.
 * @param {string} file - Filename within data/ (e.g., 'datasets.json')
 * @returns {string}
 */
export function dataPath(file) {
  const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
  if (link) {
    const href = link.getAttribute('href');
    const prefix = href?.replace(/css\/style\.css$/, '') ?? '';
    return `${prefix}data/${file}`;
  }
  return `/data/${file}`;
}

/**
 * Announce a message to screen readers via an aria-live region.
 * Uses requestAnimationFrame to ensure screen readers detect repeated messages.
 * @param {string} msg
 * @param {HTMLElement|null} [el] - The sr-announce element (defaults to #sr-announce)
 */
export function announce(msg, el) {
  const announceDiv = el ?? document.getElementById('sr-announce');
  if (!announceDiv) return;
  announceDiv.textContent = '';
  requestAnimationFrame(() => { announceDiv.textContent = msg; });
}

/**
 * Initialize accessible tab switching on all [role="tab"] elements in the page.
 * Handles click, ArrowLeft/ArrowRight keyboard navigation.
 */
export function initTabs() {
  const tabs = /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll('[role="tab"]')));
  const panels = /** @type {HTMLElement[]} */ (
    Array.from(document.querySelectorAll('[role="tabpanel"]')));

  for (let i = 0; i < tabs.length; i++) {
    const tab = tabs[i];

    tab.addEventListener('click', () => {
      for (const t of tabs) t.setAttribute('aria-selected', 'false');
      for (const p of panels) p.hidden = true;
      tab.setAttribute('aria-selected', 'true');
      const panelId = tab.getAttribute('aria-controls');
      const panel = document.getElementById(panelId ?? '');
      if (panel) panel.hidden = false;
    });

    tab.addEventListener('keydown', (e) => {
      let next = -1;
      if (e.key === 'ArrowRight') next = (i + 1) % tabs.length;
      else if (e.key === 'ArrowLeft') next = (i - 1 + tabs.length) % tabs.length;
      if (next >= 0) {
        e.preventDefault();
        tabs[next].focus();
        tabs[next].click();
      }
    });
  }
}

/**
 * Initialize the help button and dialog.
 * Wires the .help-btn click and ? key to open #page-help (or #keyboard-help fallback).
 * Call this on any page that has a help dialog.
 */
export function initHelp() {
  const helpDialog = /** @type {HTMLDialogElement|null} */ (
    document.getElementById('page-help')
    || document.getElementById('keyboard-help'));
  if (!helpDialog) return;

  const helpBtn = document.querySelector('.help-btn');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => helpDialog.showModal());
  }

  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '?') helpDialog.showModal();
  });

  const closeBtn = helpDialog.querySelector('button');
  if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());

  // Also init settings and steppers on every page
  initSettings();
  autoWrapSteppers();

  // Add site branding to header (upper right)
  const h1 = document.querySelector('h1');
  if (h1 && !h1.querySelector('.site-brand')) {
    const homeHref = document.querySelector('.home-btn')?.getAttribute('href') || '/';
    const brand = document.createElement('a');
    brand.className = 'site-brand';
    brand.href = homeHref;
    brand.setAttribute('aria-label', 'StatBench home');
    brand.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#569BBD"/><path d="M4 24 C4 24, 8 23, 10 20 C12 17, 13 8, 16 8 C19 8, 20 17, 22 20 C24 23, 28 24, 28 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M4 24 C4 24, 8 23, 10 20 L10 24 Z" fill="#ffffff60"/></svg> StatBench`;
    h1.appendChild(brand);
  }
}

/**
 * Initialize the settings gear button and dialog.
 * Creates the dialog dynamically so pages don't need to include it in HTML.
 * Reads/writes via settings.js module (localStorage-backed).
 */
export function initSettings() {
  applySettings();

  // Create settings dialog if it doesn't exist
  if (document.getElementById('page-settings')) return;

  const s = getSettings();
  const dialog = document.createElement('dialog');
  dialog.id = 'page-settings';
  dialog.setAttribute('aria-label', 'Settings');
  dialog.innerHTML = `
    <h2>Settings</h2>
    <div class="setting-row">
      <div>
        <label for="set-dp-pvalue" class="setting-label">P-value decimals</label>
        <p class="setting-hint">Decimal places for p-values</p>
      </div>
      <input type="number" id="set-dp-pvalue" min="2" max="8" step="1" value="${s.decimalsPValue}">
    </div>
    <div class="setting-row">
      <div>
        <label for="set-dp-stat" class="setting-label">Statistic decimals</label>
        <p class="setting-hint">Decimal places for t, z, χ², F</p>
      </div>
      <input type="number" id="set-dp-stat" min="1" max="6" step="1" value="${s.decimalsStat}">
    </div>
    <div class="setting-row">
      <div>
        <label for="set-dp-estimate" class="setting-label">Estimate decimals</label>
        <p class="setting-hint">Decimal places for means, proportions</p>
      </div>
      <input type="number" id="set-dp-estimate" min="1" max="6" step="1" value="${s.decimalsEstimate}">
    </div>
    <div class="setting-row">
      <div>
        <label for="set-alpha" class="setting-label">Significance level (α)</label>
        <p class="setting-hint">Default α for hypothesis tests</p>
      </div>
      <select id="set-alpha">
        <option value="0.01"${s.alpha === 0.01 ? ' selected' : ''}>0.01</option>
        <option value="0.05"${s.alpha === 0.05 ? ' selected' : ''}>0.05</option>
        <option value="0.10"${s.alpha === 0.10 ? ' selected' : ''}>0.10</option>
      </select>
    </div>
    <div class="setting-row">
      <div>
        <label for="set-ci" class="setting-label">Confidence level</label>
        <p class="setting-hint">Default CI level for bootstrap</p>
      </div>
      <select id="set-ci">
        <option value="0.90"${s.confidenceLevel === 0.90 ? ' selected' : ''}>90%</option>
        <option value="0.95"${s.confidenceLevel === 0.95 ? ' selected' : ''}>95%</option>
        <option value="0.99"${s.confidenceLevel === 0.99 ? ' selected' : ''}>99%</option>
      </select>
    </div>
    <div class="setting-row">
      <div>
        <label for="set-motion" class="setting-label">Reduce motion</label>
        <p class="setting-hint">Minimize animations</p>
      </div>
      <select id="set-motion">
        <option value="auto"${s.reducedMotion === 'auto' ? ' selected' : ''}>Auto (OS)</option>
        <option value="on"${s.reducedMotion === 'on' ? ' selected' : ''}>On</option>
        <option value="off"${s.reducedMotion === 'off' ? ' selected' : ''}>Off</option>
      </select>
    </div>
    <div class="setting-row">
      <div>
        <label for="set-mode" class="setting-label">Activity mode</label>
        <p class="setting-hint">Discovery: guided with questions. Presentation: all steps visible.</p>
      </div>
      <select id="set-mode">
        <option value="discover"${s.activityMode === 'discover' ? ' selected' : ''}>Discovery</option>
        <option value="present"${s.activityMode === 'present' ? ' selected' : ''}>Presentation</option>
      </select>
    </div>
    <div class="reset-row">
      <button type="button" class="reset-link" id="set-reset">Reset to defaults</button>
    </div>
    <button type="button" autofocus>Close</button>
  `;
  document.body.appendChild(dialog);

  // Wire close
  const closeBtn = /** @type {HTMLButtonElement} */ (dialog.querySelector('button[autofocus]'));
  closeBtn.addEventListener('click', () => dialog.close());

  // Wire settings changes — save on every input
  const wire = (/** @type {string} */ id, /** @type {string} */ key, /** @type {string} */ type) => {
    const el = /** @type {HTMLInputElement|HTMLSelectElement} */ (document.getElementById(id));
    if (!el) return;
    el.addEventListener('change', () => {
      const val = type === 'number' ? Number(el.value) : el.value;
      setSettings({ [key]: val });
      applySettings();
    });
  };
  wire('set-dp-pvalue', 'decimalsPValue', 'number');
  wire('set-dp-stat', 'decimalsStat', 'number');
  wire('set-dp-estimate', 'decimalsEstimate', 'number');
  wire('set-alpha', 'alpha', 'number');
  wire('set-ci', 'confidenceLevel', 'number');
  wire('set-motion', 'reducedMotion', 'string');

  // Mode select — reload page on change since mode affects DOM structure
  const modeSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('set-mode'));
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      setSettings({ activityMode: modeSelect.value });
      applySettings();
      location.reload();
    });
  }

  // Reset button
  const resetBtn = document.getElementById('set-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetSettings();
      dialog.close();
      location.reload();
    });
  }

  // Wire gear button
  const gearBtn = document.querySelector('.settings-btn');
  if (gearBtn) {
    gearBtn.addEventListener('click', () => dialog.showModal());
  }
}

/**
 * Initialize keyboard shortcuts for generate buttons, reset, and help dialog.
 * Keys 1-4 map to gen-btn elements, 0 to reset, ? to help dialog.
 * @param {NodeListOf<HTMLButtonElement>} genBtns - Generate buttons
 * @param {HTMLButtonElement|null} resetBtn - Reset button
 */
export function initKeyboardShortcuts(genBtns, resetBtn) {
  initHelp();

  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === '1') genBtns[0]?.click();
    if (e.key === '2') genBtns[1]?.click();
    if (e.key === '3') genBtns[2]?.click();
    if (e.key === '4') genBtns[3]?.click();
    if (e.key === '0' && resetBtn && !resetBtn.hidden) resetBtn.click();
  });
}

/**
 * Flash the mechanism strip with a CSS animation class.
 * @param {HTMLElement|null} mechanismStrip
 */
export function flashMechanism(mechanismStrip) {
  if (!mechanismStrip) return;
  mechanismStrip.classList.remove('mechanism-flash');
  void mechanismStrip.offsetWidth; // force reflow to restart animation
  mechanismStrip.classList.add('mechanism-flash');
}

/**
 * Animate a dot "dropping" from the mechanism strip resample mean to the
 * highlighted dot in the chart. Creates a fixed-position orange circle that
 * flies along a curved path from source to target, then fades out on arrival.
 *
 * The highlighted dot in the SVG is hidden (opacity 0) before the animation
 * starts and revealed when the flying dot arrives.
 *
 * Skipped entirely when prefers-reduced-motion is set.
 *
 * @param {HTMLElement} sourceEl - The resample mean element (#resample-mean)
 * @param {HTMLElement} chartContainer - The chart container element
 * @param {object} [opts]
 * @param {number} [opts.duration] - Animation duration in ms (default 450)
 */
export function animateDropToChart(sourceEl, chartContainer, opts = {}) {
  // Respect reduced-motion preference (settings-aware, not just OS)
  if (prefersReducedMotion()) return;

  const duration = opts.duration ?? 450;

  // Find the highlighted dot (orange fill) in the chart SVG
  const svg = chartContainer.querySelector('svg');
  if (!svg || !sourceEl) return;

  // Find the highlighted dot — look for orange fill or stroke.
  // Check both exact hex and case variations since browsers may normalize.
  const highlightEl = svg.querySelector('circle[fill="#E07020"]')
    || svg.querySelector('circle[fill="#e07020"]')
    || svg.querySelector('line[stroke="#E07020"]')
    || svg.querySelector('line[stroke="#e07020"]');
  if (!highlightEl) return;
  const highlightDot = /** @type {SVGElement} */ (highlightEl);

  // Get screen coordinates for source and target
  const sourceRect = sourceEl.getBoundingClientRect();
  const sx = sourceRect.left + sourceRect.width / 2;
  const sy = sourceRect.top + sourceRect.height / 2;

  // Target: use getScreenCTM for precise SVG→screen coordinate mapping
  /** @type {number} */
  let tx = 0;
  /** @type {number} */
  let ty = 0;

  if (highlightEl instanceof SVGCircleElement) {
    const ctm = highlightEl.getScreenCTM();
    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = parseFloat(highlightEl.getAttribute('cx') || '0');
      pt.y = parseFloat(highlightEl.getAttribute('cy') || '0');
      const screenPt = pt.matrixTransform(ctm);
      tx = screenPt.x;
      ty = screenPt.y;
    } else {
      const dotRect = highlightEl.getBoundingClientRect();
      tx = dotRect.left + dotRect.width / 2;
      ty = dotRect.top + dotRect.height / 2;
    }
  } else {
    const dotRect = highlightDot.getBoundingClientRect();
    tx = dotRect.left + dotRect.width / 2;
    ty = dotRect.top + dotRect.height / 2;
  }

  // Sanity check: target should be below source (chart is below mechanism strip)
  // If coordinates look wrong (target at 0,0 or above source), bail out
  if (tx === 0 && ty === 0) return;

  // Hide the SVG highlight until the flying dot arrives
  const origOpacity = highlightDot.getAttribute('opacity');
  highlightDot.setAttribute('opacity', '0');

  // Create the flying dot
  const dot = document.createElement('div');
  dot.setAttribute('aria-hidden', 'true');
  dot.style.cssText = `
    position: fixed;
    left: ${sx}px;
    top: ${sy}px;
    width: 12px;
    height: 12px;
    margin-left: -6px;
    margin-top: -6px;
    border-radius: 50%;
    background: #E07020;
    border: 1.5px solid #000;
    z-index: 9999;
    pointer-events: none;
    will-change: transform, opacity;
  `;
  document.body.appendChild(dot);

  // Animate using requestAnimationFrame for a curved path
  const dx = tx - sx;
  const dy = ty - sy;
  // Control point for quadratic bezier: offset horizontally to create arc
  const cpx = sx + dx * 0.5;
  const cpy = Math.min(sy, ty) - Math.abs(dy) * 0.3 - 30; // arc above both points

  const startTime = performance.now();

  /** @param {number} now */
  function frame(now) {
    const elapsed = now - startTime;
    const t = Math.min(elapsed / duration, 1);
    // Ease-in-out cubic
    const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Quadratic bezier position
    const u = 1 - ease;
    const x = u * u * sx + 2 * u * ease * cpx + ease * ease * tx;
    const y = u * u * sy + 2 * u * ease * cpy + ease * ease * ty;

    dot.style.left = x + 'px';
    dot.style.top = y + 'px';

    // Scale: start at 1, peak at 1.3 midway, end at 1
    const scale = 1 + 0.3 * Math.sin(ease * Math.PI);
    dot.style.transform = `scale(${scale})`;

    if (t < 1) {
      requestAnimationFrame(frame);
    } else {
      // Arrival: reveal the SVG dot and fade out the flying dot
      highlightDot.setAttribute('opacity', origOpacity || '1');
      dot.style.transition = 'opacity 150ms';
      dot.style.opacity = '0';
      setTimeout(() => dot.remove(), 160);
    }
  }

  requestAnimationFrame(frame);
}

/**
 * Add a collapse toggle to the mechanism strip.
 * Inserts a bar with "Hide sampling detail" / "Show sampling detail" button.
 * State is persisted in sessionStorage so it survives within a session.
 * @param {HTMLElement|null} mechanismStrip - The #mechanism-strip element
 */
export function initMechanismCollapse(mechanismStrip) {
  if (!mechanismStrip || mechanismStrip.querySelector('.mechanism-collapse-bar')) return;

  const bar = document.createElement('div');
  bar.className = 'mechanism-collapse-bar';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mechanism-collapse-btn';
  btn.textContent = 'Hide sampling detail';
  btn.setAttribute('aria-expanded', 'true');

  // Restore persisted state
  const collapsed = sessionStorage.getItem('mechanism-collapsed') === 'true';
  if (collapsed) {
    mechanismStrip.classList.add('collapsed');
    btn.textContent = 'Show sampling detail';
    btn.setAttribute('aria-expanded', 'false');
  }

  btn.addEventListener('click', () => {
    const isCollapsed = mechanismStrip.classList.toggle('collapsed');
    btn.textContent = isCollapsed ? 'Show sampling detail' : 'Hide sampling detail';
    btn.setAttribute('aria-expanded', String(!isCollapsed));
    sessionStorage.setItem('mechanism-collapsed', String(isCollapsed));
  });

  bar.appendChild(btn);
  mechanismStrip.insertBefore(bar, mechanismStrip.firstChild);
}

/**
 * Fetch the dataset index and populate a <select> element with matching datasets.
 * @param {HTMLSelectElement} selectEl - The dataset <select> element
 * @param {(ds: {id:string, type:string}) => boolean} filterFn - Filter function for relevant datasets
 * @param {HTMLElement|null} [descEl] - Element to show error messages
 * @returns {Promise<Array<{id:string, name:string, description:string, type:string, n:number}>>}
 */
export async function loadDatasetIndex(selectEl, filterFn, descEl) {
  try {
    const resp = await fetch(dataPath('datasets.json'));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const index = await resp.json();
    const relevant = index.filter(filterFn);
    for (const ds of relevant) {
      const opt = document.createElement('option');
      opt.value = ds.id;
      opt.textContent = `${ds.name} (n = ${ds.n})`;
      selectEl.appendChild(opt);
    }
    return relevant;
  } catch {
    if (descEl) descEl.textContent = 'Could not load datasets.';
    return [];
  }
}

/**
 * Fetch a dataset by ID and return the parsed JSON.
 * @param {string} id
 * @returns {Promise<any>}
 */
export async function fetchDataset(id) {
  const resp = await fetch(dataPath(`${id}.json`));
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

/**
 * Wire up a file input to read CSV/TSV files via FileReader.
 * Reads the file as text and passes it to the provided callback.
 * @param {HTMLInputElement} fileInput - The file input element
 * @param {(text: string, filename: string) => void} onLoad - Called with file text content
 */
export function setupFileInput(fileInput, onLoad) {
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (file.size > 10_000_000) {
      announce('File too large (max 10 MB).');
      fileInput.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        onLoad(reader.result, file.name);
      }
      fileInput.value = '';  // reset so same file can be re-selected
    };
    reader.onerror = () => {
      announce(`Could not read file: ${file.name}`);
      fileInput.value = '';
    };
    reader.readAsText(file);
  });
}

/**
 * Create a play/pause button that auto-clicks the +1 generate button.
 * Inserts the button into the .generate-bar, before the .gen-label.
 * Stops automatically on reset or when the +1 button becomes disabled.
 * @param {NodeListOf<HTMLButtonElement>} genBtns - Generate buttons
 * @param {HTMLButtonElement|null} resetBtn - Reset button
 * @param {{ delay?: number }} [options]
 * @returns {{ stop: () => void } | null}
 */
export function initPlayPause(genBtns, resetBtn, options) {
  const delay = options?.delay ?? 300;
  const oneBtn = /** @type {HTMLButtonElement|undefined} */ (
    Array.from(genBtns).find(b => b.dataset.count === '1'));
  if (!oneBtn) return null;

  const generateBar = oneBtn.closest('.generate-bar');
  if (!generateBar) return null;

  const playBtn = document.createElement('button');
  playBtn.type = 'button';
  playBtn.className = 'play-btn';
  playBtn.textContent = '\u25B6';
  playBtn.title = 'Auto-play: add one at a time';
  playBtn.setAttribute('aria-label', 'Auto-play simulations');
  playBtn.setAttribute('aria-pressed', 'false');
  playBtn.disabled = oneBtn.disabled;

  let playing = false;
  /** @type {ReturnType<typeof setTimeout>|null} */
  let timerId = null;

  function stop() {
    playing = false;
    if (timerId !== null) clearTimeout(timerId);
    timerId = null;
    playBtn.textContent = '\u25B6';
    playBtn.title = 'Auto-play: add one at a time';
    playBtn.setAttribute('aria-pressed', 'false');
    announce('Auto-play stopped.');
  }

  function step() {
    if (!playing || oneBtn.disabled) { stop(); return; }
    oneBtn.click();
    timerId = setTimeout(step, delay);
  }

  playBtn.addEventListener('click', () => {
    if (oneBtn.disabled) return;
    if (playing) {
      stop();
    } else {
      playing = true;
      playBtn.textContent = '\u23F8';
      playBtn.title = 'Pause auto-play';
      playBtn.setAttribute('aria-pressed', 'true');
      announce('Auto-play started.');
      step();
    }
  });

  // Stop on reset
  if (resetBtn) {
    resetBtn.addEventListener('click', stop);
  }

  // Sync disabled state with +1 button
  const observer = new MutationObserver(() => {
    playBtn.disabled = oneBtn.disabled;
    if (oneBtn.disabled && playing) stop();
  });
  observer.observe(oneBtn, { attributes: true, attributeFilter: ['disabled'] });

  // Insert before gen-label (or append)
  const label = generateBar.querySelector('.gen-label');
  if (label) {
    generateBar.insertBefore(playBtn, label);
  } else {
    generateBar.appendChild(playBtn);
  }

  // Space bar toggles play/pause (keyboard shortcut)
  document.addEventListener('keydown', (e) => {
    if (e.target !== document.body) return;
    if (e.ctrlKey || e.metaKey) return;
    if (e.key === ' ' && !oneBtn.disabled) {
      e.preventDefault();
      playBtn.click();
    }
  });

  return { stop };
}

/**
 * Compute highlight indices for dotplot/histogram rendering.
 * For ≤200 values: tracks individual new indices.
 * For >200 values: computes previous bin counts for delta highlighting.
 * @param {number[]} allStats - All accumulated statistics
 * @param {number} prevLength - Length before this batch
 * @param {number} count - Number of new values added
 * @param {(values: number[], opts: object) => {bins: Array}} computeBins
 * @param {object} [options]
 * @param {[number,number]} [options.domain] - Domain for bin alignment
 * @param {number} [options.numBins] - Number of bins override
 * @param {number[]} [options.thresholds] - Explicit bin thresholds for discrete data
 * @returns {{ hlIndex: number, hlIndices: Set<number>|undefined, prevBinCounts: number[]|undefined }}
 */
export function computeHighlights(allStats, prevLength, count, computeBins, options = {}) {
  let hlIndex = -1;
  /** @type {Set<number>|undefined} */
  let hlIndices;
  /** @type {number[]|undefined} */
  let prevBinCounts;

  // Always compute dot-level highlights (needed for dotplot at any n)
  if (count === 1) {
    hlIndex = allStats.length - 1;
  } else {
    hlIndices = new Set();
    for (let j = prevLength; j < allStats.length; j++) hlIndices.add(j);
  }

  if (allStats.length > 200 && prevLength > 0) {
    // Use the FULL dataset domain so prev bins align with current bins
    const prevStats = allStats.slice(0, prevLength);
    const { bins: prevBins } = computeBins(prevStats, {
      numBins: options.numBins,
      domain: options.domain,
      thresholds: options.thresholds,
    });
    prevBinCounts = prevBins.map(b => b.length);
  }

  return { hlIndex, hlIndices, prevBinCounts };
}

/**
 * Initialize a standard data panel with dataset dropdown, paste, file input, and clear button.
 * Handles common wiring and delegates page-specific processing to callbacks.
 *
 * @param {object} config
 * @param {(ds: {id:string, type:string}) => boolean} config.datasetFilter - Filter for dataset dropdown
 * @param {(ds: any, meta: {id:string,name:string,description:string,type:string,n:number}) => void} config.onDataset - Called with fetched dataset JSON + metadata
 * @param {(parsed: {headers:string[], types:string[], data:Array<Record<string,any>>}, sourceName: string) => void} [config.onText] - Called with parseCSV result for paste/file
 * @param {(text: string, sourceName: string) => void} [config.onRawText] - Receive raw text instead (overrides onText)
 * @param {() => void} config.onClear - Called when clear button clicked
 * @returns {{ getDatasetIndex: () => Array<{id:string,name:string,description:string,type:string,n:number}>, populateEditor: (csvText:string, sourceName:string) => void, refilterDatasets: (filterFn: (ds: any) => boolean) => void }}
 */
export function initDataPanel(config) {
  const { datasetFilter, onDataset, onText, onRawText, onClear } = config;

  const datasetSelect = /** @type {HTMLSelectElement|null} */ (document.getElementById('dataset-select'));
  const datasetDesc = document.getElementById('dataset-desc');
  const pasteArea = /** @type {HTMLTextAreaElement|null} */ (document.getElementById('paste-area'));
  const loadPastedBtn = document.getElementById('load-pasted');
  const clearBtn = document.getElementById('clear-btn');
  const saveBtn = document.getElementById('save-btn');
  const fileInput = /** @type {HTMLInputElement|null} */ (document.getElementById('file-input'));

  /** @type {Array<{id:string,name:string,description:string,type:string,n:number}>} */
  let datasetIndex = [];

  /** Track the current data source name for save filename. */
  let currentSourceName = 'data';

  /**
   * Populate the edit textarea with CSV text from loaded data.
   * @param {string} csvText
   * @param {string} sourceName
   */
  function populateEditor(csvText, sourceName) {
    if (pasteArea) pasteArea.value = csvText;
    currentSourceName = sourceName.replace(/\.\w+$/, ''); // strip extension
  }

  /** Full unfiltered dataset index (loaded once). @type {Array<{id:string,name:string,description:string,type:string,n:number}>} */
  let fullIndex = [];

  /**
   * Re-filter the dataset dropdown with a new filter function.
   * @param {(ds: {id:string, type:string, hasNumeric?:boolean, hasCategorical?:boolean}) => boolean} filterFn
   */
  function refilterDatasets(filterFn) {
    if (!datasetSelect) return;
    datasetSelect.innerHTML = '<option value="">-- Select --</option>';
    if (datasetDesc) datasetDesc.textContent = '';
    datasetIndex = fullIndex.filter(filterFn);
    for (const ds of datasetIndex) {
      const opt = document.createElement('option');
      opt.value = ds.id;
      opt.textContent = `${ds.name} (n = ${ds.n})`;
      datasetSelect.appendChild(opt);
    }
  }

  // ── Dataset dropdown ──
  if (datasetSelect) {
    loadDatasetIndex(datasetSelect, datasetFilter, datasetDesc)
      .then(index => { fullIndex = index; datasetIndex = index; });

    datasetSelect.addEventListener('change', () => {
      const id = datasetSelect.value;
      if (!id) {
        if (datasetDesc) datasetDesc.textContent = '';
        return;
      }
      const meta = datasetIndex.find(d => d.id === id);
      if (meta && datasetDesc) datasetDesc.textContent = meta.description;

      fetchDataset(id)
        .then(ds => {
          onDataset(ds, meta);
          // Populate editor with dataset as CSV
          if (ds.rows && ds.variables) {
            const cols = ds.variables.map(/** @param {any} v */ v => v.name);
            populateEditor(rowsToCSV(ds.rows, cols), meta?.name ?? id);
          }
        })
        .catch(() => announce('Failed to load dataset.'));
    });
  }

  // ── Text handler (shared by paste + file) ──
  const handleText = onRawText || ((/** @type {string} */ text, /** @type {string} */ sourceName) => {
    if (!onText) return;
    try {
      const parsed = parseCSV(text);
      onText(parsed, sourceName);
    } catch (e) {
      announce(`Error parsing data: ${e instanceof Error ? e.message : String(e)}`);
    }
  });

  // ── Apply (paste/edit) ──
  if (loadPastedBtn && pasteArea) {
    loadPastedBtn.addEventListener('click', () => {
      const text = pasteArea.value.trim();
      if (!text) return;
      currentSourceName = 'edited_data';
      handleText(text, 'Edited data');
    });
  }

  // ── File input ──
  if (fileInput) {
    setupFileInput(fileInput, (text, filename) => {
      handleText(text, filename);
      populateEditor(text, filename);
    });
  }

  // ── Save ──
  if (saveBtn) {
    saveBtn.addEventListener('click', () => {
      const text = pasteArea?.value?.trim();
      if (!text) {
        announce('No data to save.');
        return;
      }
      const safeName = currentSourceName.replace(/[^a-zA-Z0-9_-]/g, '_');
      downloadCSV(text, `${safeName}.csv`);
      announce('Data saved.');
    });
  }

  // ── Clear ──
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (pasteArea) pasteArea.value = '';
      onClear();
    });
  }

  return {
    getDatasetIndex: () => datasetIndex,
    populateEditor,
    refilterDatasets,
  };
}

/**
 * Auto-wrap integer number inputs with +/- stepper buttons.
 * Targets inputs with step="1" (or integer-step) that aren't already wrapped.
 * Skips inputs inside dialogs (settings dialog handles its own) and inputs
 * with step="any" (free-form decimal entry like means, SDs, slopes).
 */
function autoWrapSteppers() {
  // Defer to let page-specific JS (dist-app.js etc.) create its own steppers first
  queueMicrotask(() => {
    const inputs = /** @type {NodeListOf<HTMLInputElement>} */ (
      document.querySelectorAll('input[type="number"]'));
    for (const input of inputs) {
      // Skip if already wrapped by page-specific code
      if (input.closest('.stepper-group')) continue;
      // Skip inputs inside dialogs (settings, help)
      if (input.closest('dialog')) continue;
      // Skip free-form decimal inputs (step="any" or fractional step like 0.01)
      const step = input.step || '1';
      if (step === 'any') continue;
      const stepNum = parseFloat(step);
      if (stepNum < 1 && stepNum !== 0) continue;
      // Skip inputs that have a companion range slider (dist calculators)
      const row = input.closest('.df-inline-row, .param-row, .binom-controls');
      if (row && row.querySelector('input[type="range"]')) continue;
      // Wrap it
      wrapWithStepper(input);
    }
  });
}

/**
 * Wrap a number input with +/- stepper buttons for mobile-friendly interaction.
 * Android Chrome (and some other mobile browsers) don't show native steppers
 * for `<input type="number">`, making it hard to adjust values.
 *
 * @param {HTMLInputElement} input - The number input to wrap
 * @param {object} [options]
 * @param {number} [options.step] - Step size (default: uses input.step or 1)
 * @param {() => void} [options.onChange] - Called after value changes
 * @returns {HTMLElement} The wrapper element (already inserted around the input)
 */
export function wrapWithStepper(input, options = {}) {
  const step = options.step ?? (parseFloat(input.step) || 1);
  const onChange = options.onChange;

  const wrapper = document.createElement('span');
  wrapper.className = 'stepper-group';

  const minusBtn = document.createElement('button');
  minusBtn.type = 'button';
  minusBtn.className = 'stepper-btn';
  minusBtn.textContent = '\u2212'; // minus sign
  minusBtn.setAttribute('aria-label', 'Decrease');
  minusBtn.tabIndex = -1; // don't add to tab order — input is already there

  const plusBtn = document.createElement('button');
  plusBtn.type = 'button';
  plusBtn.className = 'stepper-btn';
  plusBtn.textContent = '+';
  plusBtn.setAttribute('aria-label', 'Increase');
  plusBtn.tabIndex = -1;

  // Insert wrapper in place of input
  input.parentNode?.insertBefore(wrapper, input);
  wrapper.appendChild(minusBtn);
  wrapper.appendChild(input);
  wrapper.appendChild(plusBtn);

  function adjust(/** @type {number} */ delta) {
    const cur = parseFloat(input.value) || 0;
    let next = +(cur + delta).toFixed(10); // avoid float drift
    const min = input.min !== '' ? parseFloat(input.min) : -Infinity;
    const max = input.max !== '' ? parseFloat(input.max) : Infinity;
    next = Math.max(min, Math.min(max, next));
    input.value = String(next);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (onChange) onChange();
  }

  minusBtn.addEventListener('click', () => adjust(-step));
  plusBtn.addEventListener('click', () => adjust(step));

  return wrapper;
}
