// @ts-check
/**
 * Regression by Eye — drag a line to fit the data, see residual squares,
 * compare to the least-squares regression line.
 */

import * as d3Selection from 'd3-selection';
import * as d3Scale from 'd3-scale';
import * as d3Array from 'd3-array';
import * as d3Axis from 'd3-axis';
import * as d3Drag from 'd3-drag';
import { linreg, formatStat, detectPrecision, sum } from '../../js/stats.js';
import { createChart, addAxes, formatTick } from '../../js/chart-utils.js';
import { pointRadius } from '../../js/scatterplot.js';
import { announce, initTabs, initDataPanel, initHelp } from '../../js/page-utils.js';

initHelp();

// ─── Constants ──────────────────────────────────────────────────────────────

const USER_COLOR = '#009E73';
const USER_COLOR_LIGHT = '#009E7399';
const USER_SQUARE_FILL = '#009E7322';
const USER_SQUARE_STROKE = '#009E7366';
const LS_COLOR = '#808080';
const LS_SQUARE_FILL = '#80808018';
const LS_SQUARE_STROKE = '#80808044';
const POINT_FILL = '#569BBD99';
const POINT_STROKE = '#569BBD';
const HANDLE_RADIUS = 8; // viewBox units — large enough for touch

/** Debounce interval for screen reader announcements (ms). */
const ANNOUNCE_DEBOUNCE = 500;

// ─── State ──────────────────────────────────────────────────────────────────

/** @type {Array<Record<string,any>>} */
let currentRows = [];
/** @type {string[]} */
let numericColumns = [];
let xVar = '';
let yVar = '';
let dataPrecision = 0;

/** Cleaned numeric arrays for the current variable selection. */
/** @type {number[]} */ let xData = [];
/** @type {number[]} */ let yData = [];

/** Student's line defined by y-values at the left and right edges. */
let handleLeftY = 0;
let handleRightY = 0;

/** Cached LS regression result. */
/** @type {ReturnType<typeof linreg> | null} */
let lsResult = null;

/** Current D3 scales and frame (set by renderChart). */
/** @type {d3Scale.ScaleLinear<number,number> | null} */ let xScale = null;
/** @type {d3Scale.ScaleLinear<number,number> | null} */ let yScale = null;
/** @type {import('../../js/types.js').ChartFrame | null} */ let frame = null;

/** Timer for debounced announcements. */
let announceTimer = 0;

/** Exercise mode — hides the LS line checkbox. */
const exerciseMode = new URLSearchParams(location.search).get('exercise') === 'true';

// ─── DOM Refs ───────────────────────────────────────────────────────────────

const varPanel = /** @type {HTMLDivElement} */ (document.getElementById('var-panel'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));
const dataSummary = /** @type {HTMLOutputElement} */ (document.getElementById('data-summary'));
const chartContainer = /** @type {HTMLDivElement} */ (document.getElementById('chart-container'));
const sidebar = /** @type {HTMLDivElement} */ (document.getElementById('sidebar'));

const showResidualsCheck = /** @type {HTMLInputElement} */ (document.getElementById('show-residuals'));
const showSquaresCheck = /** @type {HTMLInputElement} */ (document.getElementById('show-squares'));
const showLsCheck = /** @type {HTMLInputElement} */ (document.getElementById('show-ls'));
const showLsLabel = /** @type {HTMLLabelElement} */ (document.getElementById('show-ls-label'));

const yourEqBlock = /** @type {HTMLDivElement} */ (document.getElementById('your-equation'));
const yourEqText = /** @type {HTMLDivElement} */ (document.getElementById('your-eq-text'));
const lsEqBlock = /** @type {HTMLDivElement} */ (document.getElementById('ls-equation'));
const lsEqText = /** @type {HTMLDivElement} */ (document.getElementById('ls-eq-text'));
const statsArea = /** @type {HTMLDivElement} */ (document.getElementById('stats-area'));
const sseComparison = /** @type {HTMLDivElement} */ (document.getElementById('sse-comparison'));
const tryAgainBtn = /** @type {HTMLButtonElement} */ (document.getElementById('try-again-btn'));

// ─── Exercise mode: hide LS checkbox ────────────────────────────────────────

if (exerciseMode) {
    showLsLabel.hidden = true;
}

// ─── Utility ────────────────────────────────────────────────────────────────

/**
 * Compute slope and intercept from the two handle y-values.
 * Handles are at xScale.domain()[0] and xScale.domain()[1].
 */
function userLineParams() {
    if (!xScale) return { slope: 0, intercept: 0 };
    const [x0, x1] = xScale.domain();
    const slope = (handleRightY - handleLeftY) / (x1 - x0);
    const intercept = handleLeftY - slope * x0;
    return { slope, intercept };
}

