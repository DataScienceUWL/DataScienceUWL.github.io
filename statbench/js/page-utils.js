// @ts-check
/**
 * Shared utilities for standalone page modules.
 * Eliminates boilerplate duplicated across simulation, explore, and conceptual pages.
 * @module page-utils
 */

import { parseCSV, rowsToCSV, downloadCSV } from './csv-parser.js';

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
