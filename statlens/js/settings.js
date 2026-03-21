// @ts-check
/**
 * StatLens Settings — centralized configuration with localStorage persistence.
 *
 * Two categories:
 *  1. **User settings** — persisted to localStorage, editable via settings dialog.
 *  2. **Constants** — developer defaults (exported for import by other modules).
 *
 * Usage:
 *   import { getSetting, applySettings } from './settings.js';
 *   applySettings();                         // call once on page load
 *   const dp = getSetting('decimalsPValue'); // → 4
 */

// ═══════════════════════════════════════════════════════════════════════
// 1. User Settings — defaults + localStorage persistence
// ═══════════════════════════════════════════════════════════════════════

/** @type {Record<string, any>} */
const DEFAULTS = {
  // Display precision
  decimalsPValue:  4,      // p-values: 0.0213
  decimalsStat:    3,      // test statistics (t, z, χ²): 2.341
  decimalsEstimate: 2,     // means, proportions, slopes: 12.34
  decimalsPMF:     4,      // binomial PMF probabilities: 0.1316

  // Inference defaults
  alpha:           0.05,   // significance level
  confidenceLevel: 0.95,   // CI level (0.80–0.99)

  // Simulation
  defaultBatchSize: 1000,  // last +N button batch size

  // Accessibility & display
  reducedMotion:   'auto', // 'auto' (follow OS), 'on', 'off'
  chartFontScale:  1.0,    // multiplier applied to chart font sizes (1.0 = default)

  // Activity mode
  activityMode:    'discover', // 'discover' (guided, gated) or 'present' (open, all steps visible)

  // Expert mode — hides advanced controls (statistic selector, CI level, chart toggle,
  // bin adjuster, theory overlay) in simple mode for intro students
  expertMode:      false,

  // Show interpretations — when off, hides auto-generated conclusions and
  // interpretation text so students produce their own (calculator vs tutor mode)
  showInterpretations: false,
};

const STORAGE_KEY = 'statlens-settings';

/** @type {Record<string, any>|null} */
let _cache = null;

/**
 * Load settings from localStorage, merged with defaults.
 * @returns {Record<string, any>}
 */
function loadSettings() {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const stored = raw ? JSON.parse(raw) : {};
    // expertMode is session-only — ignore any previously persisted value
    delete stored.expertMode;
    _cache = { ...DEFAULTS, ...stored };
  } catch {
    _cache = { ...DEFAULTS };
  }
  return /** @type {Record<string, any>} */ (_cache);
}

/**
 * Get a single setting value.
 * @param {string} key
 * @returns {any}
 */
export function getSetting(key) {
  return loadSettings()[key];
}

/**
 * Get all settings (merged defaults + user overrides).
 * @returns {Record<string, any>}
 */
export function getSettings() {
  return { ...loadSettings() };
}

/**
 * Update one or more settings and persist to localStorage.
 * @param {Record<string, any>} updates
 */
export function setSettings(updates) {
  const current = loadSettings();
  Object.assign(current, updates);
  _cache = current;
  try {
    // Only persist keys that differ from defaults.
    // expertMode is session-only — never persist (students shouldn't get stuck).
    /** @type {Record<string, any>} */
    const toStore = {};
    for (const [k, v] of Object.entries(current)) {
      if (k === 'expertMode') continue;
      if (v !== DEFAULTS[k]) toStore[k] = v;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toStore));
  } catch { /* localStorage full or unavailable */ }
}

/**
 * Reset all settings to defaults and clear localStorage.
 */
export function resetSettings() {
  _cache = null;
  try { localStorage.removeItem(STORAGE_KEY); } catch { /* */ }
}

/**
 * Check if reduced motion should be active.
 * @returns {boolean}
 */
