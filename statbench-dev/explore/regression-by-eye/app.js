// @ts-check
/**
 * Regression by Eye — drag a line to fit the data, see residual squares,
 * compare to the least-squares regression line.
 *
 * Interaction: grab the line anywhere. Where you grab determines behavior:
 * - Near an end → pivots around the opposite end
 * - Near the middle → parallel shift (translate up/down)
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
const POINT_FILL = '#569BBD99';
const POINT_STROKE = '#569BBD';

/** Extra vertical padding factor (fraction of data range) for line manipulation room. */
const Y_PAD_FACTOR = 0.25;

/** Width of the invisible hit area for the draggable line (viewBox units). */
const LINE_HIT_WIDTH = 16;

/** Small endpoint indicators (viewBox units). */
const ENDPOINT_RADIUS = 5;

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

/** Student's line defined by y-values at the left and right edges of the x-domain. */
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

/** Grab position during drag (0 = left end, 1 = right end). */
let grabT = 0.5;

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
 * Roughly near the data but tilted/offset enough to need adjustment.
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
        descText: `Interactive scatterplot. Drag the green line to fit the data.`,
        id: 'rbe-chart',
    });

    // Scales — extra vertical padding so the line can be dragged above/below data
    const xExtent = /** @type {[number,number]} */ (d3Array.extent(xData));
    const yExtent = /** @type {[number,number]} */ (d3Array.extent(yData));
    const xPad = (xExtent[1] - xExtent[0]) * 0.05 || 0.5;
    const yDataRange = yExtent[1] - yExtent[0] || 1;
    const yPad = yDataRange * Y_PAD_FACTOR;

    // Also account for where the LS line intercept falls — extend to include it
    const lsYAtXMin = lsResult.intercept + lsResult.slope * (xExtent[0] - xPad);
    const lsYAtXMax = lsResult.intercept + lsResult.slope * (xExtent[1] + xPad);
    const yLo = Math.min(yExtent[0], lsYAtXMin, lsYAtXMax) - yPad;
    const yHi = Math.max(yExtent[1], lsYAtXMin, lsYAtXMax) + yPad;

    xScale = d3Scale.scaleLinear()
        .domain([xExtent[0] - xPad, xExtent[1] + xPad])
        .range([0, frame.width]);

    yScale = d3Scale.scaleLinear()
        .domain([yLo, yHi])
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

    // Initialize student line
    randomizeLine();

    // Draw interactive layers
    drawUserLine();
    drawResiduals();
    drawSquares();
    drawLsLine();
    setupLineDrag();

    // Update sidebar
    sidebar.hidden = false;
    updateStats();
}

/** Draw or update the student's line + endpoint indicators. */
function drawUserLine() {
    if (!frame || !xScale || !yScale) return;
    const overlays = d3Selection.select(frame.inner).select('.overlays');
    const [x0, x1] = xScale.domain();

    // Remove old line elements (keep the hit area)
    overlays.selectAll('.user-line, .user-endpoint').remove();

    // Visible line
    overlays.append('line')
        .attr('class', 'user-line')
        .attr('x1', xScale(x0))
        .attr('y1', yScale(handleLeftY))
        .attr('x2', xScale(x1))
        .attr('y2', yScale(handleRightY))
        .attr('stroke', USER_COLOR)
        .attr('stroke-width', 2.5)
        .style('pointer-events', 'none');

    // Small endpoint indicators
    overlays.append('circle')
        .attr('class', 'user-endpoint')
        .attr('cx', xScale(x0))
        .attr('cy', yScale(handleLeftY))
        .attr('r', ENDPOINT_RADIUS)
        .attr('fill', USER_COLOR)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .style('pointer-events', 'none');

    overlays.append('circle')
        .attr('class', 'user-endpoint')
        .attr('cx', xScale(x1))
        .attr('cy', yScale(handleRightY))
        .attr('r', ENDPOINT_RADIUS)
        .attr('fill', USER_COLOR)
        .attr('stroke', '#fff')
        .attr('stroke-width', 1.5)
        .style('pointer-events', 'none');
}

/**
 * Set up the invisible hit area for line dragging.
 * Where you grab determines the behavior:
 * - Near left end (t ≈ 0) → mostly moves left handle (pivots around right)
 * - Near right end (t ≈ 1) → mostly moves right handle (pivots around left)
 * - Near middle (t ≈ 0.5) → parallel shift (both handles move equally)
 */
