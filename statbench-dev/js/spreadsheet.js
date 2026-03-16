// @ts-check
/**
 * Shared single-column spreadsheet editor.
 *
 * Provides a lightweight editable grid with paste support, auto-extending rows,
 * and keyboard navigation (Enter/ArrowDown/ArrowUp between rows).
 *
 * Used by explore/descriptive (numeric) and explore/categorical (text).
 */

/** Default number of empty rows when initializing a blank sheet. */
export const EMPTY_ROWS = 8;

/**
 * Create a spreadsheet editor in a tbody element.
 * @param {HTMLElement} tbody
 * @param {'number'|'text'} inputType
 * @param {string[]} [initialValues]
 */
export function initSheet(tbody, inputType, initialValues) {
  tbody.innerHTML = '';
  const vals = initialValues ?? [];
  const rowCount = Math.max(vals.length + 3, EMPTY_ROWS);
  for (let i = 0; i < rowCount; i++) {
    appendSheetRow(tbody, inputType, i + 1, vals[i] ?? '');
  }
}

/**
 * Append a single row to a spreadsheet tbody.
 * @param {HTMLElement} tbody
 * @param {'number'|'text'} inputType
 * @param {number} rowNum
 * @param {string} value
 * @returns {HTMLInputElement}
 */
export function appendSheetRow(tbody, inputType, rowNum, value) {
  const tr = document.createElement('tr');
  if (!value) tr.className = 'empty-row';

  const tdNum = document.createElement('td');
  tdNum.className = 'row-num';
  tdNum.textContent = String(rowNum);
  tr.appendChild(tdNum);

  const tdVal = document.createElement('td');
  const input = document.createElement('input');
  input.type = 'text';
  input.inputMode = inputType === 'number' ? 'decimal' : 'text';
  input.value = value;
  input.setAttribute('aria-label', `Row ${rowNum}`);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextRow = tr.nextElementSibling;
      if (nextRow) {
        /** @type {HTMLInputElement|null} */ (nextRow.querySelector('input'))?.focus();
      } else {
        const newInput = appendSheetRow(tbody, inputType, rowNum + 1, '');
        newInput.focus();
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      const prevRow = tr.previousElementSibling;
      if (prevRow) {
        /** @type {HTMLInputElement|null} */ (prevRow.querySelector('input'))?.focus();
      }
    }
  });

  input.addEventListener('input', () => {
    tr.className = input.value.trim() ? '' : 'empty-row';
    if (!tr.nextElementSibling && input.value.trim()) {
      for (let i = 0; i < 3; i++) {
        appendSheetRow(tbody, inputType, getRowCount(tbody) + 1, '');
      }
    }
  });

  tdVal.appendChild(input);
  tr.appendChild(tdVal);
  tbody.appendChild(tr);
  return input;
}

/**
 * Handle paste into the spreadsheet — split lines across rows.
 * @param {HTMLElement} tbody
 * @param {'number'|'text'} inputType
 * @param {ClipboardEvent} e
 */
export function handleSheetPaste(tbody, inputType, e) {
  const text = e.clipboardData?.getData('text');
  if (!text) return;

  const lines = text.split(/[\n\r]+/).map(s => s.trim()).filter(s => s.length > 0);
  if (lines.length <= 1) return;

  e.preventDefault();

  const target = /** @type {HTMLInputElement} */ (e.target);
  const targetRow = target.closest('tr');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  let startIdx = targetRow ? rows.indexOf(targetRow) : rows.length;
  if (startIdx < 0) startIdx = rows.length;

  for (let i = 0; i < lines.length; i++) {
    const rowIdx = startIdx + i;
    if (rowIdx < rows.length) {
      const input = /** @type {HTMLInputElement|null} */ (rows[rowIdx].querySelector('input'));
      if (input) {
        input.value = lines[i];
        rows[rowIdx].className = lines[i] ? '' : 'empty-row';
      }
    } else {
      appendSheetRow(tbody, inputType, rowIdx + 1, lines[i]);
    }
  }

  const totalRows = getRowCount(tbody);
  for (let i = 0; i < 3; i++) {
    appendSheetRow(tbody, inputType, totalRows + i + 1, '');
  }
}

/**
 * Count rows in a spreadsheet tbody.
 * @param {HTMLElement} tbody
 * @returns {number}
 */
export function getRowCount(tbody) {
  return tbody.querySelectorAll('tr').length;
}

/**
 * Read all non-empty values from a spreadsheet.
 * @param {HTMLElement} tbody
 * @returns {string[]}
 */
export function readSheetValues(tbody) {
  /** @type {string[]} */
  const values = [];
  for (const input of tbody.querySelectorAll('input')) {
    const v = /** @type {HTMLInputElement} */ (input).value.trim();
    if (v) values.push(v);
  }
  return values;
}

/**
 * Populate a spreadsheet with values (replaces all rows).
 * @param {HTMLElement} tbody
 * @param {'number'|'text'} inputType
 * @param {string[]} values
 */
export function populateSheet(tbody, inputType, values) {
  initSheet(tbody, inputType, values);
}
