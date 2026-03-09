// @ts-check
/**
 * Shared distribution calculator page logic with interactive chart.
 *
 * Each distribution page (normal, t, chi-sq, F) imports and calls
 * initDistCalculator() with its specific configuration.
 *
 * Interactive features:
 * - Draggable boundary lines (grab the dashed line and drag horizontally)
 * - Click-to-edit value labels on the chart (click the critical value to type a new one)
 * - Probability labels rendered inside shaded regions
 * - Bidirectional sync: chart interactions update form inputs and vice versa
 */

import { parseParams } from './url-params.js';
import { drawCurve, computeDomain } from './curve.js';
import { debounce } from './chart-utils.js';
import { enableHorizontalDrag, showInlineEdit, formatEditValue } from './chart-interactions.js';
import * as d3Selection from 'd3-selection';

/**
 * @typedef {object} DistConfig
 * @property {string} name - Display name (e.g., "Normal")
 * @property {'normal'|'t'|'chisq'|'F'} type - Distribution type
 * @property {Array<{id: string, label: string, paramKey: string, defaultValue: number, min?: number, step?: string}>} params
 * @property {(params: Record<string, number>) => (x: number) => number} pdfFactory
 * @property {(params: Record<string, number>) => (x: number) => number} cdfFactory
 * @property {(params: Record<string, number>) => (p: number) => number} invFactory
 * @property {(params: Record<string, number>) => object} domainParams
 * @property {string} xSymbol - Symbol for x-axis (e.g., "x", "z", "t", "chi-sq", "F")
 */

/**
 * Initialize a distribution calculator page with interactive chart.
 * @param {DistConfig} config
 */
