// @ts-check
/**
 * Shared statistics table builders.
 * Used by descriptive, grouped, and multi (Data Explorer) apps.
 */

import { mean, median, sd, quantile, iqr, range, detectPrecision, formatStat } from './stats.js';
import { getColors } from './chart-utils.js';
import { computeBins } from './histogram.js';

// ── Grouped stats table ──────────────────────────────────────────────

/**
 * Stat row definitions for grouped tables.
 * @param {number} dp - Decimal precision
 * @returns {Array<{ label: string, fn: (v: number[]) => string, sep?: boolean }>}
 */
function groupedStatDefs(dp) {
  return [
    { label: 'n', fn: (v) => String(v.length) },
    { label: 'Mean', fn: (v) => formatStat(mean(v), dp), sep: true },
    { label: 'Std Dev', fn: (v) => formatStat(sd(v), dp) },
    { label: 'Min', fn: (v) => { const [lo] = range(v); return formatStat(lo, dp); }, sep: true },
    { label: 'Q1', fn: (v) => formatStat(quantile(v, 0.25), dp) },
    { label: 'Median', fn: (v) => formatStat(median(v), dp) },
    { label: 'Q3', fn: (v) => formatStat(quantile(v, 0.75), dp) },
    { label: 'Max', fn: (v) => { const [, hi] = range(v); return formatStat(hi, dp); } },
    { label: 'IQR', fn: (v) => formatStat(iqr(v), dp), sep: true },
    { label: 'Range', fn: (v) => { const [lo, hi] = range(v); return formatStat(hi - lo, dp); } },
  ];
}

/**
 * Build a color-coded grouped statistics table.
 *
 * @param {HTMLElement} container - Element to append the table to (innerHTML is NOT cleared)
 * @param {Record<string, number[]>} grouped - { groupName: number[] }
 * @param {object} [options]
 * @param {string} [options.numLabel] - Quantitative variable label (for aria-label)
 * @param {string} [options.catLabel] - Grouping variable label (for aria-label)
 * @param {string[]} [options.colors] - Override group colors
 * @returns {HTMLTableElement} The created table element
 */
