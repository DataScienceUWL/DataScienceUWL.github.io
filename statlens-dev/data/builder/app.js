// @ts-check
/**
 * Dataset Builder — instructor tool for creating StatLens-compatible JSON datasets.
 * @module data/builder/app
 */

import { parseCSV } from '../../js/csv-parser.js';
import { announce, initHelp, suggestDesktop } from '../../js/page-utils.js';

// ─── DOM references ──────────────────────────────────────────────────────────

const csvInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('csv-input'));
const parseBtn = /** @type {HTMLButtonElement} */ (document.getElementById('parse-btn'));
const fileInput = /** @type {HTMLInputElement} */ (document.getElementById('file-input'));
const clearInputBtn = /** @type {HTMLButtonElement} */ (document.getElementById('clear-input-btn'));
const parseStatus = /** @type {HTMLElement} */ (document.getElementById('parse-status'));

const colConfigWrap = /** @type {HTMLElement} */ (document.getElementById('col-config-wrap'));
const colConfigBody = /** @type {HTMLTableSectionElement} */ (document.getElementById('col-config-body'));
const previewWrap = /** @type {HTMLElement} */ (document.getElementById('preview-wrap'));
const previewCount = /** @type {HTMLElement} */ (document.getElementById('preview-count'));
const previewThead = /** @type {HTMLTableSectionElement} */ (document.getElementById('preview-thead'));
const previewTbody = /** @type {HTMLTableSectionElement} */ (document.getElementById('preview-tbody'));

const stepMetadata = /** @type {HTMLElement} */ (document.getElementById('step-metadata'));
const stepExport = /** @type {HTMLElement} */ (document.getElementById('step-export'));

const dsName = /** @type {HTMLInputElement} */ (document.getElementById('ds-name'));
const dsId = /** @type {HTMLInputElement} */ (document.getElementById('ds-id'));
const dsDescription = /** @type {HTMLInputElement} */ (document.getElementById('ds-description'));
const dsSource = /** @type {HTMLInputElement} */ (document.getElementById('ds-source'));
const dsChapter = /** @type {HTMLInputElement} */ (document.getElementById('ds-chapter'));
const dsStudy = /** @type {HTMLTextAreaElement} */ (document.getElementById('ds-study'));
const dsSourceDetail = /** @type {HTMLInputElement} */ (document.getElementById('ds-source-detail'));

const varDescContainer = /** @type {HTMLElement} */ (document.getElementById('var-desc-container'));
const varLabelContainer = /** @type {HTMLElement} */ (document.getElementById('var-label-container'));

const jsonPreview = /** @type {HTMLTextAreaElement} */ (document.getElementById('json-preview'));
const copyBtn = /** @type {HTMLButtonElement} */ (document.getElementById('copy-btn'));
const downloadBtn = /** @type {HTMLButtonElement} */ (document.getElementById('download-btn'));
const copyFeedback = /** @type {HTMLElement} */ (document.getElementById('copy-feedback'));

// ─── State ───────────────────────────────────────────────────────────────────

/** @type {string[]} */
let parsedHeaders = [];

/** @type {Object<string,string>[]} */
let parsedData = [];

/** @type {('numeric'|'categorical')[]} */
let parsedTypes = [];

/** @type {boolean} */
let dataParsed = false;

// ─── Help + settings dialogs (shared wiring, matches other pages) ────────────

initHelp();
suggestDesktop();

// ─── Parse logic ─────────────────────────────────────────────────────────────

parseBtn.addEventListener('click', () => doParse(csvInput.value));

clearInputBtn.addEventListener('click', () => {
    csvInput.value = '';
    resetAll();
    csvInput.focus();
});

fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
        const text = /** @type {string} */ (reader.result);
        csvInput.value = text;
        doParse(text);
    };
    reader.onerror = () => {
        showStatus('Failed to read file.', 'err');
    };
    reader.readAsText(file);
});

// Auto-parse on paste into textarea
csvInput.addEventListener('paste', () => {
    // Use setTimeout so the pasted value is in the textarea
    setTimeout(() => {
        if (csvInput.value.trim()) {
            doParse(csvInput.value);
        }
    }, 50);
});