/**
 * Compute residuals and SSE for a given slope/intercept.
 * @param {number} slope
 * @param {number} intercept
 */
function computeResiduals(slope, intercept) {
    const residuals = yData.map((y, i) => y - (intercept + slope * xData[i]));
    const sse = residuals.reduce((s, e) => s + e * e, 0);
    const sae = residuals.reduce((s, e) => s + Math.abs(e), 0);
    return { residuals, sse, sae };
}

/**
 * Set handle positions to a "reasonable but wrong" starting line.
 * Places the line at the mean of y ± some random offset.
 */
function randomizeLine() {
    if (yData.length < 2 || !yScale) return;
    const yMean = sum(yData) / yData.length;
    const yRange = (d3Array.max(yData) ?? 0) - (d3Array.min(yData) ?? 0);
    const offset = (Math.random() - 0.5) * yRange * 0.4;
    const tilt = (Math.random() - 0.5) * yRange * 0.3;
    handleLeftY = yMean + offset - tilt;
    handleRightY = yMean + offset + tilt;
}

// ─── Chart Rendering ────────────────────────────────────────────────────────

function renderChart() {
    if (xData.length < 2) {
        chartContainer.innerHTML = '<p class="placeholder">Need at least 2 valid data points.</p>';
        sidebar.hidden = true;
        return;
    }

    // Compute LS regression
    lsResult = linreg(xData, yData);
    dataPrecision = Math.max(detectPrecision(xData), detectPrecision(yData));

    // Clear and create chart frame
    chartContainer.innerHTML = '';
    frame = createChart(chartContainer, {
        titleText: `Regression by Eye: ${yVar} vs ${xVar}`,
        descText: `Interactive scatterplot. Drag the green handles to fit a line to the data.`,
        id: 'rbe-chart',
    });

    // Scales with 5% padding
    const xExtent = /** @type {[number,number]} */ (d3Array.extent(xData));
    const yExtent = /** @type {[number,number]} */ (d3Array.extent(yData));
    const xPad = (xExtent[1] - xExtent[0]) * 0.05 || 0.5;
    const yPad = (yExtent[1] - yExtent[0]) * 0.05 || 0.5;

    xScale = d3Scale.scaleLinear()
        .domain([xExtent[0] - xPad, xExtent[1] + xPad])
        .range([0, frame.width]);

    yScale = d3Scale.scaleLinear()
        .domain([yExtent[0] - yPad, yExtent[1] + yPad])
        .nice()
        .range([frame.height, 0]);

    const xAxis = d3Axis.axisBottom(xScale).tickFormat(formatTick);
    const yAxis = d3Axis.axisLeft(yScale).tickFormat(formatTick);
    addAxes(frame, xAxis, yAxis, xVar, yVar);

    // Data points
    const inner = d3Selection.select(frame.inner);
    const dataGroup = inner.select('.data');
    const n = xData.length;
    const r = pointRadius(n);

    dataGroup.selectAll('circle.data-point')
        .data(xData.map((x, i) => ({ x, y: yData[i] })))
        .join('circle')
        .attr('class', 'data-point')
        .attr('cx', d => /** @type {Function} */ (xScale)(d.x))
        .attr('cy', d => /** @type {Function} */ (yScale)(d.y))
        .attr('r', r)
        .attr('fill', POINT_FILL)
        .attr('stroke', POINT_STROKE)
        .attr('stroke-width', 1);

    // Initialize student line if not already set
    randomizeLine();

    // Draw interactive layers
    drawUserLine();
    drawResiduals();
    drawSquares();
    drawLsLine();
    drawHandles();

    // Update sidebar
    sidebar.hidden = false;
    updateStats();
}

/** Draw or update the student's line. */
function drawUserLine() {
    if (!frame || !xScale || !yScale) return;
    const overlays = d3Selection.select(frame.inner).select('.overlays');
    const [x0, x1] = xScale.domain();

    overlays.selectAll('.user-line').remove();
    overlays.append('line')
        .attr('class', 'user-line')
        .attr('x1', xScale(x0))
        .attr('y1', yScale(handleLeftY))
        .attr('x2', xScale(x1))
        .attr('y2', yScale(handleRightY))
        .attr('stroke', USER_COLOR)
        .attr('stroke-width', 2.5)
        .style('pointer-events', 'none');
}

