import { describe, expect, it } from 'vitest';

import { formatAmount, parseAmount } from '../../src/amounts';

describe('parseAmount', () => {
  it.each([
    ['250', 250_000_000n],
    ['1234.5', 1_234_500_000n],
    ['0.000001', 1n],
    ['0', 0n],
    ['7.', 7_000_000n],
    [' 42 ', 42_000_000n],
    ['18446744073709.551615', 18_446_744_073_709_551_615n], // u64::MAX
  ])('parses %j to %s base units', (input, expected) => {
    expect(parseAmount(input)).toBe(expected);
  });

  it('uses the given decimals', () => {
    expect(parseAmount('1.5', 2)).toBe(150n);
    expect(parseAmount('3', 0)).toBe(3n);
  });

  it.each(['', ' ', '-1', '1.0000001', 'abc', '1e6', '.5', '1,000', '1.2.3'])('rejects %j', input => {
    expect(() => parseAmount(input)).toThrow(/Invalid amount/);
  });

  it('rejects fractions beyond the decimals', () => {
    expect(() => parseAmount('1.23', 1)).toThrow(/up to 1 decimals/);
    expect(() => parseAmount('1.5', 0)).toThrow();
  });
});

describe('formatAmount', () => {
  it.each([
    [250_000_000n, '250'],
    [1_234_500_000n, '1234.5'],
    [1n, '0.000001'],
    [0n, '0'],
    [-1_500_000n, '-1.5'],
  ])('formats %s base units as %j', (input, expected) => {
    expect(formatAmount(input)).toBe(expected);
  });

  it('round-trips with parseAmount', () => {
    for (const amount of ['0', '0.1', '99.999999', '1000000', '18446744073709.551615']) {
      expect(formatAmount(parseAmount(amount))).toBe(amount);
    }
  });
});