/**
 * Parse the CSV text and update all UI.
 * @param {string} text
 */
function doParse(text) {
    if (!text.trim()) {
        showStatus('No data to parse.', 'err');
        return;
    }

    try {
        const result = parseCSV(text);
        parsedHeaders = result.headers;
        parsedData = result.data;
        parsedTypes = /** @type {('numeric'|'categorical')[]} */ (result.types);
        dataParsed = true;

        showStatus(`Parsed ${parsedData.length} rows, ${parsedHeaders.length} columns (delimiter: ${describeDelimiter(result.delimiter)})`, 'ok');
        renderColConfig();
        renderPreview();
        enableSteps();
        buildVarFields();
        updateJSON();
        announce(`Data parsed: ${parsedData.length} rows, ${parsedHeaders.length} columns`);
    } catch (err) {
        showStatus(`Parse error: ${/** @type {Error} */ (err).message}`, 'err');
        resetAll();
    }
}

/**
 * @param {string} d
 * @returns {string}
 */
function describeDelimiter(d) {
    if (d === ',') return 'comma';
    if (d === '\t') return 'tab';
    if (d === ';') return 'semicolon';
    if (d === '|') return 'pipe';
    return `"${d}"`;
}

/**
 * @param {string} msg
 * @param {'ok'|'err'} type
 */
function showStatus(msg, type) {
    parseStatus.textContent = msg;
    parseStatus.className = type === 'ok' ? 'status-ok' : 'status-err';
}

function resetAll() {
    dataParsed = false;
    parsedHeaders = [];
    parsedData = [];
    parsedTypes = [];
    parseStatus.textContent = '';
    colConfigWrap.hidden = true;
    previewWrap.hidden = true;
    stepMetadata.classList.add('disabled');
    stepExport.classList.add('disabled');
    colConfigBody.innerHTML = '';
    previewThead.innerHTML = '';
    previewTbody.innerHTML = '';
    varDescContainer.innerHTML = '';
    varLabelContainer.innerHTML = '';
    jsonPreview.value = '';
}

function enableSteps() {
    stepMetadata.classList.remove('disabled');
    stepExport.classList.remove('disabled');
}

// ─── Column config ───────────────────────────────────────────────────────────

function renderColConfig() {
    colConfigBody.innerHTML = '';
    parsedHeaders.forEach((h, i) => {
        const tr = document.createElement('tr');

        const tdName = document.createElement('td');
        tdName.textContent = h;
        tdName.style.fontFamily = "'Source Code Pro', monospace";

        const tdDetected = document.createElement('td');
        tdDetected.textContent = parsedTypes[i];

        const tdOverride = document.createElement('td');
        const sel = document.createElement('select');
        sel.setAttribute('aria-label', `Type for ${h}`);
        sel.innerHTML = `
            <option value="numeric" ${parsedTypes[i] === 'numeric' ? 'selected' : ''}>numeric</option>
            <option value="categorical" ${parsedTypes[i] === 'categorical' ? 'selected' : ''}>categorical</option>
        `;
        sel.addEventListener('change', () => {
            parsedTypes[i] = /** @type {'numeric'|'categorical'} */ (sel.value);
            levelsInput.disabled = sel.value !== 'categorical';
            if (sel.value !== 'categorical') levelsInput.value = '';
            updateJSON();
        });
        tdOverride.appendChild(sel);

        const tdLevels = document.createElement('td');
        const levelsInput = document.createElement('input');
        levelsInput.type = 'text';
        levelsInput.className = 'levels-input';
        levelsInput.placeholder = 'e.g., Low, Medium, High';
        levelsInput.setAttribute('aria-label', `Levels for ${h}`);
        levelsInput.dataset.col = h;
        levelsInput.disabled = parsedTypes[i] !== 'categorical';
        levelsInput.addEventListener('input', () => updateJSON());
        tdLevels.appendChild(levelsInput);

        tr.appendChild(tdName);
        tr.appendChild(tdDetected);
        tr.appendChild(tdOverride);
        tr.appendChild(tdLevels);
        colConfigBody.appendChild(tr);
    });
    colConfigWrap.hidden = false;
}

