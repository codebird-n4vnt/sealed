/**
 * Team imports from CSV: a header row with `name` and `salary`, and optionally `wallet` and
 * `email`, in any order and case. Spreadsheet exports (quoted fields, CRLF, a byte-order mark)
 * read as expected.
 */

export type TeamRow = { line: number; name: string; salary: string; wallet?: string; email?: string };

export const TEAM_CSV_TEMPLATE = 'name,salary,wallet,email\nPriya Sharma,4200,,priya@example.com\n';
export const MAX_IMPORT_ROWS = 500;

/** Splits CSV text into rows of cells (RFC 4180: quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^﻿/, '');
  for (let i = 0; i < input.length; i++) {
    const char = input[i]!;
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(cell);
      cell = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && input[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** Reads a team CSV. Blank lines are skipped; `line` numbers count the header as line 1. */
export function parseTeamCsv(text: string): { rows: TeamRow[]; errors: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], errors: ['The file is empty.'] };
  const columns = header.map(name => name.trim().toLowerCase());
  const index = (name: string) => columns.indexOf(name);
  const missing = ['name', 'salary'].filter(name => index(name) < 0);
  if (missing.length > 0) return { rows: [], errors: [`The header row needs a ${missing.join(' and a ')} column.`] };

  const rows: TeamRow[] = [];
  const errors: string[] = [];
  body.forEach((cells, position) => {
    const line = position + 2;
    const cell = (name: string) => (index(name) < 0 ? '' : (cells[index(name)] ?? '').trim());
    if (cells.every(value => value.trim() === '')) return;
    const row: TeamRow = { line, name: cell('name'), salary: cell('salary').replace(/[\s,]/g, '') };
    if (cell('wallet')) row.wallet = cell('wallet');
    if (cell('email')) row.email = cell('email');
    if (!row.name) errors.push(`Line ${line}: missing a name.`);
    else if (!row.salary) errors.push(`Line ${line}: missing a salary.`);
    else rows.push(row);
  });
  if (rows.length > MAX_IMPORT_ROWS) errors.push(`At most ${MAX_IMPORT_ROWS} people per import.`);
  return { rows, errors };
}
