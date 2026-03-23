// @ts-check
/**
 * Regression explore tool — standalone page logic.
 * Loads two-variable datasets, computes regression stats, renders scatterplot.
 */

import { drawScatterplot, drawResidualPlot } from '../../js/scatterplot.js';
import { linreg, loess, detectPrecision, formatStat } from '../../js/stats.js';
import { announce, initTabs, initDataPanel, initHelp, setPageTitle } from '../../js/page-utils.js';


initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ── State ──────────────────────────────────────────────────────────────────

/** @type {Array<Object<string,any>>} */
let currentRows = [];

/** @type {string[]} */
let numericColumns = [];

/** @type {string} */
let xVar = '';

/** @type {string} */
let yVar = '';

/** Decimal places in source data (for formatStat). */
let dataPrecision = 0;

// ── DOM refs ───────────────────────────────────────────────────────────────

const varPanel = /** @type {HTMLDivElement} */ (document.getElementById('var-panel'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));
const dataPreview = /** @type {HTMLDivElement} */ (document.getElementById('data-preview'));
const dataSummary = /** @type {HTMLOutputElement} */ (document.getElementById('data-summary'));
const chartContainer = /** @type {HTMLDivElement} */ (document.getElementById('chart-container'));
const residualContainer = /** @type {HTMLDivElement} */ (document.getElementById('residual-container'));
const residualChartContainer = /** @type {HTMLDivElement} */ (document.getElementById('residual-chart-container'));
const showLineCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-line'));
const showLoessCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-loess'));
const showResidualsCheckbox = /** @type {HTMLInputElement} */ (document.getElementById('show-residuals'));
const equationDisplay = /** @type {HTMLDivElement} */ (document.getElementById('equation-display'));
const statsDisplay = /** @type {HTMLDivElement} */ (document.getElementById('stats-display'));

/**
 * Load parsed CSV data (shared by paste + file handlers).
 * @param {{headers:string[], types:string[], data:Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function loadParsedData(parsed, sourceName) {
    const numericHeaders = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');

    if (numericHeaders.length < 2) {
        announce('Need at least two numeric columns. Check your data format.');
        return;
    }

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

    setPageTitle(baseTitle, sourceName, { n: currentRows.length });
    announce(`${sourceName}: ${currentRows.length} observations.`);
    updateChart();
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
    dataPrecision = Math.max(detectPrecision(xClean), detectPrecision(yClean));
    const d = dataPrecision;

    // LOESS curve
    const showLoess = showLoessCheckbox.checked;
    const loessCurveData = showLoess ? loess(xClean, yClean) : undefined;

    // Draw scatterplot
    chartContainer.innerHTML = '';
    drawScatterplot(chartContainer, xClean, yClean, {
        xLabel: xVar,
        yLabel: yVar,
        titleText: `Scatterplot of ${yVar} vs ${xVar}`,
        descText: `Scatterplot with ${xClean.length} points showing ${yVar} on the y-axis and ${xVar} on the x-axis.`,
        id: 'scatter-main',
        regression: showLine ? { slope: reg.slope, intercept: reg.intercept } : undefined,
        loessCurve: loessCurveData,
    });

    // Equation display
    const b0 = formatStat(reg.intercept, d);
    const b1 = formatStat(reg.slope, d);
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
            <div class="stat-value">${formatStat(reg.r, d, 'correlation')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">R-squared</div>
            <div class="stat-value">${formatStat(reg.r2, d, 'correlation')}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Slope (b&#8321;)</div>
            <div class="stat-value">${formatStat(reg.slope, d)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Intercept (b&#8320;)</div>
            <div class="stat-value">${formatStat(reg.intercept, d)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Residual SE</div>
            <div class="stat-value">${formatStat(residSE, d)}</div>
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

    announce(`Regression: r = ${formatStat(reg.r, d, 'correlation')}, R² = ${formatStat(reg.r2, d, 'correlation')}, slope = ${formatStat(reg.slope, d)}`);
}

// ── Init ──────────────────────────────────────────────────────────────────

initTabs();

initDataPanel({
    autoCollapse: true,
    showPreview: true,
    datasetFilter: ds => ds.type === 'regression',
    onDataset: (ds) => {
        currentRows = ds.rows;
        const varInfo = ds.variables || [];
        numericColumns = varInfo
            .filter(/** @param {any} v */ v => v.type === 'numeric')
            .map(/** @param {any} v */ v => v.name);

        if (numericColumns.length < 2 && currentRows.length > 0) {
            numericColumns = Object.keys(currentRows[0]).filter(k =>
                typeof currentRows[0][k] === 'number');
        }

        // Reset controls to defaults on new data
        showLineCheckbox.checked = true;
        showLoessCheckbox.checked = false;
        showResidualsCheckbox.checked = false;

        populateVarSelectors();
        dataSummary.textContent = `${currentRows.length} observations, ${numericColumns.length} numeric variables`;
        announce(`${ds.name}: ${currentRows.length} observations.`);
        updateChart();
    },
    onText: loadParsedData,
    onClear: () => {
        currentRows = [];
        numericColumns = [];
        chartContainer.innerHTML = '';
        equationDisplay.hidden = true;
        statsDisplay.hidden = true;
        residualContainer.hidden = true;
        varPanel.hidden = true;
        dataPreview.hidden = true;
    },
});

xVarSelect.addEventListener('change', updateChart);
yVarSelect.addEventListener('change', updateChart);
showLineCheckbox.addEventListener('change', updateChart);
showLoessCheckbox.addEventListener('change', updateChart);
showResidualsCheckbox.addEventListener('change', updateChart);