// ─── Data preview (first 10 rows) ───────────────────────────────────────────

function renderPreview() {
    previewThead.innerHTML = '';
    previewTbody.innerHTML = '';

    const maxRows = 10;
    const showing = Math.min(parsedData.length, maxRows);
    previewCount.textContent = `(showing ${showing} of ${parsedData.length} rows)`;

    // Header
    const headTr = document.createElement('tr');
    const thNum = document.createElement('th');
    thNum.textContent = '#';
    thNum.style.width = '2.5rem';
    headTr.appendChild(thNum);
    for (const h of parsedHeaders) {
        const th = document.createElement('th');
        th.textContent = h;
        headTr.appendChild(th);
    }
    previewThead.appendChild(headTr);

    // Rows
    for (let i = 0; i < showing; i++) {
        const tr = document.createElement('tr');
        const tdNum = document.createElement('td');
        tdNum.textContent = String(i + 1);
        tdNum.style.color = '#999';
        tr.appendChild(tdNum);
        for (const h of parsedHeaders) {
            const td = document.createElement('td');
            td.textContent = parsedData[i][h] ?? '';
            tr.appendChild(td);
        }
        previewTbody.appendChild(tr);
    }
    previewWrap.hidden = false;
}

// ─── Variable fields (descriptions + labels) ────────────────────────────────

function buildVarFields() {
    varDescContainer.innerHTML = '';
    varLabelContainer.innerHTML = '';

    for (const h of parsedHeaders) {
        // Description
        const descRow = document.createElement('div');
        descRow.className = 'var-desc-row';
        const descName = document.createElement('span');
        descName.className = 'var-name';
        descName.textContent = h;
        const descInput = document.createElement('input');
        descInput.type = 'text';
        descInput.placeholder = `Describe what "${h}" represents...`;
        descInput.setAttribute('aria-label', `Description for ${h}`);
        descInput.dataset.col = h;
        descInput.className = 'var-desc-input';
        descInput.addEventListener('input', () => updateJSON());
        descRow.appendChild(descName);
        descRow.appendChild(descInput);
        varDescContainer.appendChild(descRow);

        // Label
        const labelRow = document.createElement('div');
        labelRow.className = 'var-desc-row';
        const labelName = document.createElement('span');
        labelName.className = 'var-name';
        labelName.textContent = h;
        const labelInput = document.createElement('input');
        labelInput.type = 'text';
        labelInput.value = h; // default to column name
        labelInput.setAttribute('aria-label', `Label for ${h}`);
        labelInput.dataset.col = h;
        labelInput.className = 'var-label-input';
        labelInput.addEventListener('input', () => updateJSON());
        labelRow.appendChild(labelName);
        labelRow.appendChild(labelInput);
        varLabelContainer.appendChild(labelRow);
    }
}

// ─── Auto-generate ID from name ──────────────────────────────────────────────

let userEditedId = false;

dsId.addEventListener('input', () => {
    userEditedId = true;
});

dsName.addEventListener('input', () => {
    if (!userEditedId) {
        dsId.value = toSnakeCase(dsName.value);
    }
    updateJSON();
});

// Update JSON on any metadata change
for (const el of [dsId, dsDescription, dsSource, dsChapter, dsStudy, dsSourceDetail]) {
    el.addEventListener('input', () => updateJSON());
}

/**
 * Convert a display name to snake_case ID.
 * @param {string} name
 * @returns {string}
 */
