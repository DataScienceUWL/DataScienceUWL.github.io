// @ts-check
/**
 * Shared utilities for standalone page modules.
 * Eliminates boilerplate duplicated across simulation, explore, and conceptual pages.
 * @module page-utils
 */

import { parseCSV, rowsToCSV, downloadCSV } from './csv-parser.js';
import { getSettings, setSettings, resetSettings, applySettings, getActivityMode, getExpertMode, prefersReducedMotion } from './settings.js';
import { parseParams } from './url-params.js';
import { configFromUrlParams, configFromGenerator, generateFromConfig } from './datagen.js';

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

/** @type {Record<string, string>} */
const TAB_HINTS = {
  'tab-dataset': 'Select a dataset',
  'tab-paste':   'Enter or paste your data and click Apply',
  'tab-file':    'Open a CSV or TSV file',
  'tab-summary': 'Enter summary statistics',
  'tab-table':   'Enter a contingency table',
  'tab-edit':    'Enter or paste your data and click Apply',
};

/**
 * Update the placeholder text in a results element based on the active data-input tab.
 * Only updates if a `.placeholder` paragraph is still showing (i.e., no results yet).
 *
 * @param {string} tabId - The id of the active tab (e.g., 'tab-dataset')
 * @param {HTMLElement|null} resultEl - The element containing the placeholder
 * @param {string} [action] - What the user should do after loading data (default: 'to see results')
 */
export function updateTabHint(tabId, resultEl, action = 'to see results') {
  if (!resultEl) return;
  const p = resultEl.querySelector('.placeholder');
  if (!p) return; // results already showing, don't overwrite
  const hint = TAB_HINTS[tabId] || 'Load data';
  p.textContent = `${hint}, then ${action}.`;
}

/**
 * Get the placeholder text for a given tab and action.
 * Useful for reset functions that rebuild the placeholder HTML.
 *
 * @param {string} tabId - The id of the active tab
 * @param {string} [action] - Action phrase (default: 'to see results')
 * @returns {string}
 */
export function getTabHintText(tabId, action = 'to see results') {
  const hint = TAB_HINTS[tabId] || 'Load data';
  return `${hint}, then ${action}.`;
}

/**
 * Get the currently selected tab id.
 * @returns {string}
 */
export function getActiveTabId() {
  const active = document.querySelector('[role="tab"][aria-selected="true"]');
  return active?.id ?? 'tab-dataset';
}

/**
 * Initialize accessible tab switching on all [role="tab"] elements in the page.
 * Handles click, ArrowLeft/ArrowRight keyboard navigation.
 *
 * @param {object} [opts]
 * @param {HTMLElement|null} [opts.hintTarget] - Element containing a .placeholder to update on tab switch
 * @param {string} [opts.hintAction] - Action phrase for placeholder (e.g., 'run a simulation to see results')
 */
export function initTabs(opts) {
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
      if (opts?.hintTarget) {
        updateTabHint(tab.id, opts.hintTarget, opts.hintAction);
      }
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
    brand.setAttribute('aria-label', 'StatLens home');
    brand.innerHTML = `<svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="15" fill="#569BBD"/><path d="M4 24 C4 24, 8 23, 10 20 C12 17, 13 8, 16 8 C19 8, 20 17, 22 20 C24 23, 28 24, 28 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round"/><path d="M4 24 C4 24, 8 23, 10 20 L10 24 Z" fill="#ffffff60"/></svg> StatLens`;
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
    <div class="setting-row">
      <div>
        <label for="set-expert" class="setting-label">Expert mode</label>
        <p class="setting-hint">Show advanced controls: statistic selector, CI level, chart type toggle, bin adjuster, theory overlay.</p>
      </div>
      <input type="checkbox" id="set-expert" ${s.expertMode ? 'checked' : ''}>
    </div>
    <div class="setting-row">
      <div>
        <label for="set-interpret" class="setting-label">Show interpretations</label>
        <p class="setting-hint">Show auto-generated conclusions and interpretations. Turn off for calculator-only mode.</p>
      </div>
      <input type="checkbox" id="set-interpret" ${s.showInterpretations !== false ? 'checked' : ''}>
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
      // In iframes, reload can break the parent page — only reload in top-level context
      if (window.parent === window) {
        location.reload();
      }
    });
  }

  // Expert mode checkbox — toggles visibility of advanced controls
  const expertCheck = /** @type {HTMLInputElement|null} */ (document.getElementById('set-expert'));
  if (expertCheck) {
    expertCheck.addEventListener('change', () => {
      setSettings({ expertMode: expertCheck.checked });
      applySettings();
    });
  }

  // Interpretations toggle
  const interpretCheck = /** @type {HTMLInputElement|null} */ (document.getElementById('set-interpret'));
  if (interpretCheck) {
    interpretCheck.addEventListener('change', () => {
      setSettings({ showInterpretations: interpretCheck.checked });
      applySettings();
    });
  }

  // Reset button
  const resetBtn = document.getElementById('set-reset');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetSettings();
      dialog.close();
      if (window.parent === window) {
        location.reload();
      }
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
/**
 * Initialize a .hyp-toggle button for cycling alternative hypothesis direction.
 * Reads data-values, data-labels from the element's data attributes.
 * Returns an object with { getValue(), setValue(v), el } for programmatic access.
 * @param {string} elementId - The id of the button element
 * @param {() => void} [onChange] - Optional callback when value changes
 * @returns {{ getValue: () => string, setValue: (v: string) => void, el: HTMLButtonElement }}
 */