/** Draw or update residual lines (vertical dashed lines from point to user line). */
function drawResiduals() {
    if (!frame || !xScale || !yScale) return;
    const overlays = d3Selection.select(frame.inner).select('.overlays');
    overlays.selectAll('.residual-line').remove();

    if (!showResidualsCheck.checked) return;

    const { slope, intercept } = userLineParams();

    overlays.selectAll('.residual-line')
        .data(xData.map((x, i) => ({ x, y: yData[i], yHat: intercept + slope * x })))
        .join('line')
        .attr('class', 'residual-line')
        .attr('x1', d => /** @type {Function} */ (xScale)(d.x))
        .attr('y1', d => /** @type {Function} */ (yScale)(d.y))
        .attr('x2', d => /** @type {Function} */ (xScale)(d.x))
        .attr('y2', d => /** @type {Function} */ (yScale)(d.yHat))
        .attr('stroke', USER_COLOR_LIGHT)
        .attr('stroke-width', 1.5)
        .attr('stroke-dasharray', '4,3')
        .style('pointer-events', 'none');
}

/** Draw or update squared residual rectangles. */
function drawSquares() {
    if (!frame || !xScale || !yScale) return;
    const overlays = d3Selection.select(frame.inner).select('.overlays');
    overlays.selectAll('.residual-square').remove();

    if (!showSquaresCheck.checked) return;

    const { slope, intercept } = userLineParams();

    const squareData = xData.map((x, i) => {
        const yHat = intercept + slope * x;
        const residual = yData[i] - yHat;
        return { x, y: yData[i], yHat, residual };
    });

    overlays.selectAll('.residual-square')
        .data(squareData)
        .join('rect')
        .attr('class', 'residual-square')
        .attr('aria-hidden', 'true')
        .each(function (d) {
            const el = d3Selection.select(this);
            const absRes = Math.abs(d.residual);
            // Square side in pixels
            const sideX = Math.abs(/** @type {Function} */ (xScale)(d.x + absRes) - /** @type {Function} */ (xScale)(d.x));
            const sideY = Math.abs(/** @type {Function} */ (yScale)(d.yHat) - /** @type {Function} */ (yScale)(d.yHat + absRes));
            // Use the smaller of the two for a proper square appearance
            const side = Math.min(sideX, sideY);

            // Position: corner at data point, extend toward the line
            const px = /** @type {Function} */ (xScale)(d.x);
            const pyPoint = /** @type {Function} */ (yScale)(d.y);
            const pyHat = /** @type {Function} */ (yScale)(d.yHat);

            // Square extends from the point toward the line vertically
            const top = Math.min(pyPoint, pyHat);

            // Horizontal: extend to the right from the point
            el.attr('x', px)
                .attr('y', top)
                .attr('width', side)
                .attr('height', Math.abs(pyPoint - pyHat))
                .attr('fill', USER_SQUARE_FILL)
                .attr('stroke', USER_SQUARE_STROKE)
                .attr('stroke-width', 0.75);
        })
        .style('pointer-events', 'none');
}

/** Draw or update the LS regression line. */
function drawLsLine() {
    if (!frame || !xScale || !yScale || !lsResult) return;
    const overlays = d3Selection.select(frame.inner).select('.overlays');
    overlays.selectAll('.ls-line').remove();

    if (!showLsCheck.checked) return;

    const [x0, x1] = xScale.domain();
    overlays.append('line')
        .attr('class', 'ls-line')
        .attr('x1', xScale(x0))
        .attr('y1', yScale(lsResult.intercept + lsResult.slope * x0))
        .attr('x2', xScale(x1))
        .attr('y2', yScale(lsResult.intercept + lsResult.slope * x1))
        .attr('stroke', LS_COLOR)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6,4')
        .style('pointer-events', 'none');
}