function toSnakeCase(name) {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9\s_-]/g, '')
        .replace(/[\s-]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

// ─── JSON generation ─────────────────────────────────────────────────────────

function updateJSON() {
    if (!dataParsed) return;

    const id = dsId.value.trim() || toSnakeCase(dsName.value || 'untitled');
    const name = dsName.value.trim();
    const description = dsDescription.value.trim();
    const source = dsSource.value.trim();
    const chapter = dsChapter.value.trim();
    const studyDescription = dsStudy.value.trim();
    const sourceDetail = dsSourceDetail.value.trim();

    // Build variables array
    const variables = parsedHeaders.map((h, i) => {
        const labelInput = /** @type {HTMLInputElement|null} */ (
            varLabelContainer.querySelector(`.var-label-input[data-col="${CSS.escape(h)}"]`)
        );
        /** @type {Record<string, any>} */
        const v = {
            name: h,
            label: labelInput?.value.trim() || h,
            type: parsedTypes[i]
        };
        // Include levels for categorical variables if specified
        if (parsedTypes[i] === 'categorical') {
            const levelsInput = /** @type {HTMLInputElement|null} */ (
                colConfigBody.querySelector(`.levels-input[data-col="${CSS.escape(h)}"]`)
            );
            const levelsStr = levelsInput?.value.trim();
            if (levelsStr) {
                v.levels = levelsStr.split(',').map(s => s.trim()).filter(s => s.length > 0);
            }
        }
        return v;
    });

    // Build variableDescriptions
    /** @type {Record<string,string>} */
    const variableDescriptions = {};
    for (const h of parsedHeaders) {
        const descInput = /** @type {HTMLInputElement|null} */ (
            varDescContainer.querySelector(`.var-desc-input[data-col="${CSS.escape(h)}"]`)
        );
        const val = descInput?.value.trim();
        if (val) variableDescriptions[h] = val;
    }

    // Build rows — convert numeric strings to numbers
    const rows = parsedData.map(row => {
        /** @type {Record<string,any>} */
        const out = {};
        for (let i = 0; i < parsedHeaders.length; i++) {
            const h = parsedHeaders[i];
            const raw = (row[h] ?? '').trim();
            if (parsedTypes[i] === 'numeric') {
                const num = parseFloat(raw);
                out[h] = isNaN(num) ? null : num;
            } else {
                out[h] = raw || null;
            }
        }
        return out;
    });

    // Compute metadata flags
    const hasNumeric = parsedTypes.includes('numeric');
    const hasCategorical = parsedTypes.includes('categorical');
    const n = rows.length;

    // Build the dataset object
    /** @type {Record<string,any>} */
    const dataset = { id };
    if (name) dataset.name = name;
    if (description) dataset.description = description;
    if (source) dataset.source = source;
    if (chapter) dataset.chapter = chapter;

    dataset.n = n;
    dataset.hasNumeric = hasNumeric;
    dataset.hasCategorical = hasCategorical;
    dataset.variables = variables;

    if (studyDescription) dataset.studyDescription = studyDescription;
    if (Object.keys(variableDescriptions).length > 0) dataset.variableDescriptions = variableDescriptions;
    if (sourceDetail) dataset.sourceDetail = sourceDetail;

    dataset.rows = rows;

    jsonPreview.value = JSON.stringify(dataset, null, 2);
}

// ─── Export actions ──────────────────────────────────────────────────────────

copyBtn.addEventListener('click', async () => {
    const text = jsonPreview.value;
    if (!text) return;

    try {
        await navigator.clipboard.writeText(text);
        showCopyFeedback('Copied to clipboard!');
        announce('JSON copied to clipboard');
    } catch {
        // Fallback: select all text
        jsonPreview.select();
        document.execCommand('copy');
        showCopyFeedback('Copied to clipboard!');
    }
});

downloadBtn.addEventListener('click', () => {
    const text = jsonPreview.value;
    if (!text) return;

    const id = dsId.value.trim() || 'dataset';
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
    announce(`Downloaded ${id}.json`);
});

/** @type {number|null} */
let feedbackTimer = null;

/**
 * @param {string} msg
 */
function showCopyFeedback(msg) {
    copyFeedback.textContent = msg;
    copyFeedback.classList.add('visible');
    if (feedbackTimer) clearTimeout(feedbackTimer);
    feedbackTimer = window.setTimeout(() => {
        copyFeedback.classList.remove('visible');
    }, 2500);
}

// ─── Init ────────────────────────────────────────────────────────────────────

// Focus the textarea on load
csvInput.focus();
