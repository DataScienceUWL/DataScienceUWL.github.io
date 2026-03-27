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
import { announce, initTabs, initDataPanel, initHelp, setPageTitle } from '../../js/page-utils.js';
import { parseParams } from '../../js/url-params.js';
import { createRng, randNormal, randInt } from '../../js/prng.js';

initHelp();
const baseTitle = document.title.replace(/\s*\|\s*StatLens$/, '');

// ─── URL Parameters ─────────────────────────────────────────────────────────

const urlParams = parseParams();
const searchParams = new URLSearchParams(location.search);

/** Exercise mode — hides the best-fit line checkbox. */
const exerciseMode = searchParams.get('exercise') === 'true';

/** Embed mode — hides page chrome for iframe embedding. */
const embedMode = searchParams.get('embed') === 'true';

/** Readonly mode — disables dragging for post-grading review. */
const readonlyMode = searchParams.get('readonly') === 'true';

/** Metric mode override from URL. */
const urlMetric = searchParams.get('metric');

/** Controls to show on load (comma-separated: residuals,bestfit). */
const urlShow = (searchParams.get('show') || '').split(',').map(s => s.trim()).filter(Boolean);

/** Controls to hide (comma-separated: toggle,bestfit,residuals). */
const urlHide = (searchParams.get('hide') || '').split(',').map(s => s.trim()).filter(Boolean);

/** Sample size for random data generation. */
const urlN = urlParams.n || null;

/** True slope for random data generation. */
const urlSlope = urlParams.slope ?? null;

/** True intercept for random data generation. */
const urlIntercept = urlParams.intercept ?? null;

/** Noise level (0-1) for random data generation. */
const urlNoise = urlParams.sigma_error ?? null;

/** Seeded PRNG — used for deterministic random data when ?seed= is provided. */
const seededRng = urlParams.seed ? createRng(urlParams.seed) : null;

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

/** Whether this is a touch-capable device. */
const IS_TOUCH = matchMedia('(pointer: coarse)').matches;

/** Width of the invisible hit area for the draggable line (viewBox units). */
const LINE_HIT_WIDTH = IS_TOUCH ? 36 : 16;

/** Endpoint indicators (viewBox units) — larger on touch for 44px-equivalent targets. */
const ENDPOINT_RADIUS = IS_TOUCH ? 12 : 5;

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

/** Cached LAD (L1) regression result. */
/** @type {{ slope: number, intercept: number, sae: number } | null} */
let ladResult = null;

/** Current D3 scales and frame (set by renderChart). */
/** @type {d3Scale.ScaleLinear<number,number> | null} */ let xScale = null;
/** @type {d3Scale.ScaleLinear<number,number> | null} */ let yScale = null;
/** @type {import('../../js/types.js').ChartFrame | null} */ let frame = null;

/** Timer for debounced announcements. */
let announceTimer = 0;

/** Grab position during drag (0 = left end, 1 = right end). */
let grabT = 0.5;

// ─── DOM Refs ───────────────────────────────────────────────────────────────

const varPanel = /** @type {HTMLDivElement} */ (document.getElementById('var-panel'));
const xVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('x-var'));
const yVarSelect = /** @type {HTMLSelectElement} */ (document.getElementById('y-var'));
const dataSummary = /** @type {HTMLOutputElement} */ (document.getElementById('data-summary'));
const chartContainer = /** @type {HTMLDivElement} */ (document.getElementById('chart-container'));
const sidebar = /** @type {HTMLDivElement} */ (document.getElementById('sidebar'));

const showResidualsCheck = /** @type {HTMLInputElement} */ (document.getElementById('show-residuals'));
const showSquaresCheck = /** @type {HTMLInputElement} */ (document.getElementById('show-squares'));
const showSquaresLabel = /** @type {HTMLElement} */ (document.getElementById('show-squares-label'));
const showLsCheck = /** @type {HTMLInputElement} */ (document.getElementById('show-ls'));
const showLsLabel = /** @type {HTMLLabelElement} */ (document.getElementById('show-ls-label'));
const toggleAbsoluteBtn = /** @type {HTMLButtonElement} */ (document.getElementById('toggle-absolute'));
const toggleSquaredBtn = /** @type {HTMLButtonElement} */ (document.getElementById('toggle-squared'));

/** @type {'absolute' | 'squared'} */
let residualMode = 'squared';