/** Create draggable handles at the line endpoints. */
function drawHandles() {
    if (!frame || !xScale || !yScale) return;
    const annotations = d3Selection.select(frame.inner).select('.annotations');
    annotations.selectAll('.drag-handle').remove();

    const [x0, x1] = xScale.domain();
    const [yMin, yMax] = yScale.domain();

    const handles = [
        { id: 'left', dataX: x0, dataY: handleLeftY },
        { id: 'right', dataX: x1, dataY: handleRightY },
    ];

    const drag = d3Drag.drag()
        .on('drag', function (event) {
            const handle = d3Selection.select(this);
            const hid = handle.attr('data-handle');
            // Clamp to y-scale range
            const newPixelY = Math.max(0, Math.min(frame?.height ?? 0, event.y));
            const newDataY = /** @type {Function} */ (yScale).invert(newPixelY);

            if (hid === 'left') {
                handleLeftY = newDataY;
            } else {
                handleRightY = newDataY;
            }

            handle.attr('cy', newPixelY);
            updateFromDrag();
        });

    annotations.selectAll('.drag-handle')
        .data(handles)
        .join('circle')
        .attr('class', 'drag-handle')
        .attr('data-handle', d => d.id)
        .attr('cx', d => /** @type {Function} */ (xScale)(d.dataX))
        .attr('cy', d => /** @type {Function} */ (yScale)(d.dataY))
        .attr('r', HANDLE_RADIUS)
        .attr('fill', USER_COLOR)
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .attr('tabindex', 0)
        .attr('role', 'slider')
        .attr('aria-label', d => `${d.id === 'left' ? 'Left' : 'Right'} handle`)
        .attr('aria-valuemin', yMin)
        .attr('aria-valuemax', yMax)
        .attr('aria-valuenow', d => d.dataY.toFixed(1))
        .style('cursor', 'ns-resize')
        .style('touch-action', 'none')
        .call(/** @type {any} */ (drag))
        .on('keydown', function (event) {
            const handle = d3Selection.select(this);
            const hid = handle.attr('data-handle');
            const yRange = yMax - yMin;
            const step = event.shiftKey ? yRange * 0.05 : yRange * 0.01;
            let newY = hid === 'left' ? handleLeftY : handleRightY;

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                newY += step;
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                newY -= step;
            } else {
                return;
            }

            // Clamp
            newY = Math.max(yMin, Math.min(yMax, newY));

            if (hid === 'left') {
                handleLeftY = newY;
            } else {
                handleRightY = newY;
            }

            handle.attr('cy', /** @type {Function} */ (yScale)(newY))
                .attr('aria-valuenow', newY.toFixed(1));
            updateFromDrag();
        });
}

/** Fast update during dragging — redraw line, residuals, squares, stats. */
function updateFromDrag() {
    drawUserLine();
    drawResiduals();
    drawSquares();
    updateStats();

    // Update handle aria values
    if (frame) {
        const annotations = d3Selection.select(frame.inner).select('.annotations');
        annotations.select('[data-handle="left"]')
            .attr('aria-valuenow', handleLeftY.toFixed(1));
        annotations.select('[data-handle="right"]')
            .attr('aria-valuenow', handleRightY.toFixed(1));
    }

    // Debounced screen reader announcement
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
        const { sse } = computeResiduals(...Object.values(userLineParams()));
        announce(`Your SSE: ${formatStat(sse, dataPrecision)}`);
    }, ANNOUNCE_DEBOUNCE);
}

// ─── Stats Display ──────────────────────────────────────────────────────────

function updateStats() {
    const { slope, intercept } = userLineParams();
    const { residuals, sse, sae } = computeResiduals(slope, intercept);
    const d = dataPrecision;

    // Your equation
    const b0 = formatStat(intercept, d);
    const b1 = formatStat(slope, d);
    const sign = slope >= 0 ? ' + ' : ' ';
    yourEqText.textContent = `ŷ = ${b0}${sign}${b1} · x`;

    // LS equation
    if (showLsCheck.checked && lsResult) {
        const lsB0 = formatStat(lsResult.intercept, d);
        const lsB1 = formatStat(lsResult.slope, d);
        const lsSign = lsResult.slope >= 0 ? ' + ' : ' ';
        lsEqText.textContent = `ŷ = ${lsB0}${lsSign}${lsB1} · x`;
        lsEqBlock.hidden = false;
    } else {
        lsEqBlock.hidden = true;
    }

    // Build stats cards
    let html = '';

    // Always show slope and intercept separately (for exercise copying)
    html += `
        <div class="stats-grid">
            <div class="stat-card yours">
                <div class="stat-label">Your Slope</div>
                <div class="stat-value">${formatStat(slope, d)}</div>
            </div>
            <div class="stat-card yours">
                <div class="stat-label">Your Intercept</div>
                <div class="stat-value">${formatStat(intercept, d)}</div>
            </div>`;

    if (showLsCheck.checked && lsResult) {
        html += `
            <div class="stat-card ls">
                <div class="stat-label">LS Slope</div>
                <div class="stat-value">${formatStat(lsResult.slope, d)}</div>
            </div>
            <div class="stat-card ls">
                <div class="stat-label">LS Intercept</div>
                <div class="stat-value">${formatStat(lsResult.intercept, d)}</div>
            </div>`;
    }

    html += `</div>`;

    // SAE (when residuals visible)
    if (showResidualsCheck.checked) {
        html += `
        <div class="stats-grid" style="margin-top:0.4rem;">
            <div class="stat-card yours" style="grid-column: 1 / -1;">
                <div class="stat-label">Sum of Absolute Errors (SAE)</div>
                <div class="stat-value">${formatStat(sae, d)}</div>
            </div>
        </div>`;
    }

    // SSE (when squares visible)
    if (showSquaresCheck.checked) {
        const lsSse = lsResult ? lsResult.residuals.reduce((s, e) => s + e * e, 0) : 0;
        html += `
        <div class="stats-grid" style="margin-top:0.4rem;">
            <div class="stat-card yours">
                <div class="stat-label">Your SSE</div>
                <div class="stat-value">${formatStat(sse, d)}</div>
            </div>`;
        if (showLsCheck.checked && lsResult) {
            html += `
            <div class="stat-card ls${sse <= lsSse * 1.01 ? ' winner' : ''}">
                <div class="stat-label">LS SSE</div>
                <div class="stat-value">${formatStat(lsSse, d)}</div>
            </div>`;
        }
        html += `</div>`;

        // SSE comparison text
        if (showLsCheck.checked && lsResult && lsSse > 0) {
            const pctHigher = ((sse - lsSse) / lsSse * 100);
            if (pctHigher <= 1) {
                sseComparison.innerHTML = `<strong>Excellent!</strong> Your line is very close to the least-squares line.`;
            } else {
                sseComparison.innerHTML = `Your SSE is <strong>${formatStat(pctHigher, 1)}% higher</strong> than the LS line.`;
            }
            sseComparison.hidden = false;
        } else {
            sseComparison.hidden = true;
        }
    } else {
        sseComparison.hidden = true;
    }

    statsArea.innerHTML = html;
}

