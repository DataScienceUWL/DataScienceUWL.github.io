// @ts-check
/**
 * Regression explore tool — standalone page logic.
 * Loads two-variable datasets, computes regression stats, renders scatterplot.
 */

import { drawScatterplot, drawResidualPlot } from '../../../js/scatterplot.js';
import { linreg } from '../../../js/stats.js';
import { parseCSV } from '../../../js/csv-parser.js';

// ── State ──────────────────────────────────────────────────────────────────

/** @type {Array<Object<string,any>>} */
let currentRows = [];

/** @type {string[]} */
let numericColumns = [];

/** @type {string} */
let xVar = '';

/** @type {string} */
let yVar = '';

// ── DOM refs ───────────────────────────────────────────────────────────────

const datasetSelect = /** @type {HTMLSelectElement} */ (document.getElementById('dataset-select'));
const datasetDesc = /** @type {HTMLParagraphElement} */ (document.getElementById('dataset-desc'));
const pasteArea = /** @type {HTMLTextAreaElement} */ (document.getElementById('paste-area'));
const loadPastedBtn = /** @type {HTMLButtonElement} */ (document.getElementById('load-pasted'));
const clearBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear-btn'));
const varPanel = /** @type {HTMLDivElement} */ (document.getElementById('var-panel'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));
const dataPreview = /** @type {HTMLDivElement} */ (document.getElementById('data-preview'));
const dataSummary = /** @type {HTMLOutputElement} */ (document.getElementById('data-summary'));
const chartContainer = /** @type {HTMLDivElement} */ (document.getElementById('chart-container'));
const residualContainer = /** @type {HTMLDivElement} */ (document.getElementById('residual-container'));
const residualChartContainer = /** @type {HTMLDivElement} */ (document.getElementById('residual-chart-container'));
const showLineCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-line'));
const showResidualsCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-residuals'));
const equationDisplay = /** @type {HTMLDivElement} */ (document.getElementById('equation-display'));
const statsDisplay = /** @type {HTMLDivElement} */ (document.getElementById('stats-display'));
const srAnnounce = /** @type {HTMLDivElement} */ (document.getElementById('sr-announce'));

// Tab elements
const tabDataset = /** @type {HTMLButtonElement} */ (document.getElementById('tab-dataset'));
const tabPaste = /** @type {HTMLButtonElement} */ (document.getElementById('tab-paste'));
const panelDataset = /** @type {HTMLDivElement} */ (document.getElementById('panel-dataset'));
const panelPaste = /** @type {HTMLDivElement} */ (document.getElementById('panel-paste'));

// ── Datasets index ─────────────────────────────────────────────────────────

/** @type {Array<{id:string, name:string, description:string, type:string, variables:string[]}>} */
let datasetsIndex = [];

async function loadDatasetsIndex() {
    const resp = await fetch('../../../data/datasets.json');
    datasetsIndex = await resp.json();
    const regressionSets = datasetsIndex.filter(d => d.type === 'regression');

    for (const ds of regressionSets) {
        const opt = document.createElement('option');
        opt.value = ds.id;
        opt.textContent = ds.name;
        datasetSelect.appendChild(opt);
    }
}

/**
 * Load a dataset by ID.
 * @param {string} id
 */
async function loadDataset(id) {
    const resp = await fetch(`../../../data/${id}.json`);
    const data = await resp.json();

    currentRows = data.rows;

    // Find numeric variable names from the dataset metadata
    const varInfo = data.variables || [];
    numericColumns = varInfo
        .filter(/** @param {any} v */ v => v.type === 'numeric')
        .map(/** @param {any} v */ v => v.name);

    // If fewer than 2 numeric columns, try to infer from data
    if (numericColumns.length < 2 && currentRows.length > 0) {
        numericColumns = Object.keys(currentRows[0]).filter(k => {
            return typeof currentRows[0][k] === 'number';
        });
    }

    populateVarSelectors();

    const meta = datasetsIndex.find(d => d.id === id);
    if (meta) {
        datasetDesc.textContent = meta.description;
    }

    dataSummary.textContent = `${currentRows.length} observations, ${numericColumns.length} numeric variables`;
    dataPreview.hidden = false;

    announce(`Loaded ${data.name}: ${currentRows.length} observations`);
    updateChart();
}