export function initHypToggle(elementId, onChange) {
  const el = /** @type {HTMLButtonElement} */ (document.getElementById(elementId));
  const vals = (el.dataset.values || '').split(',');
  const labels = (el.dataset.labels || '').split(',');

  el.addEventListener('click', () => {
    const cur = vals.indexOf(el.dataset.value || vals[0]);
    const next = (cur + 1) % vals.length;
    el.dataset.value = vals[next];
    el.textContent = labels[next];
    if (onChange) onChange();
  });

  return {
    getValue() { return el.dataset.value || vals[0]; },
    setValue(v) {
      const idx = vals.indexOf(v);
      if (idx >= 0) {
        el.dataset.value = vals[idx];
        el.textContent = labels[idx];
      }
    },
    el,
  };
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
 * Spawn a stream of small dots flying from one element to another.
 * Communicates visually that "data flows from original → resample."
 * @param {HTMLElement} fromEl - Source element (original sample content)
 * @param {HTMLElement} toEl - Destination element (resample content)
 * @param {object} [opts]
 * @param {number} [opts.count] - Number of dots (default 8)
 * @param {number} [opts.duration] - Flight duration per dot in ms (default 350)
 * @param {string} [opts.color] - Dot color (default accent blue)
 * @returns {number} Total animation time in ms
 */
export function flyDataStream(fromEl, toEl, opts = {}) {
  if (prefersReducedMotion() || !fromEl || !toEl) return 0;

  const count = opts.count ?? 8;
  const duration = opts.duration ?? 350;
  const color = opts.color ?? '#569BBD';

  const fromRect = fromEl.getBoundingClientRect();
  const toRect = toEl.getBoundingClientRect();

  const fromX = fromRect.left + fromRect.width / 2;
  const fromY = fromRect.top + fromRect.height / 2;
  const toX = toRect.left + toRect.width / 2;
  const toY = toRect.top + toRect.height / 2;

  const stagger = 25;
  const totalMs = duration + stagger * (count - 1);

  for (let i = 0; i < count; i++) {
    const dot = document.createElement('div');
    dot.style.cssText = `
      position: fixed; z-index: 1000; pointer-events: none;
      width: 7px; height: 7px; border-radius: 50%;
      background: ${color}; opacity: 0;
      left: ${fromX - 3}px; top: ${fromY - 3}px;
      will-change: transform, opacity;
    `;
    document.body.appendChild(dot);

    const spreadX = (Math.random() - 0.5) * 24;
    const spreadY = (Math.random() - 0.5) * 16;
    const dx = toX - fromX + spreadX;
    const dy = toY - fromY + spreadY;
    const arcY = -Math.abs(dx) * 0.08 - 8;

    const delay = i * stagger;
    const start = performance.now() + delay;

    /** @param {number} now */
    function animate(now) {
      const elapsed = now - start;
      if (elapsed < 0) { requestAnimationFrame(animate); return; }
      const t = Math.min(1, elapsed / duration);
      const e = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

      const curX = dx * e;
      const curY = dy * e + arcY * 4 * t * (1 - t);
      const scale = 0.6 + 0.8 * Math.sin(t * Math.PI);

      dot.style.transform = `translate(${curX}px, ${curY}px) scale(${scale})`;
      dot.style.opacity = String(t < 0.15 ? t / 0.15 : t > 0.75 ? (1 - t) / 0.25 : 1);

      if (t < 1) {
        requestAnimationFrame(animate);
      } else {
        dot.remove();
      }
    }
    requestAnimationFrame(animate);
  }

  return totalMs;
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

  // Find the highlighted element — look for orange fill or stroke.
  // Check both exact hex and case variations since browsers may normalize.
  // Supports: dotplot circles, spike lines, and histogram delta bars (rects).
  const highlightEl = svg.querySelector('circle[fill="#E07020"]')
    || svg.querySelector('circle[fill="#e07020"]')
    || svg.querySelector('line[stroke="#E07020"]')
    || svg.querySelector('line[stroke="#e07020"]')
    || svg.querySelector('rect[fill="#E07020"]')
    || svg.querySelector('rect[fill="#e07020"]');
  if (!highlightEl) return;
  const highlightDot = /** @type {SVGElement} */ (highlightEl);

  // Get screen coordinates for source and target.
  // If the source element is hidden (e.g. mechanism strip collapsed), use the
  // collapsed summary element as the visual origin instead.
  let effectiveSource = sourceEl;
  const sourceRect = sourceEl.getBoundingClientRect();
  if (sourceRect.width === 0 && sourceRect.height === 0) {
    const strip = sourceEl.closest('.mechanism-strip');
    const summary = strip?.querySelector('.mechanism-collapsed-summary');
    // Prefer the highlighted value span inside the summary (matches detailed view)
    const hlSpan = summary?.querySelector('.highlight-last');
    effectiveSource = /** @type {HTMLElement} */ (hlSpan || summary || effectiveSource);
  }
  const finalRect = effectiveSource.getBoundingClientRect();
  const sx = finalRect.left + finalRect.width / 2;
  const sy = finalRect.top + finalRect.height / 2;

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
  } else if (highlightEl instanceof SVGRectElement) {
    // Histogram bar: aim for top-center of the delta bar
    const ctm = highlightEl.getScreenCTM();
    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = parseFloat(highlightEl.getAttribute('x') || '0') + parseFloat(highlightEl.getAttribute('width') || '0') / 2;
      pt.y = parseFloat(highlightEl.getAttribute('y') || '0');
      const screenPt = pt.matrixTransform(ctm);
      tx = screenPt.x;
      ty = screenPt.y;
    } else {
      const barRect = highlightEl.getBoundingClientRect();
      tx = barRect.left + barRect.width / 2;
      ty = barRect.top;
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
 * When collapsed, a compact one-line summary remains visible showing the
 * last simulated statistic — this serves as the visual origin for the
 * dot-drop animation so it doesn't appear to come from nowhere.
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

  // Collapsed summary: compact one-line stat shown when panels are hidden
  let summary = mechanismStrip.querySelector('.mechanism-collapsed-summary');
  if (!summary) {
    summary = document.createElement('p');
    summary.className = 'mechanism-collapsed-summary';
    summary.setAttribute('aria-live', 'polite');
    mechanismStrip.appendChild(summary);
  }

  // Sync summary content from the sim stat element
  const strip = /** @type {HTMLElement} */ (mechanismStrip);

  /**
   * Build a labeled summary line from the mechanism strip's stat elements.
   * Handles three layouts:
   *   1) sim-app bootstrap one-sample: #resample-stat-label + #resample-mean
   *   2) sim-app two-group: .mech-diff (already contains "diff = ...")
   *   3) one-sample-sim: #mech-sim-stat (already contains label + value)
   *   4) chisq: #mech-shuffled-chisq with parent <p> "χ² = <span>..."
   */
  function syncSummary() {
    if (!summary) return;

    // Try two-group diff first (already labeled)
    // Scope to resample panel — original panel also has .mech-diff but shows observed stat
    const mechDiff = strip.querySelector('#mech-resample-content .mech-diff')
      || strip.querySelector('.mech-diff');
    if (mechDiff && mechDiff.textContent.trim()) {
      if (mechDiff.classList.contains('highlight-last')) {
        summary.innerHTML = `<span class="highlight-last">${mechDiff.innerHTML}</span>`;
      } else {
        summary.innerHTML = mechDiff.innerHTML;
      }
      return;
    }

    // Try one-sample-sim #mech-sim-stat (already labeled)
    const mechSimStat = strip.querySelector('#mech-sim-stat');
    if (mechSimStat && mechSimStat.textContent.trim()) {
      summary.innerHTML = mechSimStat.innerHTML;
      return;
    }

    // Try sim-app bootstrap: #resample-stat-label + #resample-mean
    const resampleMean = strip.querySelector('#resample-mean');
    if (resampleMean && resampleMean.textContent.trim() && resampleMean.textContent !== '\u2014') {
      const labelEl = strip.querySelector('#resample-stat-label');
      const label = labelEl?.textContent || 'Resample statistic';
      const hl = resampleMean.classList.contains('highlight-last') ? ' class="highlight-last"' : '';
      summary.innerHTML = `${label} = <span${hl}>${resampleMean.innerHTML}</span>`;
      return;
    }

    // Try chisq: #mech-shuffled-chisq — copy parent <p> which has "χ² = <span>..."
    const chisqStat = strip.querySelector('#mech-shuffled-chisq');
    if (chisqStat && chisqStat.textContent.trim() && chisqStat.textContent !== '\u2014') {
      const parent = chisqStat.closest('.mechanism-stat');
      summary.innerHTML = parent ? parent.innerHTML : `χ² = ${chisqStat.innerHTML}`;
      return;
    }

    // Try correlation: #mech-shuffled-r — copy parent <p> which has "r = <span>..."
    const corrStat = strip.querySelector('#mech-shuffled-r');
    if (corrStat && corrStat.textContent.trim() && corrStat.textContent !== '\u2014') {
      const parent = corrStat.closest('.mechanism-stat');
      summary.innerHTML = parent ? parent.innerHTML : `r = ${corrStat.innerHTML}`;
      return;
    }
  }

  // Watch for sim stat changes so collapsed summary stays current.
  // Observe stat elements and their containers (for dynamically created content like .mech-diff).
  const watchTargets = strip.querySelectorAll(
    '#mech-sim-stat, #resample-mean, #mech-shuffled-chisq, #mech-shuffled-r, #mech-resample-content, #resample-content'
  );
  for (const el of watchTargets) {
    const observer = new MutationObserver(syncSummary);
    observer.observe(el, { childList: true, characterData: true, subtree: true });
  }
  // Also watch #resample-mean for class changes (highlight-last toggle)
  const resampleMeanWatch = strip.querySelector('#resample-mean');
  if (resampleMeanWatch) {
    const classObserver = new MutationObserver(syncSummary);
    classObserver.observe(resampleMeanWatch, { attributes: true, attributeFilter: ['class'] });
  }
  // Watch #mech-resample-content for attribute changes on child elements (e.g. .mech-diff highlight-last)
  const mechResampleContent = strip.querySelector('#mech-resample-content');
  if (mechResampleContent) {
    const attrObserver = new MutationObserver(syncSummary);
    attrObserver.observe(mechResampleContent, { attributes: true, attributeFilter: ['class'], subtree: true });
  }

  // Restore persisted state
  const collapsed = sessionStorage.getItem('mechanism-collapsed') === 'true';
  if (collapsed) {
    strip.classList.add('collapsed');
    btn.textContent = 'Show sampling detail';
    btn.setAttribute('aria-expanded', 'false');
    syncSummary();
  }

  btn.addEventListener('click', () => {
    const isCollapsed = strip.classList.toggle('collapsed');
    btn.textContent = isCollapsed ? 'Show sampling detail' : 'Hide sampling detail';
    btn.setAttribute('aria-expanded', String(!isCollapsed));
    sessionStorage.setItem('mechanism-collapsed', String(isCollapsed));
    if (isCollapsed) syncSummary();
  });

  bar.appendChild(btn);
  strip.insertBefore(bar, strip.firstChild);
}

/**
 * Collapse the data panel to a compact summary bar after dataset loads.
 * Adds a "Change Data" button to re-expand. Idempotent.
 * @param {HTMLElement|null} dataPanel - The #data-panel element
 * @param {object} [dataset] - Full dataset JSON (optional; used to render "About this data" info)
 */
export function collapseDataPanel(dataPanel, dataset) {
  if (!dataPanel || dataPanel.classList.contains('collapsed')) return;
  dataPanel.classList.add('collapsed');

  if (!dataPanel.querySelector('.data-panel-expand-btn')) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'data-panel-expand-btn';
    btn.textContent = 'Change Data';
    btn.addEventListener('click', () => {
      dataPanel.classList.remove('collapsed');
      // Remove info panel when expanding (will be re-added on next collapse)
      const info = dataPanel.querySelector('.dataset-info');
      if (info) info.remove();
    });
    dataPanel.appendChild(btn);
  }

  // Render "About this data" if enriched metadata is available
  renderDatasetInfo(dataPanel, dataset);
}