const sseComparison = /** @type {HTMLDivElement} */ (document.getElementById('sse-comparison'));
const tryAgainBtn = /** @type {HTMLButtonElement} */ (document.getElementById('try-again-btn'));
const generateRandomBtn = /** @type {HTMLButtonElement} */ (document.getElementById('generate-random-btn'));

// ─── URL-driven mode setup ──────────────────────────────────────────────────

// Exercise mode: hide the best-fit line checkbox
if (exerciseMode || urlHide.includes('bestfit')) {
    showLsLabel.hidden = true;
}

// Hide toggle control
if (urlHide.includes('toggle')) {
    /** @type {HTMLElement} */ (document.querySelector('.residual-toggle-row')).hidden = true;
}

// Hide residuals checkbox
if (urlHide.includes('residuals')) {
    /** @type {HTMLElement} */ (showResidualsCheck.closest('label')).hidden = true;
}

// Hide squares checkbox
if (urlHide.includes('squares')) {
    showSquaresLabel.hidden = true;
}

// Metric mode from URL (overrides default)
if (urlMetric === 'absolute' || urlMetric === 'squared') {
    residualMode = urlMetric;
    setToggleState();
}

// Embed mode: hide page chrome for iframe embedding
if (embedMode) {
    document.body.setAttribute('data-embed', 'true');
}

// Readonly mode: disable Try Again button
if (readonlyMode) {
    tryAgainBtn.disabled = true;
    generateRandomBtn.disabled = true;
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
 * Compute the Least Absolute Deviations (L1) regression line.
 * The optimal LAD line passes through at least two data points.
 * For n ≤ 50, check all pairs; for larger n, sample random pairs.
 * @param {number[]} xs
 * @param {number[]} ys
 * @returns {{ slope: number, intercept: number, sae: number }}
 */
function ladRegression(xs, ys) {
    const n = xs.length;
    if (n < 2) return { slope: 0, intercept: 0, sae: 0 };

    let bestSlope = 0;
    let bestIntercept = 0;
    let bestSae = Infinity;

    /**
     * @param {number} i
     * @param {number} j
     */
    function tryPair(i, j) {
        const dx = xs[j] - xs[i];
        if (Math.abs(dx) < 1e-12) return;
        const slope = (ys[j] - ys[i]) / dx;
        const intercept = ys[i] - slope * xs[i];
        let sae = 0;
        for (let k = 0; k < n; k++) {
            sae += Math.abs(ys[k] - (intercept + slope * xs[k]));
        }
        if (sae < bestSae) {
            bestSae = sae;
            bestSlope = slope;
            bestIntercept = intercept;
        }
    }

    if (n <= 50) {
        // Exact: all n(n-1)/2 pairs
        for (let i = 0; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                tryPair(i, j);
            }
        }
    } else {
        // Heuristic: sample 200 random pairs
        for (let k = 0; k < 200; k++) {
            const i = Math.floor(_rng() * n);
            let j;
            do { j = Math.floor(_rng() * n); } while (j === i);
            tryPair(i, j);
        }
    }

    return { slope: bestSlope, intercept: bestIntercept, sae: bestSae };
}

/**
 * Get the next random float in [0, 1).
 * Uses seeded PRNG if ?seed= is provided, otherwise Math.random().
 */
function _rng() {
    return seededRng ? seededRng() : Math.random();
}

/**
 * Get a normal random variate (mean=0, sd=1).
 * Uses seeded PRNG if available.
 */
function _randNormal() {
    return seededRng ? randNormal(0, 1, seededRng) : (() => {
        let u;
        do { u = Math.random(); } while (u === 0);
        const v = Math.random();
        return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    })();
}

/**
 * Set handle positions to a "reasonable but wrong" starting line.
 * Roughly near the data but tilted/offset enough to need adjustment.
 */
function randomizeLine() {
    if (yData.length < 2 || !yScale) return;
    const yMean = sum(yData) / yData.length;
    const yRange = (d3Array.max(yData) ?? 0) - (d3Array.min(yData) ?? 0);
    const offset = (_rng() - 0.5) * yRange * 0.4;
    const tilt = (_rng() - 0.5) * yRange * 0.3;
    handleLeftY = yMean + offset - tilt;
    handleRightY = yMean + offset + tilt;
}

/**
 * Generate a random XY dataset with a linear trend + noise.
 * When ?seed= is provided, output is fully deterministic.
 * URL params ?n=, ?slope=, ?intercept=, ?sigma_error= control the generating model.
 * @param {number} [n] - Number of points (default: URL param or random 15-25)
 */