// ── Paste data ─────────────────────────────────────────────────────────────

function loadPastedData() {
    const text = pasteArea.value.trim();
    if (!text) return;

    try {
        const parsed = parseCSV(text);
        const numericHeaders = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

        if (numericHeaders.length < 2) {
            announce('Need at least two numeric columns. Check your data format.');
            return;
        }

        // Convert parsed data to numeric rows
        currentRows = parsed.data.map(row => {
            /** @type {Object<string,any>} */
            const out = {};
            for (const h of parsed.headers) {
                const val = row[h];
                if (numericHeaders.includes(h)) {
                    out[h] = val === '' || val === 'NA' ? NaN : Number(val);
                } else {
                    out[h] = val;
                }
            }
            return out;
        });

        numericColumns = numericHeaders;
        populateVarSelectors();

        dataSummary.textContent = `${currentRows.length} observations, ${numericColumns.length} numeric variables`;
        dataPreview.hidden = false;

        announce(`Loaded pasted data: ${currentRows.length} observations`);
        updateChart();
    } catch (e) {
        announce(`Error parsing data: ${e instanceof Error ? e.message : String(e)}`);
    }
}

// ── Variable selectors ─────────────────────────────────────────────────────

function populateVarSelectors() {
    xVarSelect.innerHTML = '';
    yVarSelect.innerHTML = '';

    for (const col of numericColumns) {
        const optX = document.createElement('option');
        optX.value = col;
        optX.textContent = col;
        xVarSelect.appendChild(optX);

        const optY = document.createElement('option');
        optY.value = col;
        optY.textContent = col;
        yVarSelect.appendChild(optY);
    }

    // Default: first column = X, second = Y
    if (numericColumns.length >= 2) {
        xVarSelect.value = numericColumns[0];
        yVarSelect.value = numericColumns[1];
    }

    xVar = xVarSelect.value;
    yVar = yVarSelect.value;

    varPanel.hidden = false;
}

// ── Chart rendering ────────────────────────────────────────────────────────