/**
 * Render an expandable "About this data" panel inside the collapsed data bar.
 * Only renders if the dataset has studyDescription or variableDescriptions.
 * @param {HTMLElement} panel
 * @param {object} [ds]
 */
function renderDatasetInfo(panel, ds) {
  // Remove any existing info panel
  const existing = panel.querySelector('.dataset-info');
  if (existing) existing.remove();

  if (!ds) return;
  const hasStudy = ds.studyDescription;
  const hasVarDescs = ds.variableDescriptions && Object.keys(ds.variableDescriptions).length > 0;
  const hasSource = ds.sourceDetail;
  if (!hasStudy && !hasVarDescs && !hasSource) return;

  const details = document.createElement('details');
  details.className = 'dataset-info';

  const summary = document.createElement('summary');
  summary.textContent = 'About this data';
  details.appendChild(summary);

  const content = document.createElement('div');
  content.className = 'dataset-info-content';

  if (hasStudy) {
    const p = document.createElement('p');
    p.className = 'dataset-info-study';
    p.textContent = ds.studyDescription;
    content.appendChild(p);
  }

  if (hasVarDescs) {
    const h = document.createElement('h4');
    h.textContent = 'Variables';
    content.appendChild(h);
    const dl = document.createElement('dl');
    dl.className = 'dataset-info-vars';
    for (const [varName, desc] of Object.entries(ds.variableDescriptions)) {
      // Find the label from the variables array if available
      const varMeta = ds.variables?.find(/** @param {any} v */ v => v.name === varName);
      const dt = document.createElement('dt');
      dt.textContent = varMeta?.label || varName;
      dl.appendChild(dt);
      const dd = document.createElement('dd');
      dd.textContent = /** @type {string} */ (desc);
      dl.appendChild(dd);
    }
    content.appendChild(dl);
  }

  if (hasSource) {
    const p = document.createElement('p');
    p.className = 'dataset-info-source';
    const em = document.createElement('em');
    em.textContent = `Source: ${ds.sourceDetail}`;
    p.appendChild(em);
    content.appendChild(p);
  }

  details.appendChild(content);
  panel.appendChild(details);

  // Close on click outside
  document.addEventListener('click', function closeOutside(e) {
    if (!details.open) return;
    if (details.contains(/** @type {Node} */ (e.target))) return;
    details.open = false;
  });
}