function generateRandomData(n) {
    const count = n || urlN || Math.floor(_rng() * 11) + 15; // 15-25
    // Random parameters for the generating model (overridable via URL)
    const xMin = Math.floor(_rng() * 20);                                // 0-19
    const xRange = Math.floor(_rng() * 30) + 10;                         // 10-39
    const trueSlope = urlSlope ?? (_rng() - 0.3) * 4;                    // slight bias toward positive
    const trueIntercept = urlIntercept ?? Math.floor(_rng() * 40) + 10;
    // Noise level controls r: low noise → high r, high noise → low r
    const noiseFrac = urlNoise ?? _rng() * 0.6 + 0.1;                    // 0.1-0.7
    const yPredRange = Math.abs(trueSlope) * xRange || 10;
    const noiseSD = yPredRange * noiseFrac;

    /** @type {number[]} */ const xs = [];
    /** @type {number[]} */ const ys = [];
    for (let i = 0; i < count; i++) {
        const x = xMin + _rng() * xRange;
        const y = trueIntercept + trueSlope * x + _randNormal() * noiseSD;
        // Round to 1 decimal for clean display
        xs.push(Math.round(x * 10) / 10);
        ys.push(Math.round(y * 10) / 10);
    }

    xData = xs;
    yData = ys;
    xVar = 'x';
    yVar = 'y';

    // Update UI — hide var selectors, clear data panel state
    varPanel.hidden = true;
    dataSummary.textContent = `${count} random observations`;

    // Reset controls (respect URL overrides)
    showResidualsCheck.checked = urlShow.includes('residuals');
    showSquaresCheck.checked = urlShow.includes('squares');
    showLsCheck.checked = urlShow.includes('bestfit') && !exerciseMode && !urlHide.includes('bestfit');
    if (!urlMetric) {
        residualMode = 'squared';
        setToggleState();
    }
    syncSquaresVisibility();

    renderChart();
    announce(`Random dataset: ${count} observations.`);
}

// ─── Chart Rendering ────────────────────────────────────────────────────────