function updateChart() {
    xVar = xVarSelect.value;
    yVar = yVarSelect.value;

    if (!xVar || !yVar || xVar === yVar) {
        chartContainer.innerHTML = '';
        equationDisplay.hidden = true;
        statsDisplay.hidden = true;
        residualContainer.hidden = true;
        if (xVar === yVar && xVar) {
            announce('X and Y variables must be different.');
        }
        return;
    }

    // Extract numeric values, filtering NaN pairs
    const xAll = currentRows.map(r => Number(r[xVar]));
    const yAll = currentRows.map(r => Number(r[yVar]));

    /** @type {number[]} */
    const xClean = [];
    /** @type {number[]} */
    const yClean = [];
    for (let i = 0; i < xAll.length; i++) {
        if (isFinite(xAll[i]) && isFinite(yAll[i])) {
            xClean.push(xAll[i]);
            yClean.push(yAll[i]);
        }
    }

    if (xClean.length < 2) {
        chartContainer.innerHTML = '<p class="placeholder">Need at least 2 valid data points.</p>';
        equationDisplay.hidden = true;
        statsDisplay.hidden = true;
        residualContainer.hidden = true;
        return;
    }

    // Compute regression
    const reg = linreg(xClean, yClean);
    const showLine = showLineCheckbox.checked;

    // Draw scatterplot
    chartContainer.innerHTML = '';
    drawScatterplot(chartContainer, xClean, yClean, {
        xLabel: xVar,
        yLabel: yVar,
        titleText: `Scatterplot of ${yVar} vs ${xVar}`,
        descText: `Scatterplot with ${xClean.length} points showing ${yVar} on the y-axis and ${xVar} on the x-axis.`,
        id: 'scatter-main',
        regression: showLine ? { slope: reg.slope, intercept: reg.intercept } : undefined,
    });

    // Equation display
    const b0 = formatNum(reg.intercept);
    const b1 = formatNum(reg.slope);
    const sign = reg.slope >= 0 ? '+' : '';
    equationDisplay.innerHTML = `&#375; = ${b0} ${sign} ${b1} &middot; x`;
    equationDisplay.hidden = false;

    // Stats display
    const n = xClean.length;
    const residSE = n > 2
        ? Math.sqrt(reg.residuals.reduce((s, e) => s + e * e, 0) / (n - 2))
        : NaN;

    statsDisplay.innerHTML = `
        <div class="stat-card">
            <div class="stat-label">Correlation (r)</div>
            <div class="stat-value">${formatNum(reg.r)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">R-squared</div>
            <div class="stat-value">${formatNum(reg.r2)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Slope (b&#8321;)</div>
            <div class="stat-value">${formatNum(reg.slope)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Intercept (b&#8320;)</div>
            <div class="stat-value">${formatNum(reg.intercept)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Residual SE</div>
            <div class="stat-value">${formatNum(residSE)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">n</div>
            <div class="stat-value">${n}</div>
        </div>
    `;
    statsDisplay.hidden = false;

    // Residual plot
    if (showResidualsCheckbox.checked) {
        residualContainer.hidden = false;
        residualChartContainer.innerHTML = '';
        drawResidualPlot(residualChartContainer, reg.fitted, reg.residuals, {
            id: 'resid-plot',
            titleText: 'Residual plot',
            descText: `Residuals vs fitted values for the regression of ${yVar} on ${xVar}.`,
        });
    } else {
        residualContainer.hidden = true;
    }

    announce(`Regression: r = ${formatNum(reg.r)}, R-squared = ${formatNum(reg.r2)}, slope = ${formatNum(reg.slope)}`);
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Format a number for display with up to 4 decimal places.
 * @param {number} val
 * @returns {string}
 */
function formatNum(val) {
    if (!isFinite(val)) return 'N/A';
    // Use up to 4 significant digits for display
    if (Math.abs(val) >= 100) return val.toFixed(2);
    if (Math.abs(val) >= 10) return val.toFixed(3);
    return val.toFixed(4);
}

/**
 * Announce a message to screen readers.
 * @param {string} msg
 */
function announce(msg) {
    srAnnounce.textContent = msg;
}

// ── Tab switching ──────────────────────────────────────────────────────────

function setupTabs() {
    const tabs = [tabDataset, tabPaste];
    const panels = [panelDataset, panelPaste];

    for (let i = 0; i < tabs.length; i++) {
        tabs[i].addEventListener('click', () => {
            tabs.forEach(t => t.setAttribute('aria-selected', 'false'));
            panels.forEach(p => p.hidden = true);
            tabs[i].setAttribute('aria-selected', 'true');
            panels[i].hidden = false;
        });
    }
}

// ── Event listeners ────────────────────────────────────────────────────────

function init() {
    setupTabs();

    loadDatasetsIndex().catch(err => {
        console.error('Failed to load datasets index:', err);
    });

    datasetSelect.addEventListener('change', () => {
        const id = datasetSelect.value;
        if (id) {
            loadDataset(id).catch(err => {
                console.error('Failed to load dataset:', err);
                announce('Failed to load dataset.');
            });
        }
    });

    loadPastedBtn.addEventListener('click', loadPastedData);

    clearBtn.addEventListener('click', () => {
        pasteArea.value = '';
        currentRows = [];
        numericColumns = [];
        chartContainer.innerHTML = '';
        equationDisplay.hidden = true;
        statsDisplay.hidden = true;
        residualContainer.hidden = true;
        varPanel.hidden = true;
        dataPreview.hidden = true;
        datasetSelect.value = '';
        datasetDesc.textContent = '';
    });

    xVarSelect.addEventListener('change', updateChart);
    yVarSelect.addEventListener('change', updateChart);
    showLineCheckbox.addEventListener('change', updateChart);
    showResidualsCheckbox.addEventListener('change', updateChart);
}

init();