export function initDistCalculator(config) {
  const urlParams = parseParams(window.location.search);

  // --- DOM references ---
  const paramInputs = {};
  for (const p of config.params) {
    const el = /** @type {HTMLInputElement} */ (document.getElementById(p.id));
    if (!el) continue;
    const urlVal = urlParams[p.paramKey];
    if (urlVal != null) el.value = String(urlVal);
    paramInputs[p.paramKey] = el;
  }

  const tailRadios = /** @type {NodeListOf<HTMLInputElement>} */ (
    document.querySelectorAll('input[name="tail"]'));
  const inputX = /** @type {HTMLInputElement} */ (document.getElementById('input-x'));
  const inputP = /** @type {HTMLInputElement} */ (document.getElementById('input-p'));
  const resultDiv = document.getElementById('result-summary');
  const announceDiv = document.getElementById('sr-announce');
  const chartContainer = document.getElementById('chart-container');

  if (urlParams.tail) {
    for (const r of tailRadios) {
      r.checked = r.value === urlParams.tail;
    }
  }

  // --- State ---
  /** @type {ReturnType<typeof drawCurve>|null} */
  let curveState = null;
  /** Current CDF function */
  let currentCdf = null;
  /** Current inverse CDF function */
  let currentInv = null;

  // --- Helpers ---
  function getDistParams() {
    const params = {};
    for (const p of config.params) {
      params[p.paramKey] = parseFloat(paramInputs[p.paramKey]?.value ?? p.defaultValue);
    }
    return params;
  }

  function getTail() {
    for (const r of tailRadios) {
      if (r.checked) return /** @type {'left'|'right'|'both'} */ (r.value);
    }
    return 'left';
  }

  // --- Snap-to-common-values during drag ---

  /** Common tail probabilities students encounter. */
  const SNAP_PROBS = [0.005, 0.01, 0.025, 0.05, 0.10];
  /** Pixel threshold for snapping. */
  const SNAP_PX = 6;
  /** @type {number[]} Current snap x-values (recomputed on parameter change). */
  let snapPoints = [];

  /** Recompute snap points from the current inverse CDF. */
  function updateSnapPoints() {
    if (!currentInv) { snapPoints = []; return; }
    snapPoints = [];
    for (const p of SNAP_PROBS) {
      const xLeft = currentInv(p);
      const xRight = currentInv(1 - p);
      if (isFinite(xLeft)) snapPoints.push(xLeft);
      if (isFinite(xRight) && Math.abs(xRight - xLeft) > 1e-10) snapPoints.push(xRight);
    }
  }

  /**
   * Snap a data-space x value to the nearest snap point if within pixel threshold.
   * @param {number} x - Data-space value
   * @param {import('d3-scale').ScaleLinear<number,number>} xScale
   * @returns {number} Snapped value or original
   */
  function snapValue(x, xScale) {
    const px = xScale(x);
    let bestDist = SNAP_PX + 1;
    let bestVal = x;
    for (const sp of snapPoints) {
      const spPx = xScale(sp);
      const dist = Math.abs(px - spPx);
      if (dist < bestDist) {
        bestDist = dist;
        bestVal = sp;
      }
    }
    return bestVal;
  }

  // --- Rendering ---

  /**
   * Full redraw: called when distribution parameters change (curve shape changes).
   * Draws the curve, adds interactive overlays, computes result.
   */
  function fullRender() {
    const params = getDistParams();

    // Validate parameters
    for (const p of config.params) {
      if (p.min != null && params[p.paramKey] < p.min) {
        showError(paramInputs[p.paramKey], `Must be ≥ ${p.min}`);
        return;
      }
      clearError(paramInputs[p.paramKey]);
    }

    currentCdf = config.cdfFactory(params);
    currentInv = config.invFactory(params);
    updateSnapPoints();
    const pdfFn = config.pdfFactory(params);
    const domainParams = config.domainParams(params);
    const domain = computeDomain(config.type, domainParams);

    // Clear and redraw chart
    chartContainer.innerHTML = '';

    const tail = getTail();
    const shadeOpts = computeShadeOpts(tail);

    curveState = drawCurve(chartContainer, pdfFn, domain, {
      id: `${config.type}-curve`,
      xLabel: config.xSymbol,
      titleText: `${config.name} Distribution`,
      ...shadeOpts,
    });

    addInteractiveLayer(tail);
    computeAndDisplay(tail);
  }

  /**
   * Partial update: called when x value or tail direction changes.
   * Keeps the curve, updates shading + annotations + result.
   */
  function updateShading() {
    if (!curveState) return;

    const tail = getTail();
    const shadeOpts = computeShadeOpts(tail);

    curveState.update(shadeOpts);

    clearAnnotations();
    addInteractiveLayer(tail);
    computeAndDisplay(tail);
  }

  /**
   * Compute shade options from current x input and tail direction.
   * @param {'left'|'right'|'both'} tail
   */
  function computeShadeOpts(tail) {
    const x = parseFloat(inputX.value);
    if (!isFinite(x)) return {};
    if (tail === 'left') return { tail: 'left', critValue: x };
    if (tail === 'right') return { tail: 'right', critValue: x };
    return { tail: 'both', critLow: -Math.abs(x), critHigh: Math.abs(x) };
  }

  // --- Interactive Layer ---

  /** Remove all interactive annotations from the chart. */
  function clearAnnotations() {
    if (!curveState) return;
    const annotations = d3Selection.select(curveState.frame.inner).select('.annotations');
    annotations.selectAll('*').remove();
  }

  /**
   * Add interactive overlays: drag lines, editable labels, probability text.
   * @param {'left'|'right'|'both'} tail
   */
  function addInteractiveLayer(tail) {
    if (!curveState || !currentCdf) return;

    const { frame, xScale, yScale, curveData } = curveState;
    const annotations = d3Selection.select(frame.inner).select('.annotations');
    const x = parseFloat(inputX.value);
    if (!isFinite(x)) return;

    if (tail === 'both') {
      addBoundaryLine(annotations, frame, xScale, -Math.abs(x), tail);
      addBoundaryLine(annotations, frame, xScale, Math.abs(x), tail);

      // Probability labels in each tail
      const absX = Math.abs(x);
      const tailProb = currentCdf(-absX);
      addProbLabel(annotations, frame, xScale, yScale, curveData,
        xScale.domain()[0], -absX, tailProb, false, 'left-of-both');
      addProbLabel(annotations, frame, xScale, yScale, curveData,
        absX, xScale.domain()[1], tailProb, false, 'right-of-both');
      // Center label for complement
      addProbLabel(annotations, frame, xScale, yScale, curveData,
        -absX, absX, 1 - 2 * tailProb, true, 'center');
    } else {
      const critX = x;

      // Draggable boundary line
      addBoundaryLine(annotations, frame, xScale, critX, tail);

      // Probability labels
      const leftProb = currentCdf(critX);
      if (tail === 'left') {
        addProbLabel(annotations, frame, xScale, yScale, curveData,
          xScale.domain()[0], critX, leftProb, false, 'left');
        addProbLabel(annotations, frame, xScale, yScale, curveData,
          critX, xScale.domain()[1], 1 - leftProb, true, 'right');
      } else {
        addProbLabel(annotations, frame, xScale, yScale, curveData,
          xScale.domain()[0], critX, leftProb, true, 'left');
        addProbLabel(annotations, frame, xScale, yScale, curveData,
          critX, xScale.domain()[1], 1 - leftProb, false, 'right');
      }
    }

    // Editable value label on x-axis
    addEditableValueLabel(annotations, frame, xScale, x, tail);
  }

  /**
   * Add a draggable vertical boundary line.
   * @param {*} group - D3 selection for annotations group
   * @param {import('./types.js').ChartFrame} frame
   * @param {*} xScale
   * @param {number} value - Data-space x position
   * @param {'left'|'right'|'both'} tail - Current tail direction
   */
  function addBoundaryLine(group, frame, xScale, value, tail) {
    const px = xScale(value);
    const handleWidth = 24;

    // Visible dashed line
    const line = group.append('line')
      .attr('class', 'crit-line')
      .attr('x1', px).attr('y1', 0)
      .attr('x2', px).attr('y2', frame.height)
      .attr('stroke', '#333')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '6,3');

    // Invisible wider handle for dragging
    const handle = group.append('rect')
      .attr('class', 'drag-handle')
      .attr('x', px - handleWidth / 2)
      .attr('y', 0)
      .attr('width', handleWidth)
      .attr('height', frame.height)
      .attr('fill', 'transparent')
      .attr('cursor', 'ew-resize');

    enableHorizontalDrag(
      handle.node(),
      /** @type {SVGSVGElement} */ (frame.svg),
      frame,
      xScale,
      (rawX) => {
        // Snap to common critical values
        const newX = snapValue(rawX, xScale);
        // Move line + handle (lightweight, no DOM rebuild)
        const newPx = xScale(newX);
        line.attr('x1', newPx).attr('x2', newPx);
        handle.attr('x', newPx - handleWidth / 2);

        // For "both" tails, also move the mirror line
        if (tail === 'both') {
          const mirrorPx = xScale(-newX);
          const lines = group.selectAll('.crit-line');
          const handles = group.selectAll('.drag-handle');
          lines.each(function(_, i) {
            const l = d3Selection.select(this);
            if (i === 0) { l.attr('x1', mirrorPx).attr('x2', mirrorPx); }
            else { l.attr('x1', newPx).attr('x2', newPx); }
          });
          handles.each(function(_, i) {
            const h = d3Selection.select(this);
            if (i === 0) { h.attr('x', mirrorPx - handleWidth / 2); }
            else { h.attr('x', newPx - handleWidth / 2); }
          });
        }

        // Update value label position + text
        const critLabels = group.selectAll('.crit-label');
        const critBgs = group.selectAll('.crit-label-bg');
        if (tail === 'both') {
          const absX = Math.abs(newX);
          critLabels.each(function(_, i) {
            const el = d3Selection.select(this);
            if (i === 0) {
              el.attr('x', xScale(-absX)).text(formatEditValue(-absX));
            } else {
              el.attr('x', xScale(absX)).text(formatEditValue(absX));
            }
          });
          critBgs.each(function(_, i) {
            const el = d3Selection.select(this);
            const labelText = formatEditValue(i === 0 ? -absX : absX);
            const tw = labelText.length * 8 + (i === 0 ? 16 : 12);
            const cx = i === 0 ? xScale(-absX) : xScale(absX);
            el.attr('x', cx - tw / 2).attr('width', tw);
          });
        } else {
          critLabels.attr('x', newPx).text(formatEditValue(newX));
          const labelText = formatEditValue(newX);
          const tw = labelText.length * 8 + 12;
          critBgs.attr('x', newPx - tw / 2).attr('width', tw);
        }

        // Lightweight update: shading + probability labels + result
        onDragMove(newX, tail);
      }
    );
  }

  /**
   * Add a probability label inside a region of the chart.
   * @param {*} group
   * @param {import('./types.js').ChartFrame} frame
   * @param {*} xScale
   * @param {*} yScale
   * @param {Array<{x: number, y: number}>} curveData
   * @param {number} xLo - Left edge of region (data space)
   * @param {number} xHi - Right edge of region (data space)
   * @param {number} prob - Probability value to display
   * @param {boolean} [isComplement=false] - If true, render as lighter complement text
   */
  /**
   * @param {*} group
   * @param {import('./types.js').ChartFrame} frame
   * @param {*} xScale
   * @param {*} yScale
   * @param {Array<{x: number, y: number}>} curveData
   * @param {number} xLo
   * @param {number} xHi
   * @param {number} prob
   * @param {boolean} [isComplement=false]
   * @param {'left'|'right'|'left-of-both'|'right-of-both'|'center'} [region] - Which region this label represents
   */
  function addProbLabel(group, frame, xScale, yScale, curveData, xLo, xHi, prob, isComplement = false, region) {
    // Position at midpoint of region
    const midX = (xLo + xHi) / 2;
    const midPx = xScale(midX);

    // Find curve height at midpoint for vertical positioning
    const nearest = curveData.reduce((best, d) =>
      Math.abs(d.x - midX) < Math.abs(best.x - midX) ? d : best
    );
    const curveY = yScale(nearest.y);
    // Place label between curve and baseline, biased toward bottom
    const labelY = curveY + (frame.height - curveY) * 0.6;

    // Clamp horizontal position to stay within chart area
    const clampedX = Math.max(30, Math.min(frame.width - 30, midPx));

    const textEl = group.append('text')
      .attr('class', isComplement ? 'prob-label prob-complement' : 'prob-label')
      .attr('x', clampedX)
      .attr('y', Math.min(labelY, frame.height - 8))
      .attr('text-anchor', 'middle')
      .attr('fill', isComplement ? '#808080' : '#114B5F')
      .attr('cursor', 'pointer')
      .text(prob.toFixed(4));

    // Click to edit probability → compute inverse critical value
    textEl.on('click', async () => {
      if (!currentInv) return;
      const newProb = await showInlineEdit(
        chartContainer,
        textEl.node(),
        prob,
        prob.toFixed(4)
      );
      if (newProb == null || newProb <= 0 || newProb >= 1) return;

      // Convert edited probability to a critical value
      let newX;
      if (region === 'left' || region === 'left-of-both') {
        // Shaded area = P(X ≤ x), so x = inv(p)
        newX = currentInv(newProb);
      } else if (region === 'right' || region === 'right-of-both') {
        // Shaded area = P(X ≥ x) = 1 - CDF(x), so x = inv(1 - p)
        newX = currentInv(1 - newProb);
      } else if (region === 'center') {
        // Center complement: area = 1 - 2*tail, so tail = (1 - p)/2, x = inv(1 - (1-p)/2)
        const tailProb = (1 - newProb) / 2;
        newX = currentInv(1 - tailProb);
      } else {
        return;
      }

      if (!isFinite(newX)) return;
      const tail = getTail();
      inputX.value = formatForInput(tail === 'both' ? Math.abs(newX) : newX);
      onValueChange(tail === 'both' ? Math.abs(newX) : newX, tail);
    });
  }

  /**
   * Add an editable value label on the x-axis at the critical value position.
   * Click to edit inline; Enter/blur commits the new value.
   * @param {*} group
   * @param {import('./types.js').ChartFrame} frame
   * @param {*} xScale
   * @param {number} value
   * @param {'left'|'right'|'both'} tail
   */
  function addEditableValueLabel(group, frame, xScale, value, tail) {
    const displayValue = tail === 'both' ? Math.abs(value) : value;
    const px = xScale(displayValue);

    // Background pill for the label
    const labelText = formatEditValue(displayValue);
    const textWidth = labelText.length * 8 + 12;

    group.append('rect')
      .attr('class', 'crit-label-bg')
      .attr('x', px - textWidth / 2)
      .attr('y', frame.height + 6)
      .attr('width', textWidth)
      .attr('height', 20)
      .attr('rx', 3)
      .attr('fill', '#fff')
      .attr('stroke', '#569BBD')
      .attr('stroke-width', 1)
      .attr('cursor', 'pointer');

    const textEl = group.append('text')
      .attr('class', 'crit-label')
      .attr('x', px)
      .attr('y', frame.height + 20)
      .attr('text-anchor', 'middle')
      .attr('fill', '#333')
      .attr('cursor', 'pointer')
      .text(labelText);

    // For "both" tails, also show the negative value
    if (tail === 'both') {
      const negPx = xScale(-Math.abs(value));
      const negTextWidth = labelText.length * 8 + 16; // extra for minus sign

      group.append('rect')
        .attr('class', 'crit-label-bg')
        .attr('x', negPx - negTextWidth / 2)
        .attr('y', frame.height + 6)
        .attr('width', negTextWidth)
        .attr('height', 20)
        .attr('rx', 3)
        .attr('fill', '#fff')
        .attr('stroke', '#569BBD')
        .attr('stroke-width', 1)
        .attr('cursor', 'pointer');

      group.append('text')
        .attr('class', 'crit-label')
        .attr('x', negPx)
        .attr('y', frame.height + 20)
        .attr('text-anchor', 'middle')
        .attr('fill', '#333')
        .attr('cursor', 'pointer')
        .text(formatEditValue(-Math.abs(value)));
    }

    // Click-to-edit on the label (and its background)
    const clickHandler = async () => {
      const newVal = await showInlineEdit(
        chartContainer,
        textEl.node(),
        displayValue
      );
      if (newVal != null) {
        inputX.value = formatForInput(tail === 'both' ? Math.abs(newVal) : newVal);
        onValueChange(tail === 'both' ? Math.abs(newVal) : newVal, tail);
      }
    };

    textEl.on('click', clickHandler);
    // Also make the background pill clickable
    group.selectAll('.crit-label-bg').on('click', clickHandler);
  }

  // --- Value change handler (from drag or edit) ---

  /**
   * Full rebuild of annotations — used for edits or when drag ends.
   * @param {number} newX
   * @param {'left'|'right'|'both'} tail
   */
  function onValueChange(newX, tail) {
    if (!curveState || !currentCdf) return;

    const shadeOpts = tail === 'both'
      ? { tail: 'both', critLow: -Math.abs(newX), critHigh: Math.abs(newX) }
      : { tail, critValue: newX };

    curveState.update(shadeOpts);
    clearAnnotations();
    addInteractiveLayer(tail);
    syncProbFromX(tail);
    computeAndDisplay(tail);
  }

  /**
   * Lightweight update during drag — only update shading + probability labels.
   * Does NOT rebuild drag handles or editable labels (avoids DOM churn).
   * @param {number} newX
   * @param {'left'|'right'|'both'} tail
   */
  function onDragMove(newX, tail) {
    if (!curveState || !currentCdf) return;

    // Update shading
    const shadeOpts = tail === 'both'
      ? { tail: 'both', critLow: -Math.abs(newX), critHigh: Math.abs(newX) }
      : { tail, critValue: newX };
    curveState.update(shadeOpts);

    // Update probability label text in-place
    const { frame } = curveState;
    const annotations = d3Selection.select(frame.inner).select('.annotations');
    const probLabels = annotations.selectAll('.prob-label');

    if (tail === 'both') {
      const absX = Math.abs(newX);
      const tailProb = currentCdf(-absX);
      const centerProb = 1 - 2 * tailProb;
      probLabels.each(function(_, i) {
        const el = d3Selection.select(this);
        if (i === 0) el.text(tailProb.toFixed(4));
        else if (i === 1) el.text(tailProb.toFixed(4));
        else el.text(centerProb.toFixed(4));
      });
    } else {
      const leftProb = currentCdf(newX);
      probLabels.each(function(_, i) {
        const el = d3Selection.select(this);
        el.text(i === 0 ? leftProb.toFixed(4) : (1 - leftProb).toFixed(4));
      });
    }

    // Sync both form inputs
    inputX.value = formatForInput(tail === 'both' ? Math.abs(newX) : newX);
    syncProbFromX(tail);
    computeAndDisplay(tail);
  }

  // --- Sync helpers ---

  /** Compute probability from current x and tail, write to inputP. */
  function syncProbFromX(tail) {
    if (!currentCdf) return;
    const x = parseFloat(inputX.value);
    if (!isFinite(x)) return;
    if (tail === 'left') {
      inputP.value = currentCdf(x).toFixed(4);
    } else if (tail === 'right') {
      inputP.value = (1 - currentCdf(x)).toFixed(4);
    } else {
      inputP.value = (2 * currentCdf(-Math.abs(x))).toFixed(4);
    }
  }

  /** Compute x from current probability and tail, write to inputX. */
  function syncXFromProb(tail) {
    if (!currentInv) return;
    const p = parseFloat(inputP.value);
    if (!isFinite(p) || p <= 0 || p >= 1) return;
    if (tail === 'left') {
      inputX.value = formatForInput(currentInv(p));
    } else if (tail === 'right') {
      inputX.value = formatForInput(currentInv(1 - p));
    } else {
      // Two-tailed: p is the total tail area, each tail = p/2
      inputX.value = formatForInput(Math.abs(currentInv(p / 2)));
    }
  }

  // --- Result computation and display ---
  /** @param {'left'|'right'|'both'} tail */
  function computeAndDisplay(tail) {
    if (!currentCdf) return;

    const x = parseFloat(inputX.value);
    if (!isFinite(x)) return;

    let resultText = '';
    if (tail === 'left') {
      const prob = currentCdf(x);
      resultText = `P(${config.xSymbol} ≤ ${formatEditValue(x)}) = ${prob.toFixed(4)}`;
    } else if (tail === 'right') {
      const prob = 1 - currentCdf(x);
      resultText = `P(${config.xSymbol} ≥ ${formatEditValue(x)}) = ${prob.toFixed(4)}`;
    } else {
      const absX = Math.abs(x);
      const prob = 2 * currentCdf(-absX);
      resultText = `P(|${config.xSymbol}| ≥ ${formatEditValue(absX)}) = ${prob.toFixed(4)}`;
    }

    resultDiv.textContent = resultText;
    announceDiv.textContent = resultText;
  }

  // --- Format helpers ---
  function formatForInput(v) {
    return v.toFixed(4);
  }

  // --- Event wiring ---

  // Tail direction change → recompute from x
  for (const r of tailRadios) {
    r.addEventListener('change', () => {
      syncProbFromX(getTail());
      updateShading();
    });
  }

  // Debounced handlers for form inputs
  const debouncedFullRender = debounce(fullRender, 200);

  // X value input → update probability + chart
  const debouncedXUpdate = debounce(() => {
    syncProbFromX(getTail());
    updateShading();
  }, 150);
  inputX.addEventListener('input', debouncedXUpdate);

  // P value input → update x + chart (inverse direction)
  const debouncedPUpdate = debounce(() => {
    syncXFromProb(getTail());
    updateShading();
  }, 150);
  inputP.addEventListener('input', debouncedPUpdate);

  // Distribution parameter inputs → full redraw (curve shape changes)
  // Also wire up slider ↔ number input sync
  for (const p of config.params) {
    const numInput = paramInputs[p.paramKey];
    if (!numInput) continue;

    // Update param summary display if it exists
    const paramDisplay = document.getElementById(`${p.id}-display`);
    const updateParamDisplay = () => {
      if (paramDisplay) paramDisplay.textContent = numInput.value;
    };
    numInput.addEventListener('input', () => { updateParamDisplay(); });
    numInput.addEventListener('input', debouncedFullRender);

    // Look for a paired range slider (id = "slider-{paramKey}")
    const slider = /** @type {HTMLInputElement} */ (
      document.getElementById(`slider-${p.paramKey}`)
    );
    if (slider) {
      // Sync slider → number input → full render
      slider.addEventListener('input', () => {
        numInput.value = slider.value;
        if (paramDisplay) paramDisplay.textContent = slider.value;
        fullRender();
      });
      // Sync number input → slider
      numInput.addEventListener('input', () => {
        const v = parseFloat(numInput.value);
        if (isFinite(v)) {
          slider.value = String(Math.min(parseFloat(slider.max), Math.max(parseFloat(slider.min), v)));
        }
      });
    }
  }

  // Keyboard shortcuts
  const helpDialog = /** @type {HTMLDialogElement} */ (document.getElementById('keyboard-help'));
  if (helpDialog) {
    document.addEventListener('keydown', (e) => {
      if (e.target !== document.body) return;
      if (e.ctrlKey || e.metaKey) return;

      if (e.key === '?') helpDialog.showModal();
    });

    if (helpDialog.querySelector) {
      const closeBtn = helpDialog.querySelector('button');
      if (closeBtn) closeBtn.addEventListener('click', () => helpDialog.close());
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && helpDialog.open) helpDialog.close();
    });
  }

  // --- Initial render ---
  fullRender();
  syncProbFromX(getTail());
}

/** @param {HTMLInputElement} el @param {string} msg */
function showError(el, msg) {
  el.setAttribute('aria-invalid', 'true');
  const errId = el.id + '-error';
  let errEl = document.getElementById(errId);
  if (!errEl) {
    errEl = document.createElement('p');
    errEl.id = errId;
    errEl.className = 'error-msg';
    errEl.setAttribute('role', 'alert');
    el.after(errEl);
  }
  errEl.textContent = msg;
  el.setAttribute('aria-describedby', errId);
}

/** @param {HTMLInputElement} el */
function clearError(el) {
  el.removeAttribute('aria-invalid');
  const errEl = document.getElementById(el.id + '-error');
  if (errEl) errEl.remove();
  el.removeAttribute('aria-describedby');
}
