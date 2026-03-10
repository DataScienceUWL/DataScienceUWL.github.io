// @ts-check
/**
 * Shared utilities for standalone page modules.
 * Eliminates boilerplate duplicated across simulation, explore, and conceptual pages.
 * @module page-utils
 */

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
 * Initialize keyboard shortcuts for generate buttons, reset, and help dialog.
 * Keys 1-4 map to gen-btn elements, 0 to reset, ? to keyboard-help dialog.
 * @param {NodeListOf<HTMLButtonElement>} genBtns - Generate buttons
 * @param {HTMLButtonElement|null} resetBtn - Reset button
 */
export function initKeyboardShortcuts(genBtns, resetBtn) {
  const helpDialog = /** @type {HTMLDialogElement|null} */ (
    document.getElementById('keyboard-help'));
  if (!helpDialog) return;

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

  if (allStats.length <= 200) {
    if (count === 1) {
      hlIndex = allStats.length - 1;
    } else {
      hlIndices = new Set();
      for (let j = prevLength; j < allStats.length; j++) hlIndices.add(j);
    }
  } else if (prevLength > 0) {
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