/**
 * Create an on-page "More options" / "Fewer options" toggle for expert mode.
 * Inserts a small text link into the given container. Syncs with settings.
 * @param {HTMLElement} container - Element to append the toggle to
 */
export function createExpertToggle(container) {
  if (container.querySelector('.expert-toggle')) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'expert-toggle';
  btn.textContent = getExpertMode() ? 'Fewer options' : 'More options';
  btn.addEventListener('click', () => {
    const nowExpert = !getExpertMode();
    setSettings({ expertMode: nowExpert });
    applySettings();
    btn.textContent = nowExpert ? 'Fewer options' : 'More options';
  });
  container.appendChild(btn);
}

/**
 * Populate a <select> with dataset entries, optionally grouped via <optgroup>.
 * Datasets are always sorted alphabetically by name within each group.
 * @param {HTMLSelectElement} selectEl
 * @param {Array<{id:string, name:string, n:number}>} datasets
 * @param {((ds: any) => string)|undefined} [groupFn] - Returns group label for each dataset
 */
function populateDatasetSelect(selectEl, datasets, groupFn) {
  // Sort alphabetically by name
  const sorted = [...datasets].sort((a, b) => a.name.localeCompare(b.name));

  if (groupFn) {
    // Bucket into groups, sorted by group key
    /** @type {Map<string, typeof sorted>} */
    const groups = new Map();
    for (const ds of sorted) {
      const label = groupFn(ds);
      if (!groups.has(label)) groups.set(label, []);
      /** @type {typeof sorted} */ (groups.get(label)).push(ds);
    }
    // Sort groups by key, then strip numeric prefix (e.g. "1:Label" → "Label")
    const sortedKeys = [...groups.keys()].sort();
    for (const key of sortedKeys) {
      const items = /** @type {typeof sorted} */ (groups.get(key));
      const optGroup = document.createElement('optgroup');
      optGroup.label = key.includes(':') ? key.split(':').slice(1).join(':') : key;
      for (const ds of items) {
        const opt = document.createElement('option');
        opt.value = ds.id;
        opt.textContent = `${ds.name} (n = ${ds.n})`;
        optGroup.appendChild(opt);
      }
      selectEl.appendChild(optGroup);
    }
  } else {
    for (const ds of sorted) {
      const opt = document.createElement('option');
      opt.value = ds.id;
      opt.textContent = `${ds.name} (n = ${ds.n})`;
      selectEl.appendChild(opt);
    }
  }
}