function setupLineDrag() {
    if (!frame || !xScale || !yScale) return;
    const annotations = d3Selection.select(frame.inner).select('.annotations');
    annotations.selectAll('.line-hit-area, .line-drag-focus').remove();

    const [x0, x1] = xScale.domain();

    const drag = d3Drag.drag()
        .on('start', function (event) {
            // Determine where along the line the user grabbed (0 = left, 1 = right)
            const px = event.x;
            const px0 = /** @type {Function} */ (xScale)(x0);
            const px1 = /** @type {Function} */ (xScale)(x1);
            grabT = Math.max(0, Math.min(1, (px - px0) / (px1 - px0)));
        })
        .on('drag', function (event) {
            if (!yScale || !frame) return;
            // Convert pixel dy to data dy
            const dy = /** @type {Function} */ (yScale).invert(event.y) -
                       /** @type {Function} */ (yScale).invert(event.y - event.dy);

            // Weight: how much each handle moves based on grab position
            // grabT=0 → left moves fully, right stays; grabT=1 → opposite
            // grabT=0.5 → both move equally (parallel shift)
            const leftWeight = 1 - grabT;   // 1.0 at left end, 0.0 at right end
            const rightWeight = grabT;       // 0.0 at left end, 1.0 at right end

            handleLeftY += dy * leftWeight;
            handleRightY += dy * rightWeight;

            updateFromDrag();
        });

    // Invisible wide hit area for easy grabbing
    annotations.append('line')
        .attr('class', 'line-hit-area')
        .attr('x1', xScale(x0))
        .attr('y1', yScale(handleLeftY))
        .attr('x2', xScale(x1))
        .attr('y2', yScale(handleRightY))
        .attr('stroke', 'transparent')
        .attr('stroke-width', LINE_HIT_WIDTH)
        .style('cursor', 'grab')
        .style('touch-action', 'none')
        .call(/** @type {any} */ (drag))
        .on('mousedown.cursor', function () {
            d3Selection.select(this).style('cursor', 'grabbing');
        })
        .on('mouseup.cursor', function () {
            d3Selection.select(this).style('cursor', 'grab');
        });

    // Focusable element for keyboard control
    annotations.append('rect')
        .attr('class', 'line-drag-focus')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', frame.width)
        .attr('height', frame.height)
        .attr('fill', 'none')
        .attr('stroke', 'none')
        .attr('tabindex', 0)
        .attr('role', 'slider')
        .attr('aria-label', 'Movable regression line. Use arrow keys to adjust.')
        .attr('aria-valuenow', () => {
            const { sse } = computeResiduals(...Object.values(userLineParams()));
            return sse.toFixed(1);
        })
        .style('outline', 'none')
        .on('focus', function () {
            // Show a subtle outline around chart when focused
            d3Selection.select(this).attr('stroke', USER_COLOR).attr('stroke-width', 1.5).attr('stroke-dasharray', '4,3');
        })
        .on('blur', function () {
            d3Selection.select(this).attr('stroke', 'none');
        })
        .on('keydown', function (event) {
            if (!yScale) return;
            const [yMin, yMax] = yScale.domain();
            const yRange = yMax - yMin;
            const step = event.shiftKey ? yRange * 0.05 : yRange * 0.01;

            if (event.key === 'ArrowUp') {
                event.preventDefault();
                // Parallel shift up
                handleLeftY += step;
                handleRightY += step;
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                // Parallel shift down
                handleLeftY -= step;
                handleRightY -= step;
            } else if (event.key === 'ArrowRight') {
                event.preventDefault();
                // Increase slope (tilt clockwise)
                handleLeftY -= step * 0.5;
                handleRightY += step * 0.5;
            } else if (event.key === 'ArrowLeft') {
                event.preventDefault();
                // Decrease slope (tilt counter-clockwise)
                handleLeftY += step * 0.5;
                handleRightY -= step * 0.5;
            } else {
                return;
            }

            updateFromDrag();
        });
}

/** Update the hit area position to match the current line. */
function updateHitArea() {
    if (!frame || !xScale || !yScale) return;
    const annotations = d3Selection.select(frame.inner).select('.annotations');
    const [x0, x1] = xScale.domain();

    annotations.select('.line-hit-area')
        .attr('y1', yScale(handleLeftY))
        .attr('y2', yScale(handleRightY));
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

            // Square side in pixels — use the y-scale to get a consistent square
            // (same number of data units on both axes, rendered as pixels)
            const sideY = Math.abs(/** @type {Function} */ (yScale)(d.yHat) - /** @type {Function} */ (yScale)(d.yHat + absRes));

            const px = /** @type {Function} */ (xScale)(d.x);
            const pyPoint = /** @type {Function} */ (yScale)(d.y);
            const pyHat = /** @type {Function} */ (yScale)(d.yHat);
            const top = Math.min(pyPoint, pyHat);

            // Square extends to the right from the data point, height = residual
            el.attr('x', px)
                .attr('y', top)
                .attr('width', sideY)
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

/** Fast update during dragging — redraw line, residuals, squares, hit area, stats. */
function updateFromDrag() {
    drawUserLine();
    updateHitArea();
    drawResiduals();
    drawSquares();
    updateStats();

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
    const lsSse = lsResult ? lsResult.residuals.reduce((s, e) => s + e * e, 0) : 0;
    let html = '';

    // SSE — always visible (the core metric for this tool)
    html += `
    <div class="stats-grid">
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

    // SAE (when residuals visible — ties to the residual lines visually)
    if (showResidualsCheck.checked) {
        html += `
        <div class="stats-grid" style="margin-top:0.4rem;">
            <div class="stat-card yours" style="grid-column: 1 / -1;">
                <div class="stat-label">Sum of Absolute Errors (SAE)</div>
                <div class="stat-value">${formatStat(sae, d)}</div>
            </div>
        </div>`;
    }

    // SSE comparison text (when LS line visible)
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
    updateHitArea();
    drawResiduals();
    drawSquares();
    drawLsLine();
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
