/** Sealed's test stablecoins use 6 decimals, like USDC. */
export const DEFAULT_DECIMALS = 6;

/** Converts a decimal string ("250", "1234.5") to base units. Rejects anything else. */
export function parseAmount(amount: string, decimals: number = DEFAULT_DECIMALS): bigint {
  const match = /^(\d+)(?:\.(\d*))?$/.exec(amount.trim());
  const [, whole, fraction = ''] = match ?? [];
  if (whole === undefined || fraction.length > decimals) {
    throw new Error(`Invalid amount "${amount}": expected a non-negative number with up to ${decimals} decimals.`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0');
}

/** Converts base units to a decimal string without trailing zeros ("250", "1234.5"). */
export function formatAmount(amount: bigint, decimals: number = DEFAULT_DECIMALS): string {
  if (amount < 0n) return `-${formatAmount(-amount, decimals)}`;
  const scale = 10n ** BigInt(decimals);
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return fraction ? `${amount / scale}.${fraction}` : `${amount / scale}`;
}