/**
 * Fetch the dataset index and populate a <select> element with matching datasets.
 * @param {HTMLSelectElement} selectEl - The dataset <select> element
 * @param {(ds: {id:string, type:string}) => boolean} filterFn - Filter function for relevant datasets
 * @param {HTMLElement|null} [descEl] - Element to show error messages
 * @param {((ds: any) => string)} [groupFn] - Optional grouping function for <optgroup> labels
 * @returns {Promise<Array<{id:string, name:string, description:string, type:string, n:number}>>}
 */
export async function loadDatasetIndex(selectEl, filterFn, descEl, groupFn) {
  try {
    const resp = await fetch(dataPath('datasets.json'));
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const index = await resp.json();
    const relevant = index.filter(filterFn);
    populateDatasetSelect(selectEl, relevant, groupFn);
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
  const delay = options?.delay ?? 600;
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

  // Insert before reset button (so order is: +N… ▶ ↺ label)
  const resetEl = generateBar.querySelector('#reset-btn');
  if (resetEl) {
    generateBar.insertBefore(playBtn, resetEl);
  } else {
    const label = generateBar.querySelector('.gen-label');
    generateBar.insertBefore(playBtn, label);
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
 * Fetch and validate an external JSON dataset from a URL.
 * @param {string} url - Must be https://
 * @param {Function} onDataset - Called with the dataset object
 * @param {Function} populateEditor - Called to fill the paste area
 * @param {Function} resolve - Called when done (resolves the ready promise)
 */
function fetchExternalJSON(url, onDataset, populateEditor, resolve) {
  if (!url.startsWith('https://')) {
    announce('External datasets require HTTPS URLs.');
    resolve();
    return;
  }
  fetch(url, { mode: 'cors' })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then(ds => {
      if (!ds.variables || !Array.isArray(ds.variables) || !ds.rows || !Array.isArray(ds.rows)) {
        throw new Error('Invalid format: must have "variables" and "rows" arrays.');
      }
      if (ds.rows.length > 50_000) throw new Error('Too many rows (max 50,000).');
      // Sanitize variable names
      for (const v of ds.variables) {
        if (typeof v.name !== 'string') throw new Error('Each variable must have a "name" string.');
        v.name = v.name.replace(/<[^>]*>/g, '').trim();
      }
      const meta = { id: 'external', name: ds.name || 'External data', description: ds.description || '', type: 'external', n: ds.rows.length };
      onDataset(ds, meta);
      if (ds.rows && ds.variables) {
        const cols = ds.variables.map(/** @param {any} v */ v => v.name);
        populateEditor(rowsToCSV(ds.rows, cols), meta.name);
      }
      resolve();
    })
    .catch(err => {
      const msg = err instanceof TypeError
        ? 'Could not load external data. The server may not allow cross-origin requests.'
        : `Failed to load external data: ${err.message}`;
      announce(msg);
      resolve();
    });
}

/**
 * Fetch an external CSV file from a URL and parse it.
 * @param {string} url - Must be https://
 * @param {Function} handleText - Called with (csvText, sourceName)
 * @param {Function} populateEditor - Called to fill the paste area
 * @param {Function} resolve - Called when done
 */
function fetchExternalCSV(url, handleText, populateEditor, resolve) {
  if (!url.startsWith('https://')) {
    announce('External data requires HTTPS URLs.');
    resolve();
    return;
  }
  fetch(url, { mode: 'cors' })
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then(text => {
      if (text.length > 5_000_000) throw new Error('File too large (max 5MB).');
      const name = url.split('/').pop()?.replace(/\.\w+$/, '') || 'external';
      handleText(text, name);
      populateEditor(text, name);
      resolve();
    })
    .catch(err => {
      const msg = err instanceof TypeError
        ? 'Could not load external data. The server may not allow cross-origin requests.'
        : `Failed to load external CSV: ${err.message}`;
      announce(msg);
      resolve();
    });
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
 * @param {boolean} [config.autoCollapse] - Collapse #data-panel after successful data load
 * @param {boolean} [config.stickyControls] - Add .sticky to #controls after data load
 * @param {boolean} [config.showPreview] - Unhide #data-preview after data load
 * @param {(ds: any) => string} [config.datasetGroupFn] - Returns group label for <optgroup> in dataset dropdown
 * @returns {{ getDatasetIndex: () => Array<{id:string,name:string,description:string,type:string,n:number}>, populateEditor: (csvText:string, sourceName:string) => void, refilterDatasets: (filterFn: (ds: any) => boolean, groupFn?: (ds: any) => string) => void, ready: Promise<void>, currentDatasetId: string|null, currentSourceName: string, triggerPostLoad: () => void }}
 */
export function initDataPanel(config) {
  const { datasetFilter, onDataset, onText, onRawText, onClear,
    autoCollapse = false, stickyControls = false, showPreview = false,
    datasetGroupFn } = config;

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

  /** Track the current dataset ID (null if data came from paste/file/URL). */
  let currentDatasetId = /** @type {string|null} */ (null);

  /** URL params parsed once for auto-load logic. */
  const urlParams = parseParams();

  /** Promise that resolves after URL auto-load completes (or immediately if none). */
  /** @type {(value?: any) => void} */
  let resolveReady = /** @type {(value?: any) => void} */ (() => {});
  const ready = new Promise(resolve => { resolveReady = resolve; });
  ready.then(() => document.body.setAttribute('data-loaded', 'true'));

  /**
   * Populate the edit textarea with CSV text from loaded data.
   * @param {string} csvText
   * @param {string} sourceName
   */
  function populateEditor(csvText, sourceName) {
    if (pasteArea) pasteArea.value = csvText;
    currentSourceName = sourceName.replace(/\.\w+$/, ''); // strip extension
  }

  // Centralized post-load UI: collapse panel, sticky controls, show preview
  const dataPanelEl = document.getElementById('data-panel');
  const dataPreviewEl = document.getElementById('data-preview');

  /** @type {object|undefined} */
  let lastLoadedDataset;

  function postLoadUI() {
    if (showPreview && dataPreviewEl) dataPreviewEl.hidden = false;
    if (autoCollapse) collapseDataPanel(dataPanelEl, lastLoadedDataset);
    if (stickyControls) {
      const ctrl = document.getElementById('controls');
      if (ctrl) ctrl.classList.add('sticky');
    }
  }

  /** Full unfiltered dataset index (loaded once). @type {Array<{id:string,name:string,description:string,type:string,n:number}>} */
  let fullIndex = [];

  /**
   * Re-filter the dataset dropdown with a new filter function.
   * @param {(ds: {id:string, type:string, hasNumeric?:boolean, hasCategorical?:boolean}) => boolean} filterFn
   * @param {((ds: any) => string)} [groupFn] - Optional grouping function for <optgroup> labels
   */
  function refilterDatasets(filterFn, groupFn) {
    if (!datasetSelect) return;
    datasetSelect.innerHTML = '<option value="">-- Select --</option>';
    if (datasetDesc) datasetDesc.textContent = '';
    datasetIndex = fullIndex.filter(filterFn);
    populateDatasetSelect(datasetSelect, datasetIndex, groupFn);
  }

  // ── Dataset dropdown ──
  if (datasetSelect) {
    // If an activity panel is loading, wait for its params to be injected into the
    // URL before processing auto-load logic. This prevents the race condition where
    // datasets.json loads before the activity JSON, causing the wrong dataset to load
    // (REQ-020). The activity fetch was started early in page-number.js.
    const activityReady = typeof window !== 'undefined' && window.__activityParamsReady
      ? window.__activityParamsReady : Promise.resolve(null);

    Promise.all([
      loadDatasetIndex(datasetSelect, datasetFilter, datasetDesc, datasetGroupFn),
      activityReady,
    ]).then(([index]) => {
        fullIndex = index;
        datasetIndex = index;

        // Re-read URL params after activity defaults have been injected
        const effectiveParams = parseParams();

        // Auto-select dataset from URL param (?dataset=NAME)
        if (effectiveParams.dataset && index.some(ds => ds.id === effectiveParams.dataset)) {
          datasetSelect.value = effectiveParams.dataset;
          datasetSelect.dispatchEvent(new Event('change'));
        } else if (effectiveParams.dist) {
          // Inline parametric data generation (?dist=normal&mu=100&sigma=15&n=50&gen_seed=abc)
          const distConfig = configFromUrlParams(effectiveParams);
          if (distConfig) {
            const seed = effectiveParams.gen_seed || effectiveParams.seed || String(Date.now());
            let result;
            try {
              result = generateFromConfig(distConfig, seed);
            } catch (e) {
              console.warn('[datagen] generation failed:', /** @type {Error} */ (e).message);
              resolveReady();
              return;
            }
            // Use label as CSV header (shown in summary bar and axis labels).
            // With ?label=: students see a meaningful name like "Test Scores"
            // Without: they see "Random Data" (distribution details go in browser tab title for instructors)
            const hasLabel = result.label && result.label !== 'x';
            const hasVar = result.variable !== 'x';
            const csvHeader = hasLabel ? result.label
              : hasVar ? result.variable : 'Random Data';
            const csv = csvHeader + '\n' + result.values.join('\n');
            // Source name: label for students, distribution summary for instructors
            const unitsSuffix = result.units ? ` (${result.units})` : '';
            const distName = effectiveParams.dist.charAt(0).toUpperCase() + effectiveParams.dist.slice(1);
            let sourceName;
            if (hasLabel) {
              sourceName = `${result.label}${unitsSuffix}`;
            } else {
              // Distribution summary for browser tab title: "Normal(μ=100, σ=15)"
              const p = result.params;
              const paramParts = Object.entries(p)
                .filter(([, v]) => v != null)
                .map(([k, v]) => {
                  const sym = { mu: 'μ', sigma: 'σ', lambda: 'λ' }[k] || k;
                  return `${sym}=${v}`;
                });
              sourceName = paramParts.length
                ? `${distName}(${paramParts.join(', ')})`
                : distName;
            }
            queueMicrotask(() => {
              handleText(csv, sourceName);
              populateEditor(csv, `generated_${effectiveParams.dist}`);
              postLoadUI();
              resolveReady();
            });
          } else {
            // dist param present but invalid (missing n, etc.) — fall through
            resolveReady();
          }
        } else if (effectiveParams.data && effectiveParams.data.length > 0) {
          // Auto-load inline data from URL (?data=1,2,3,...)
          const csv = 'value\n' + effectiveParams.data.join('\n');
          queueMicrotask(() => {
            handleText(csv, 'URL data');
            populateEditor(csv, 'url_data');
            postLoadUI();
            resolveReady();
          });
        } else {
          // Check sessionStorage for cross-page transfer
          const transfer = consumeTransferData();
          if (transfer?.datasetId && index.some(ds => ds.id === transfer.datasetId)) {
            datasetSelect.value = transfer.datasetId;
            datasetSelect.dispatchEvent(new Event('change'));
          } else if (transfer?.csvText) {
            const tCsv = /** @type {string} */ (transfer.csvText);
            const tName = transfer.sourceName || 'Transferred data';
            queueMicrotask(() => {
              handleText(tCsv, tName);
              populateEditor(tCsv, tName);
              postLoadUI();
              resolveReady();
            });
          } else if (effectiveParams.json) {
            // Fetch external JSON dataset (?json=URL)
            fetchExternalJSON(effectiveParams.json, onDataset, populateEditor, () => { postLoadUI(); resolveReady(); });
          } else if (effectiveParams.csv) {
            // Fetch external CSV (?csv=URL)
            fetchExternalCSV(effectiveParams.csv, handleText, populateEditor, () => { postLoadUI(); resolveReady(); });
          } else {
            resolveReady();
          }
        }
      });

    datasetSelect.addEventListener('change', () => {
      const id = datasetSelect.value;
      if (!id) {
        currentDatasetId = null;
        if (datasetDesc) datasetDesc.textContent = '';
        return;
      }
      const meta = datasetIndex.find(d => d.id === id);
      if (meta && datasetDesc) datasetDesc.textContent = meta.description;

      fetchDataset(id)
        .then(ds => {
          currentDatasetId = id;
          currentSourceName = meta?.name || ds.name || id;

          // Generator block: if dataset has a generator and gen_seed is present,
          // generate fresh data instead of using stored rows (REQ-023 mode 2)
          const curParams = parseParams();
          if (ds.generator && curParams.gen_seed) {
            const genConfig = configFromGenerator(ds.generator, curParams);
            const overrides = /** @type {Object<string,number>} */ ({});
            for (const k of ['mu', 'sigma', 'shape', 'scale', 'lambda', 'prob', 'trials', 'a', 'b', 'df']) {
              const v = /** @type {any} */ (curParams)[k];
              if (v != null && typeof v === 'number') overrides[k] = v;
            }
            if (curParams.n) overrides.n = curParams.n;
            const result = generateFromConfig(genConfig, curParams.gen_seed, overrides);
            // Replace rows with generated data
            const varName = genConfig.var || 'value';
            ds.rows = result.values.map(v => ({ [varName]: v }));
            // Ensure variables array includes the generated variable
            if (!ds.variables) ds.variables = [];
            if (!ds.variables.some(/** @param {any} v */ v => v.name === varName)) {
              const vType = typeof result.values[0] === 'string' ? 'categorical' : 'numeric';
              ds.variables = [{ name: varName, label: genConfig.label || varName, type: vType }];
            }
          }

          lastLoadedDataset = ds;
          onDataset(ds, meta);
          // Populate editor with dataset as CSV
          if (ds.rows && ds.variables) {
            const cols = ds.variables.map(/** @param {any} v */ v => v.name);
            populateEditor(rowsToCSV(ds.rows, cols), meta?.name ?? id);
          }
          postLoadUI();
          resolveReady();
        })
        .catch(() => announce('Failed to load dataset.'));
    });
  } else {
    resolveReady();
  }

  // ── Text handler (shared by paste + file) ──
  const handleText = onRawText || ((/** @type {string} */ text, /** @type {string} */ sourceName) => {
    // Try JSON dataset format first (silently — if it fails, fall through to CSV)
    if (text.startsWith('{')) {
      try {
        const ds = JSON.parse(text);
        if (ds.variables && Array.isArray(ds.variables) && ds.rows && Array.isArray(ds.rows)) {
          for (const v of ds.variables) {
            if (typeof v.name !== 'string') throw new Error('bad variable');
            v.name = v.name.replace(/<[^>]*>/g, '').trim();
          }
          const meta = { id: ds.id || 'pasted', name: ds.name || sourceName, description: ds.description || '', type: 'external', n: ds.rows.length };
          onDataset(ds, meta);
          const cols = ds.variables.map(/** @param {any} v */ v => v.name);
          populateEditor(rowsToCSV(ds.rows, cols), meta.name);
          return;
        }
      } catch { /* not valid JSON dataset — fall through to CSV */ }
    }
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
      lastLoadedDataset = undefined;
      handleText(text, 'Edited data');
      postLoadUI();
    });
  }

  // ── File input ──
  if (fileInput) {
    setupFileInput(fileInput, (text, filename) => {
      lastLoadedDataset = undefined;
      handleText(text, filename);
      populateEditor(text, filename);
      postLoadUI();
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
      currentSourceName = '';
      currentDatasetId = null;
      if (stickyControls) {
        const ctrl = document.getElementById('controls');
        if (ctrl) ctrl.classList.remove('sticky');
      }
      onClear();
    });
  }

  return {
    getDatasetIndex: () => datasetIndex,
    populateEditor,
    refilterDatasets,
    ready,
    get currentDatasetId() { return currentDatasetId; },
    get currentSourceName() { return currentSourceName; },
    triggerPostLoad: postLoadUI,
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

/**
 * Resolve the relative path prefix from the current page to the repo root.
 * Uses the stylesheet href to infer depth (e.g., '../../' for pages 2 levels deep).
 * @returns {string}
 */
export function rootPrefix() {
  const link = document.querySelector('link[rel="stylesheet"][href*="style.css"]');
  if (link) {
    const href = link.getAttribute('href');
    return href?.replace(/css\/style\.css$/, '') ?? '';
  }
  return '';
}

/**
 * Build a URL to another StatLens page, optionally passing data via query params.
 * Prefers `?dataset=` over `?data=` when a dataset ID is available (shorter URL, full metadata).
 *
 * @param {string} targetPage - Path from repo root (e.g., 'simulate/bootstrap-mean/')
 * @param {object} [opts]
 * @param {string} [opts.dataset] - Bundled dataset ID (preferred over data)
 * @param {number[]} [opts.data] - Numeric data to pass via ?data= (fallback)
 * @param {Record<string, string|number>} [opts.params] - Additional URL params (p, direction, var, success, etc.)
 * @returns {string}
 */
export function buildSimLink(targetPage, opts) {
  const prefix = rootPrefix();
  let url = `${prefix}${targetPage}`;
  const qp = new URLSearchParams();

  if (opts?.dataset) {
    qp.set('dataset', opts.dataset);
  } else if (opts?.data && opts.data.length > 0 && opts.data.length <= 2000) {
    qp.set('data', opts.data.join(','));
  }
  if (opts?.params) {
    for (const [k, v] of Object.entries(opts.params)) {
      if (v != null && v !== '') qp.set(k, String(v));
    }
  }

  const qs = qp.toString();
  return qs ? `${url}?${qs}` : url;
}

/**
 * Store data for cross-page transfer via sessionStorage.
 * Used when data is too large for URL params or came from paste/file input.
 *
 * @param {object} payload
 * @param {string} [payload.datasetId] - Bundled dataset ID (receiver fetches fresh)
 * @param {string} [payload.csvText] - Raw CSV text (for pasted/file data)
 * @param {string} [payload.sourceName] - Display name for the data
 */
export function storeTransferData(payload) {
  try {
    sessionStorage.setItem('statlens-transfer', JSON.stringify(payload));
  } catch { /* sessionStorage full or unavailable */ }
}

/**
 * Retrieve and consume transfer data from sessionStorage. Returns null if none.
 * Data is removed after reading (one-shot transfer).
 * @returns {{datasetId?: string, csvText?: string, sourceName?: string}|null}
 */
export function consumeTransferData() {
  try {
    const raw = sessionStorage.getItem('statlens-transfer');
    if (!raw) return null;
    sessionStorage.removeItem('statlens-transfer');
    return JSON.parse(raw);
  } catch { return null; }
}

// ─── Summary URL parsing ────────────────────────────────────────────

/**
 * Parse a compact group summary string from a URL parameter.
 * Format: "Label1:n:mean:sd,Label2:n:mean:sd,..."
 * Labels may contain spaces (encoded as + or %20 in URLs).
 *
 * @param {string} summaryStr - The raw summary parameter value
 * @returns {{ labels: string[], ns: number[], means: number[], sds: number[] } | null}
 *   Returns null if parsing fails or fewer than 2 groups are found.
 */
export function parseGroupSummary(summaryStr) {
  if (!summaryStr) return null;

  const groups = summaryStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
  if (groups.length < 2) return null;

  /** @type {string[]} */
  const labels = [];
  /** @type {number[]} */
  const ns = [];
  /** @type {number[]} */
  const means = [];
  /** @type {number[]} */
  const sds = [];

  for (const g of groups) {
    const parts = g.split(':');
    if (parts.length < 4) return null;

    // Label is everything except the last 3 parts (allows colons in labels, though unlikely)
    const label = parts.slice(0, -3).join(':').trim();
    const n = parseInt(parts[parts.length - 3], 10);
    const m = parseFloat(parts[parts.length - 2]);
    const sd = parseFloat(parts[parts.length - 1]);

    if (!label || !isFinite(n) || n < 1 || !isFinite(m) || !isFinite(sd) || sd < 0) return null;

    labels.push(label);
    ns.push(n);
    means.push(m);
    sds.push(sd);
  }

  return { labels, ns, means, sds };
}

/**
 * Parse a compact two-group summary string from a URL parameter.
 * Format: "Label1:n:mean:sd,Label2:n:mean:sd"
 *
 * @param {string} summaryStr
 * @returns {{ label1: string, n1: number, xbar1: number, s1: number, label2: string, n2: number, xbar2: number, s2: number } | null}
 */
export function parseTwoGroupSummary(summaryStr) {
  const result = parseGroupSummary(summaryStr);
  if (!result || result.labels.length !== 2) return null;
  return {
    label1: result.labels[0], n1: result.ns[0], xbar1: result.means[0], s1: result.sds[0],
    label2: result.labels[1], n2: result.ns[1], xbar2: result.means[1], s2: result.sds[1],
  };
}

/**
 * Parse a compact one-sample summary string from a URL parameter.
 * Format: "n:mean:sd"
 *
 * @param {string} summaryStr
 * @returns {{ n: number, mean: number, sd: number } | null}
 */
export function parseOneSampleSummary(summaryStr) {
  if (!summaryStr) return null;
  const parts = summaryStr.split(':').map(s => s.trim());
  if (parts.length < 3) return null;
  const n = parseInt(parts[0], 10);
  const m = parseFloat(parts[1]);
  const sd = parseFloat(parts[2]);
  if (!isFinite(n) || n < 1 || !isFinite(m) || !isFinite(sd) || sd < 0) return null;
  return { n, mean: m, sd };
}

// ─── Dynamic page title ─────────────────────────────────────────────

/**
 * Update document.title with data context for accessibility and Playwright scraping.
 * Format: "Page Label — Dataset: Variable | StatLens"
 *
 * @param {string} pageLabel - Base page title (e.g. "Bootstrap CI: One Mean")
 * @param {string} [datasetName] - Dataset or source name (e.g. "Penny Ages")
 * @param {object} [opts]
 * @param {string} [opts.variable] - Variable name
 * @param {number} [opts.n] - Sample size
 * @param {string} [opts.extra] - Additional context (e.g. "Left Tail")
 */
export function setPageTitle(pageLabel, datasetName, opts) {
  let title = pageLabel;
  const parts = [];
  if (datasetName && datasetName !== 'edited_data' && datasetName !== 'URL data') {
    parts.push(datasetName);
  }
  if (opts?.variable) parts.push(opts.variable);
  if (parts.length) title += ` \u2014 ${parts.join(': ')}`;
  if (opts?.n) title += ` (n=${opts.n})`;
  if (opts?.extra) title += ` \u2014 ${opts.extra}`;
  title += ' | StatLens';
  document.title = title;
}
