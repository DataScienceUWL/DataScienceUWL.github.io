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
 * Compute highlight indices for dotplot/histogram rendering.
 * For ≤200 values: tracks individual new indices.
 * For >200 values: computes previous bin counts for delta highlighting.
 * @param {number[]} allStats - All accumulated statistics
 * @param {number} prevLength - Length before this batch
 * @param {number} count - Number of new values added
 * @param {(values: number[], opts: {numBins: undefined}) => {bins: number[][]}} computeBins
 * @returns {{ hlIndex: number, hlIndices: Set<number>|undefined, prevBinCounts: number[]|undefined }}
 */
export function computeHighlights(allStats, prevLength, count, computeBins) {
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
    const prevStats = allStats.slice(0, prevLength);
    const { bins: prevBins } = computeBins(prevStats, { numBins: undefined });
    prevBinCounts = prevBins.map(b => b.length);
  }

  return { hlIndex, hlIndices, prevBinCounts };
}
