// @ts-check

/**
 * CSV/TSV parser module.
 * Auto-detects delimiter, infers column types, handles quoted fields.
 * @module csv-parser
 */

/** Values treated as missing during type inference */
const MISSING_VALUES = new Set(['', 'NA', 'na', 'N/A', 'n/a', 'null', 'NULL', '.', 'NaN', 'nan', 'missing']);

/**
 * Parse CSV text into structured data.
 * @param {string} text - Raw CSV text (with header row)
 * @returns {import('./types.js').ParsedData}
 * @throws {Error} If text is empty or has no header row
 */
export function parseCSV(text) {
    if (!text || text.trim().length === 0) {
        throw new Error('Empty input');
    }

    // Strip BOM and normalize line endings
    text = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    const delimiter = detectDelimiter(text);
    const lines = text.trim().split('\n');

    // Parse header row
    const headers = _parseLine(lines[0], delimiter).map(h => h.trim().replace(/^"|"$/g, ''));
    const ncols = headers.length;

    // Parse data rows
    /** @type {Object<string,string>[]} */
    const data = [];
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0) continue;

        const fields = _parseLine(line, delimiter);
        /** @type {Object<string,string>} */
        const row = {};
        for (let j = 0; j < ncols; j++) {
            row[headers[j]] = (fields[j] ?? '').trim();
        }
        data.push(row);
    }

    // Infer column types
    const types = headers.map(h => inferType(data, h));

    return { headers, data, types, delimiter };
}

/**
 * Parse a single CSV line, respecting quoted fields.
 * @param {string} line
 * @param {string} delimiter
 * @returns {string[]}
 */
function _parseLine(line, delimiter) {
    /** @type {string[]} */
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQuotes) {
            if (ch === '"') {
                // Check for escaped quote ("")
                if (i + 1 < line.length && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = false;
                }
            } else {
                current += ch;
            }
        } else {
            if (ch === '"') {
                inQuotes = true;
            } else if (ch === delimiter) {
                fields.push(current);
                current = '';
            } else {
                current += ch;
            }
        }
    }
    fields.push(current);
    return fields;
}

/**
 * Detect the most likely delimiter in CSV text.
 * Candidates: comma, tab, semicolon, pipe.
 * @param {string} text - Raw text (at least 2 lines)
 * @returns {string} Detected delimiter character
 */
export function detectDelimiter(text) {
    const candidates = [',', '\t', ';', '|'];
    const lines = text.trim().split('\n').slice(0, 5);

    if (lines.length < 1) return ',';

    let bestDelimiter = ',';
    let bestScore = -1;

    for (const delim of candidates) {
        const counts = lines.map(line => {
            // Count delimiters outside of quotes
            let count = 0;
            let inQuotes = false;
            for (const ch of line) {
                if (ch === '"') inQuotes = !inQuotes;
                else if (ch === delim && !inQuotes) count++;
            }
            return count;
        });

        // Delimiter must appear at least once
        if (counts[0] === 0) continue;

        // Score = consistency of count across lines (lower variance = better)
        const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
        const variance = counts.reduce((s, c) => s + (c - avg) ** 2, 0) / counts.length;

        // Score: prefer higher count with lower variance
        const score = avg * 1000 - variance;

        if (score > bestScore) {
            bestScore = score;
            bestDelimiter = delim;
        }
    }

    return bestDelimiter;
}

/**
 * Infer whether a column is numeric or categorical.
 * A column is numeric if >= 80% of non-empty, non-missing values parse as finite numbers.
 * @param {Object<string,string>[]} data - Array of row objects
 * @param {string} col - Column name to check
 * @returns {'numeric'|'categorical'}
 */
export function inferType(data, col) {
    if (data.length === 0) return 'categorical';

    let numericCount = 0;
    let nonMissingCount = 0;

    for (const row of data) {
        const val = (row[col] ?? '').trim();
        if (MISSING_VALUES.has(val)) continue;
        nonMissingCount++;
        if (isFinite(parseFloat(val)) && val.match(/^-?\d*\.?\d+(e[+-]?\d+)?$/i)) {
            numericCount++;
        }
    }

    if (nonMissingCount === 0) return 'categorical';
    return (numericCount / nonMissingCount) >= 0.8 ? 'numeric' : 'categorical';
}

/**
 * Serialize an array of row objects to CSV text.
 * @param {Array<Record<string, any>>} rows - Array of row objects
 * @param {string[]} columns - Column names (header order)
 * @returns {string} CSV text with header row
 */
export function rowsToCSV(rows, columns) {
    if (!rows.length || !columns.length) return '';
    const lines = [columns.join(',')];
    for (const row of rows) {
        lines.push(columns.map(c => {
            const v = row[c];
            if (v == null) return '';
            const s = String(v);
            if (s.includes(',') || s.includes('"') || s.includes('\n')) {
                return `"${s.replace(/"/g, '""')}"`;
            }
            return s;
        }).join(','));
    }
    return lines.join('\n');
}

/**
 * Trigger a CSV file download in the browser.
 * @param {string} text - CSV text content
 * @param {string} [filename='data.csv'] - Download filename
 */
export function downloadCSV(text, filename = 'data.csv') {
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}