// ─── Data Loading ───────────────────────────────────────────────────────────

/**
 * @param {{headers:string[], types:string[], data:Array<Record<string,any>>}} parsed
 * @param {string} sourceName
 */
function loadParsedData(parsed, sourceName) {
    const numericHeaders = parsed.headers.filter((h, i) => parsed.types[i] === 'numeric');
    if (numericHeaders.length < 2) {
        announce('Need at least two numeric columns.');
        return;
    }

    currentRows = parsed.data.map(row => {
        /** @type {Record<string,any>} */
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
    announce(`${sourceName}: ${currentRows.length} observations.`);
    loadSelectedVars();
}

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

    if (numericColumns.length >= 2) {
        xVarSelect.value = numericColumns[0];
        yVarSelect.value = numericColumns[1];
    }

    xVar = xVarSelect.value;
    yVar = yVarSelect.value;
    varPanel.hidden = false;
}

/** Extract clean numeric arrays and render. */
function loadSelectedVars() {
    xVar = xVarSelect.value;
    yVar = yVarSelect.value;

    if (!xVar || !yVar || xVar === yVar) {
        chartContainer.innerHTML = '';
        sidebar.hidden = true;
        if (xVar === yVar && xVar) announce('X and Y variables must be different.');
        return;
    }

    xData = [];
    yData = [];
    for (const row of currentRows) {
        const x = Number(row[xVar]);
        const y = Number(row[yVar]);
        if (isFinite(x) && isFinite(y)) {
            xData.push(x);
            yData.push(y);
        }
    }

    // Reset checkboxes for fresh data
    showResidualsCheck.checked = false;
    showSquaresCheck.checked = false;
    showLsCheck.checked = false;

    renderChart();
}

// ─── Event Listeners ────────────────────────────────────────────────────────

showResidualsCheck.addEventListener('change', () => {
    drawResiduals();
    updateStats();
});

showSquaresCheck.addEventListener('change', () => {
    drawSquares();
    updateStats();
});

showLsCheck.addEventListener('change', () => {
    drawLsLine();
    updateStats();
});

xVarSelect.addEventListener('change', loadSelectedVars);
yVarSelect.addEventListener('change', loadSelectedVars);

tryAgainBtn.addEventListener('click', () => {
    showLsCheck.checked = false;
    randomizeLine();
    drawUserLine();
    drawResiduals();
    drawSquares();
    drawLsLine();
    drawHandles();
    updateStats();
    announce('Line reset. Try to minimize the sum of squared errors.');
});

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.metaKey) {
            tryAgainBtn.click();
        }
    }
});

// ─── Init ───────────────────────────────────────────────────────────────────

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

        populateVarSelectors();
        dataSummary.textContent = `${currentRows.length} observations, ${numericColumns.length} numeric variables`;
        announce(`${ds.name}: ${currentRows.length} observations.`);
        loadSelectedVars();
    },
    onText: loadParsedData,
    onClear: () => {
        currentRows = [];
        numericColumns = [];
        xData = [];
        yData = [];
        chartContainer.innerHTML = '';
        sidebar.hidden = true;
        varPanel.hidden = true;
    },
});
