/** Spreadsheet applications must treat user-entered names as text, not formulas. */
export function csvCell(value: string | number): string {
  let text = String(value);
  // Keep numeric values (including signed decimal/scientific display strings) numeric.
  const numericText = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(text.trim());
  if (typeof value === 'string' && !numericText && /^[\s\uFEFF]*[=+@-]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function rowsToCsv(rows: (string | number)[][]): string {
  return rows.map(row => row.map(csvCell).join(',')).join('\n');
}