export function buildGroupedStatsTable(container, grouped, options) {
  const groups = Object.keys(grouped);
  const allValues = groups.flatMap(g => grouped[g]);
  const dp = detectPrecision(allValues);
  const colors = options?.colors ?? getColors(groups.length);
  const numLabel = options?.numLabel ?? 'Value';
  const catLabel = options?.catLabel ?? 'Group';

  const table = document.createElement('table');
  table.setAttribute('aria-label', `Group statistics for ${numLabel} by ${catLabel}`);

  // Header row with color-coded group names
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const thStat = document.createElement('th');
  thStat.scope = 'col';
  thStat.textContent = 'Statistic';
  headerRow.appendChild(thStat);

  for (let i = 0; i < groups.length; i++) {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = groups[i];
    th.style.borderBottom = `3px solid ${colors[i % colors.length]}`;
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Stat rows
  const tbody = document.createElement('tbody');
  const stats = groupedStatDefs(dp);

  for (const stat of stats) {
    const tr = document.createElement('tr');
    if (stat.sep) tr.className = 'stat-sep';

    const th = document.createElement('th');
    th.scope = 'row';
    th.textContent = stat.label;
    tr.appendChild(th);

    for (let i = 0; i < groups.length; i++) {
      const td = document.createElement('td');
      td.textContent = stat.fn(grouped[groups[i]]);
      td.style.backgroundColor = colors[i % colors.length] + '12';
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.appendChild(table);
  return table;
}

// ── Single-variable numeric stats ────────────────────────────────────

/**
 * Build a two-column statistics table for a single numeric variable.
 *
 * @param {HTMLElement} container - Element to receive the table (innerHTML IS cleared)
 * @param {string} label - Variable label
 * @param {number[]} values
 * @returns {HTMLTableElement}
 */
export function buildNumericStatsTable(container, label, values) {
  const dp = detectPrecision(values);
  const [lo, hi] = range(values);

  container.innerHTML = '';
  const table = document.createElement('table');
  table.setAttribute('aria-label', `Summary statistics for ${label}`);

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>Statistic</th><th>Value</th></tr>';
  table.appendChild(thead);

  const rows = [
    ['n', String(values.length)],
    ['Mean', formatStat(mean(values), dp)],
    ['Median', formatStat(median(values), dp)],
    ['SD', formatStat(sd(values), dp)],
    ['IQR', formatStat(iqr(values), dp)],
    ['Min', formatStat(lo, dp)],
    ['Q1', formatStat(quantile(values, 0.25), dp)],
    ['Q3', formatStat(quantile(values, 0.75), dp)],
    ['Max', formatStat(hi, dp)],
  ];

  const tbody = document.createElement('tbody');
  for (const [stat, val] of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${stat}</td><td>${val}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);

  container.appendChild(table);
  return table;
}

// ── Bin frequency table ──────────────────────────────────────────────

/**
 * Render a collapsible bin frequency table (single-variable or grouped).
 *
 * @param {HTMLElement} container - Element to append the table to
 * @param {Array<{x0: any, x1: any, length: number}>} bins
 * @param {object} [options]
 * @param {number} [options.totalN] - Total N (defaults to sum of bins)
 * @param {boolean} [options.relativeFrequency] - Show proportions instead of counts
 * @param {number} [options.precision] - Decimal precision for bin labels
 * @param {Record<string, number[]>} [options.grouped] - If provided, adds per-group columns
 * @param {[number, number]} [options.domain] - Shared domain for grouped bins
 * @param {number[]} [options.thresholds] - Shared thresholds for grouped bins
 */
export function renderBinTable(container, bins, options) {
  const relativeFreq = options?.relativeFrequency ?? false;
  const dp = options?.precision ?? 0;
  const totalN = options?.totalN ?? bins.reduce((s, b) => s + b.length, 0);
  const grouped = options?.grouped;

  // Compute per-group bin counts if grouped
  /** @type {Record<string, number[]> | null} */
  let groupBinCounts = null;
  /** @type {string[]} */
  let groupNames = [];
  if (grouped && options?.domain && options?.thresholds) {
    groupBinCounts = {};
    groupNames = Object.keys(grouped);
    for (const name of groupNames) {
      const { bins: gBins } = computeBins(grouped[name], {
        domain: options.domain,
        thresholds: options.thresholds,
      });
      groupBinCounts[name] = gBins.map(b => b.length);
    }
  }

  const details = document.createElement('details');
  details.className = 'bin-table-details';
  details.style.cssText = 'margin:0.5rem 0;font-size:0.85rem;';
  const summary = document.createElement('summary');
  summary.textContent = relativeFreq ? 'Bin proportions' : 'Bin frequencies';
  summary.style.cssText = 'cursor:pointer;color:var(--ims-green);font-weight:500;';
  details.appendChild(summary);

  const table = document.createElement('table');
  table.className = 'bin-freq-table';
  table.style.cssText = 'width:100%;border-collapse:collapse;margin:0.4rem 0;font-size:0.82rem;';

  // Header
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  const thBin = document.createElement('th');
  thBin.textContent = 'Bin';
  thBin.style.cssText = 'text-align:left;padding:0.2rem 0.4rem;border-bottom:2px solid #ccc;';
  headerRow.appendChild(thBin);

  if (groupBinCounts) {
    for (const name of groupNames) {
      const th = document.createElement('th');
      th.textContent = name;
      th.style.cssText = 'text-align:right;padding:0.2rem 0.4rem;border-bottom:2px solid #ccc;';
      headerRow.appendChild(th);
    }
  } else {
    const th = document.createElement('th');
    th.textContent = relativeFreq ? 'Proportion' : 'Frequency';
    th.style.cssText = 'text-align:right;padding:0.2rem 0.4rem;border-bottom:2px solid #ccc;';
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  // Rows
  const tbody = document.createElement('tbody');
  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i];
    const tr = document.createElement('tr');
    if (i % 2 === 1) tr.style.background = '#f8f8f8';

    const tdBin = document.createElement('td');
    tdBin.textContent = `[${formatStat(bin.x0, dp)}, ${formatStat(bin.x1, dp)})`;
    tdBin.style.cssText = 'padding:0.2rem 0.4rem;border-bottom:1px solid #eee;white-space:nowrap;';
    tr.appendChild(tdBin);

    if (groupBinCounts) {
      for (const name of groupNames) {
        const td = document.createElement('td');
        const count = groupBinCounts[name][i] ?? 0;
        if (relativeFreq) {
          const n = grouped?.[name]?.length || 1;
          const rf = count / n;
          td.textContent = rf === 0 ? '0' : rf.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
        } else {
          td.textContent = String(count);
        }
        td.style.cssText = 'text-align:right;padding:0.2rem 0.4rem;border-bottom:1px solid #eee;';
        tr.appendChild(td);
      }
    } else {
      const tdVal = document.createElement('td');
      if (relativeFreq) {
        const rf = bin.length / (totalN || 1);
        tdVal.textContent = rf === 0 ? '0' : rf.toFixed(4).replace(/0+$/, '').replace(/\.$/, '');
      } else {
        tdVal.textContent = String(bin.length);
      }
      tdVal.style.cssText = 'text-align:right;padding:0.2rem 0.4rem;border-bottom:1px solid #eee;';
      tr.appendChild(tdVal);
    }

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  details.appendChild(table);
  container.appendChild(details);
}
