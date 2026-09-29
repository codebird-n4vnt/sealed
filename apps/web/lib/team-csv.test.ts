import { describe, expect, it } from 'vitest';

import { parseCsv, parseTeamCsv, TEAM_CSV_TEMPLATE } from './team-csv';

describe('parseCsv', () => {
  it('handles quotes, doubled quotes, commas in fields and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('keeps a quoted line break inside its field', () => {
    expect(parseCsv('"line one\nline two",x\n')).toEqual([['line one\nline two', 'x']]);
  });
});

describe('parseTeamCsv', () => {
  it('reads the template', () => {
    expect(parseTeamCsv(TEAM_CSV_TEMPLATE)).toEqual({
      rows: [{ line: 2, name: 'Priya Sharma', salary: '4200', email: 'priya@example.com' }],
      errors: [],
    });
  });

  it('accepts any column order and case, a byte-order mark, and thousands separators', () => {
    const csv = '﻿Wallet,Salary,Name\n5pUN9vLtZ4hzsSn7L6XnP1aR3LwXhWwy8x5uBJmHhWwy,"5,100.50",Arjun Mehta\n';
    expect(parseTeamCsv(csv).rows).toEqual([
      { line: 2, name: 'Arjun Mehta', salary: '5100.50', wallet: '5pUN9vLtZ4hzsSn7L6XnP1aR3LwXhWwy8x5uBJmHhWwy' },
    ]);
  });

  it('skips blank lines and reports incomplete ones by line number', () => {
    const { rows, errors } = parseTeamCsv('name,salary\nA,1\n\n,2\nC,\n');
    expect(rows.map(row => row.name)).toEqual(['A']);
    expect(errors).toEqual(['Line 4: missing a name.', 'Line 5: missing a salary.']);
  });

  it('needs name and salary columns', () => {
    expect(parseTeamCsv('wallet,email\nx,y\n').errors).toEqual(['The header row needs a name and a salary column.']);
    expect(parseTeamCsv('').errors).toEqual(['The file is empty.']);
  });
});