function renderChart() {
    if (xData.length < 2) {
        chartContainer.innerHTML = '<p class="placeholder">Need at least 2 valid data points.</p>';
        sidebar.hidden = true;
        return;
    }

    // Compute LS and LAD regression
    lsResult = linreg(xData, yData);
    ladResult = ladRegression(xData, yData);
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
    drawResidualLayer();
    drawSquaresLayer();
    drawBestFitLine();
    setupLineDrag();
    updateMetricOverlay();

    // Update sidebar
    sidebar.hidden = false;
    updateStats();

    // Show touch hint on touch devices
    const touchHint = /** @type {HTMLElement|null} */ (document.querySelector('.touch-hint'));
    if (touchHint && IS_TOUCH) touchHint.hidden = false;
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

    // Endpoint indicators
    overlays.append('circle')
        .attr('class', 'user-endpoint user-endpoint-left')
        .attr('cx', xScale(x0))
        .attr('cy', yScale(handleLeftY))
        .attr('r', ENDPOINT_RADIUS)
        .attr('fill', USER_COLOR)
        .attr('stroke', '#fff')
        .attr('stroke-width', IS_TOUCH ? 2 : 1.5)
        .style('pointer-events', 'none');

    overlays.append('circle')
        .attr('class', 'user-endpoint user-endpoint-right')
        .attr('cx', xScale(x1))
        .attr('cy', yScale(handleRightY))
        .attr('r', ENDPOINT_RADIUS)
        .attr('fill', USER_COLOR)
        .attr('stroke', '#fff')
        .attr('stroke-width', IS_TOUCH ? 2 : 1.5)
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
    annotations.selectAll('.line-hit-area, .line-drag-focus, .endpoint-handle').remove();

    const [x0, x1] = xScale.domain();
    const svgEl = /** @type {SVGSVGElement} */ (d3Selection.select(frame.inner).node()?.closest?.('svg'));

    // Readonly mode — no dragging
    if (readonlyMode) return;

    /** Prevent page scroll while dragging the line on touch devices. */
    function preventScroll(/** @type {boolean} */ active) {
        if (svgEl) svgEl.style.touchAction = active ? 'none' : 'pan-x';
    }

    const drag = d3Drag.drag()
        .on('start', function (event) {
            preventScroll(true);
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
        })
        .on('end', function () {
            preventScroll(false);
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

    // On touch devices, add visible draggable endpoint handles for easier manipulation
    if (IS_TOUCH) {
        const endpointDrag = (/** @type {'left'|'right'} */ side) => d3Drag.drag()
            .on('start', function () { preventScroll(true); })
            .on('drag', function (event) {
                if (!yScale) return;
                const dy = /** @type {Function} */ (yScale).invert(event.y) -
                           /** @type {Function} */ (yScale).invert(event.y - event.dy);
                if (side === 'left') handleLeftY += dy;
                else handleRightY += dy;
                updateFromDrag();
                // Also update this handle's position
                d3Selection.select(this).attr('cy', /** @type {Function} */ (yScale)(side === 'left' ? handleLeftY : handleRightY));
                // Update the other endpoint handle too
                const other = annotations.select(side === 'left' ? '.endpoint-handle-right' : '.endpoint-handle-left');
                other.attr('cy', /** @type {Function} */ (yScale)(side === 'left' ? handleRightY : handleLeftY));
            })
            .on('end', function () { preventScroll(false); });

        // Left endpoint handle
        annotations.append('circle')
            .attr('class', 'endpoint-handle endpoint-handle-left')
            .attr('cx', xScale(x0))
            .attr('cy', yScale(handleLeftY))
            .attr('r', ENDPOINT_RADIUS + 4)
            .attr('fill', USER_COLOR)
            .attr('fill-opacity', 0.25)
            .attr('stroke', USER_COLOR)
            .attr('stroke-width', 2)
            .style('cursor', 'ns-resize')
            .style('touch-action', 'none')
            .call(/** @type {any} */ (endpointDrag('left')));

        // Right endpoint handle
        annotations.append('circle')
            .attr('class', 'endpoint-handle endpoint-handle-right')
            .attr('cx', xScale(x1))
            .attr('cy', yScale(handleRightY))
            .attr('r', ENDPOINT_RADIUS + 4)
            .attr('fill', USER_COLOR)
            .attr('fill-opacity', 0.25)
            .attr('stroke', USER_COLOR)
            .attr('stroke-width', 2)
            .style('cursor', 'ns-resize')
            .style('touch-action', 'none')
            .call(/** @type {any} */ (endpointDrag('right')));
    }

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
        .attr('aria-label', 'Movable regression line. Use arrow keys to shift up/down, left/right to adjust slope.')
        .attr('aria-valuemin', 0)
        .attr('aria-valuemax', 999999)
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

/** Update the hit area and endpoint handle positions to match the current line. */
function updateHitArea() {
    if (!frame || !xScale || !yScale) return;
    const annotations = d3Selection.select(frame.inner).select('.annotations');

    annotations.select('.line-hit-area')
        .attr('y1', yScale(handleLeftY))
        .attr('y2', yScale(handleRightY));

    // Update touch endpoint handles if present
    annotations.select('.endpoint-handle-left').attr('cy', yScale(handleLeftY));
    annotations.select('.endpoint-handle-right').attr('cy', yScale(handleRightY));
}

/**
 * Draw vertical residual lines from each data point to the user's line.
 * Shown when "Show Residuals" is checked, regardless of metric mode.
 */
function drawResidualLayer() {
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

/**
 * Draw literal squares at each data point whose area = residual².
 * Shown when "Show Squared Residuals" is checked (only available in squared mode).
 */
function drawSquaresLayer() {
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
            const sideY = Math.abs(/** @type {Function} */ (yScale)(d.yHat) - /** @type {Function} */ (yScale)(d.yHat + absRes));

            const px = /** @type {Function} */ (xScale)(d.x);
            const pyPoint = /** @type {Function} */ (yScale)(d.y);
            const pyHat = /** @type {Function} */ (yScale)(d.yHat);
            const top = Math.min(pyPoint, pyHat);

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

/** Draw or update the best-fit line (LS in squared mode, LAD in absolute mode). */
function drawBestFitLine() {
    if (!frame || !xScale || !yScale) return;
    const overlays = d3Selection.select(frame.inner).select('.overlays');
    overlays.selectAll('.ls-line').remove();

    if (!showLsCheck.checked) return;

    const bestFit = residualMode === 'squared' ? lsResult : ladResult;
    if (!bestFit) return;

    const [x0, x1] = xScale.domain();
    overlays.append('line')
        .attr('class', 'ls-line')
        .attr('x1', xScale(x0))
        .attr('y1', yScale(bestFit.intercept + bestFit.slope * x0))
        .attr('x2', xScale(x1))
        .attr('y2', yScale(bestFit.intercept + bestFit.slope * x1))
        .attr('stroke', LS_COLOR)
        .attr('stroke-width', 2)
        .attr('stroke-dasharray', '6,4')
        .style('pointer-events', 'none');
}

/** Fast update during dragging — redraw line, residual layer, hit area, stats. */
function updateFromDrag() {
    drawUserLine();
    updateHitArea();
    drawResidualLayer();
    drawSquaresLayer();
    updateStats();
    updateMetricOverlay();

    // Debounced screen reader announcement
    clearTimeout(announceTimer);
    announceTimer = window.setTimeout(() => {
        const { sse, sae } = computeResiduals(...Object.values(userLineParams()));
        if (residualMode === 'squared') {
            announce(`Sum of Squared Errors: ${formatStat(sse, dataPrecision)}`);
        } else {
            announce(`Sum of Absolute Errors: ${formatStat(sae, dataPrecision)}`);
        }
    }, ANNOUNCE_DEBOUNCE);
}

// ─── Floating Metric Overlay ─────────────────────────────────────────────────

/** Update the floating overlays on the chart (equation + metric + LS info). */
function updateMetricOverlay() {
    // Remove any existing overlays
    chartContainer.querySelectorAll('.chart-overlay').forEach(el => el.remove());

    if (xData.length < 2) return;

    const { slope, intercept } = userLineParams();
    const { sse, sae } = computeResiduals(slope, intercept);
    const d = dataPrecision;
    const isSquared = residualMode === 'squared';

    // Your equation overlay (top-left)
    const b0 = formatStat(intercept, d);
    const b1 = formatStat(slope, d);
    const sign = slope >= 0 ? ' + ' : ' ';
    const eqOverlay = document.createElement('div');
    eqOverlay.className = 'chart-overlay equation-overlay';
    eqOverlay.setAttribute('aria-hidden', 'true');
    eqOverlay.innerHTML = `<div class="overlay-label">Your Line</div>\u0177 = ${b0}${sign}${b1} \u00b7 x`;
    chartContainer.appendChild(eqOverlay);

    // Your metric overlay (top-right)
    const metricLabel = isSquared ? 'SSE' : 'SAE';
    const metricValue = isSquared ? sse : sae;
    const metricOverlay = document.createElement('div');
    metricOverlay.className = 'chart-overlay metric-overlay';
    metricOverlay.setAttribute('aria-hidden', 'true');
    metricOverlay.innerHTML = `<div class="overlay-label">${metricLabel} (yours)</div>${formatStat(metricValue, d)}`;
    chartContainer.appendChild(metricOverlay);

    // LS / best-fit overlays (bottom corners, only when checked)
    const bestFit = isSquared ? lsResult : ladResult;
    if (showLsCheck.checked && bestFit) {
        const bestFitName = isSquared ? 'LS Line' : 'LAD Line';
        const bfB0 = formatStat(bestFit.intercept, d);
        const bfB1 = formatStat(bestFit.slope, d);
        const bfSign = bestFit.slope >= 0 ? ' + ' : ' ';

        const lsEqOverlay = document.createElement('div');
        lsEqOverlay.className = 'chart-overlay ls-overlay';
        lsEqOverlay.setAttribute('aria-hidden', 'true');
        lsEqOverlay.innerHTML = `<div class="overlay-label">${bestFitName}</div>\u0177 = ${bfB0}${bfSign}${bfB1} \u00b7 x`;
        chartContainer.appendChild(lsEqOverlay);

        const bestFitResiduals = computeResiduals(bestFit.slope, bestFit.intercept);
        const lsMetricValue = isSquared ? bestFitResiduals.sse : bestFitResiduals.sae;
        const lsMetricOverlay = document.createElement('div');
        lsMetricOverlay.className = 'chart-overlay ls-metric-overlay';
        lsMetricOverlay.setAttribute('aria-hidden', 'true');
        lsMetricOverlay.innerHTML = `<div class="overlay-label">${metricLabel} (${bestFitName.toLowerCase()})</div>${formatStat(lsMetricValue, d)}`;
        chartContainer.appendChild(lsMetricOverlay);
    }
}

/** Sync toggle button aria-pressed states with residualMode. */
function setToggleState() {
    toggleAbsoluteBtn.setAttribute('aria-pressed', residualMode === 'absolute' ? 'true' : 'false');
    toggleSquaredBtn.setAttribute('aria-pressed', residualMode === 'squared' ? 'true' : 'false');
}

/** Show/hide the "Show Squares" checkbox based on metric mode. */
function syncSquaresVisibility() {
    if (residualMode === 'absolute') {
        showSquaresLabel.hidden = true;
        showSquaresCheck.checked = false;
    } else {
        showSquaresLabel.hidden = false;
    }
}

// ─── Stats Display ──────────────────────────────────────────────────────────

/** Update the sidebar comparison text (the overlays handle equation/metric display). */
function updateStats() {
    const { slope, intercept } = userLineParams();
    const { sse, sae } = computeResiduals(slope, intercept);
    const isSquared = residualMode === 'squared';
    const bestFitName = isSquared ? 'least squares line' : 'best-fit line';
    const metricLabel = isSquared ? 'SSE' : 'SAE';
    const bestFit = isSquared ? lsResult : ladResult;

    if (showLsCheck.checked && bestFit) {
        const bestFitResiduals = computeResiduals(bestFit.slope, bestFit.intercept);
        const metricValue = isSquared ? sse : sae;
        const lsMetricValue = isSquared ? bestFitResiduals.sse : bestFitResiduals.sae;

        if (lsMetricValue > 0) {
            const pctHigher = ((metricValue - lsMetricValue) / lsMetricValue * 100);
            if (pctHigher <= 1) {
                sseComparison.innerHTML = `<strong>Excellent!</strong> Your line is very close to the ${bestFitName}.`;
            } else {
                sseComparison.innerHTML = `Your ${metricLabel} is <strong>${formatStat(pctHigher, 1)}% higher</strong> than the ${bestFitName}.`;
            }
            sseComparison.hidden = false;
        } else {
            sseComparison.hidden = true;
        }
    } else {
        sseComparison.hidden = true;
    }
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
    setPageTitle(baseTitle, sourceName, { n: currentRows.length });
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

    // URL param variable pre-selection (?x= and ?y=)
    if (urlParams.x && numericColumns.includes(urlParams.x)) {
        xVarSelect.value = urlParams.x;
    }
    if (urlParams.y && numericColumns.includes(urlParams.y)) {
        yVarSelect.value = urlParams.y;
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

    // Reset controls for fresh data (respect URL overrides)
    showResidualsCheck.checked = urlShow.includes('residuals');
    showLsCheck.checked = urlShow.includes('bestfit') && !exerciseMode && !urlHide.includes('bestfit');
    if (!urlMetric) {
        residualMode = 'squared';
        setToggleState();
    }

    renderChart();
}

// ─── Event Listeners ────────────────────────────────────────────────────────

showResidualsCheck.addEventListener('change', () => {
    drawResidualLayer();
    updateStats();
    updateMetricOverlay();
});

showSquaresCheck.addEventListener('change', () => {
    drawSquaresLayer();
    updateStats();
    updateMetricOverlay();
});

toggleAbsoluteBtn.addEventListener('click', () => {
    residualMode = 'absolute';
    setToggleState();
    syncSquaresVisibility();
    drawResidualLayer();
    drawSquaresLayer();
    drawBestFitLine();
    updateStats();
    updateMetricOverlay();
});

toggleSquaredBtn.addEventListener('click', () => {
    residualMode = 'squared';
    setToggleState();
    syncSquaresVisibility();
    drawResidualLayer();
    drawSquaresLayer();
    drawBestFitLine();
    updateStats();
    updateMetricOverlay();
});

showLsCheck.addEventListener('change', () => {
    drawBestFitLine();
    updateStats();
    updateMetricOverlay();
});

xVarSelect.addEventListener('change', loadSelectedVars);
yVarSelect.addEventListener('change', loadSelectedVars);

tryAgainBtn.addEventListener('click', () => {
    showLsCheck.checked = false;
    randomizeLine();
    drawUserLine();
    updateHitArea();
    drawResidualLayer();
    drawSquaresLayer();
    drawBestFitLine();
    updateStats();
    updateMetricOverlay();
    announce('Line reset. Try to minimize the errors.');
});

generateRandomBtn.addEventListener('click', () => {
    generateRandomData();
});

// Global keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'r' || e.key === 'R') {
        if (!e.ctrlKey && !e.metaKey) {
            tryAgainBtn.click();
        }
    }
    if (e.key === 'n' || e.key === 'N') {
        if (!e.ctrlKey && !e.metaKey) {
            generateRandomData();
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

// Auto-generate random data on page load so the tool is immediately usable
generateRandomData();