export function prefersReducedMotion() {
  const pref = getSetting('reducedMotion');
  if (pref === 'on') return true;
  if (pref === 'off') return false;
  // 'auto' — follow OS
  return typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Get the current activity mode, respecting URL param override.
 * URL param ?mode=present or ?mode=discover overrides the saved setting.
 * @returns {'discover'|'present'}
 */
export function getActivityMode() {
  const urlMode = new URLSearchParams(window.location.search).get('mode');
  if (urlMode === 'present' || urlMode === 'discover') return urlMode;
  const saved = getSetting('activityMode');
  return saved === 'present' ? 'present' : 'discover';
}

/**
 * Get whether expert mode is active, respecting URL param override.
 * URL param ?expert=true overrides the saved setting.
 * @returns {boolean}
 */
export function getExpertMode() {
  const urlExpert = new URLSearchParams(window.location.search).get('expert');
  if (urlExpert === 'true' || urlExpert === '1') return true;
  if (urlExpert === 'false' || urlExpert === '0') return false;
  return !!getSetting('expertMode');
}

/**
 * Get whether interpretations should be shown, respecting URL param override.
 * URL param ?interpret=false hides auto-generated conclusions.
 * @returns {boolean}
 */
export function getShowInterpretations() {
  const urlParam = new URLSearchParams(window.location.search).get('interpret');
  if (urlParam === 'false' || urlParam === '0') return false;
  if (urlParam === 'true' || urlParam === '1') return true;
  return !!getSetting('showInterpretations');
}

/**
 * Apply settings to the current page (CSS custom properties, etc.).
 * Call once on page load from each page's init code.
 */
export function applySettings() {
  const s = loadSettings();
  const root = document.documentElement;

  // Activity mode → data attribute on body (CSS can target [data-mode="present"])
  document.body?.setAttribute('data-mode', getActivityMode());

  // Expert mode → data attribute on body (CSS hides .expert-only when off)
  if (getExpertMode()) {
    document.body?.setAttribute('data-expert', 'true');
  } else {
    document.body?.removeAttribute('data-expert');
  }

  // Interpretations toggle → data attribute (CSS hides .interpretation when off)
  if (getShowInterpretations()) {
    document.body?.removeAttribute('data-hide-interpretations');
  } else {
    document.body?.setAttribute('data-hide-interpretations', 'true');
  }

  // Chart font scale → CSS custom property
  if (s.chartFontScale !== 1.0) {
    const base = 14 * s.chartFontScale;
    const phone = 22 * s.chartFontScale;
    root.style.setProperty('--font-size-chart', `${base}px`);
    // Phone override needs a <style> element since we can't do media queries inline
    let phoneStyle = document.getElementById('settings-phone-font');
    if (!phoneStyle) {
      phoneStyle = document.createElement('style');
      phoneStyle.id = 'settings-phone-font';
      document.head.appendChild(phoneStyle);
    }
    phoneStyle.textContent = `@media (max-width: 480px) { :root { --font-size-chart: ${phone}px; } }`;
  }
}

/**
 * Format a p-value using the user's decimal preference.
 * @param {number} p
 * @returns {string}
 */
export function fmtPValue(p) {
  const d = getSetting('decimalsPValue');
  if (p < Math.pow(10, -d)) return `< ${(0).toFixed(d).replace(/0$/, '1')}`;
  return p.toFixed(d);
}

/**
 * Format a test statistic (t, z, χ², F).
 * @param {number} val
 * @returns {string}
 */
export function fmtStat(val) {
  return val.toFixed(getSetting('decimalsStat'));
}

/**
 * Format an estimate (mean, proportion, slope, etc.).
 * @param {number} val
 * @returns {string}
 */
export function fmtEstimate(val) {
  return val.toFixed(getSetting('decimalsEstimate'));
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Constants — not user-configurable, imported by other modules
// ═══════════════════════════════════════════════════════════════════════

// Animation
export const TRANSITION_MS = 300;
export const STAGGER_MS = 120;
export const DELTA_FADEOUT_MS = 800;

// Simulation engine
export const BATCH_SIZE = 50;           // resamples per animation frame
export const PRE_SIM_N = 100;           // initial axis-seeding iterations
export const CHIP_THRESHOLD = 30;       // dotplot ≤ 30, histogram > 30

// Chart layout
export const VIEW_WIDTH = 600;
export const VIEW_HEIGHT = 371;
export const DEFAULT_MARGIN = { top: 28, right: 20, bottom: 50, left: 60 };
export const PHONE_MARGIN = { top: 30, right: 15, bottom: 50, left: 55 };
export const DOMAIN_PAD = 0.05;
export const DOMAIN_PAD_FALLBACK = 0.5;
export const TICKS_DEFAULT = 5;
export const BINS_MIN = 3;
export const BINS_MAX = 50;

// Colors (IMS palette)
export const COLOR = {
  blue:       '#569BBD',
  blueFill:   '#569BBD80',
  blueLight:  '#569BBD30',
  bluePoint:  '#569BDD99',
  dark:       '#114B5F',
  red:        '#F05133',
  green:      '#2e7d32',
  gray:       '#808080',
  grayLight:  '#8a8a8a',
  unshaded:   '#DCE5EC',
  highlight:  '#E07020',
  observedStat: '#7B2D8E',
  white:      '#FFFFFF',
};

// Inference
export const CI_MIN = 0.80;
export const CI_MAX = 0.99;
export const PRESET_ALPHAS = [0.005, 0.01, 0.025, 0.05, 0.10];

// Curve resolution
export const CURVE_POINTS = 200;
export const THEORY_POINTS = 150;

// Limits
export const MAX_BINOMIAL_N = 500;
export const MAX_BOOTSTRAP_LINES = 100;
