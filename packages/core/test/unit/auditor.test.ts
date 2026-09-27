import {
  CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  CONFIDENTIAL_WITHDRAW_CONFIDENTIAL_TRANSFER_DISCRIMINATOR,
  getConfidentialTransferInstructionDataEncoder,
} from '@solana-program/token-2022';
import { ElGamalKeypair, PedersenOpening } from '@solana/zk-sdk/bundler';
import { describe, expect, it } from 'vitest';

import { isConfidentialInstructionData } from '../../src/accounts';
import { decryptAuditorAmount } from '../../src/auditor';

/**
 * Builds Transfer instruction data the way Token-2022 clients do: the amount is split into a
 * low 16-bit and a high 32-bit half, and each half is encrypted to the auditor separately.
 */
function transferDataFor(amount: bigint, auditor: ElGamalKeypair) {
  const encrypt = (value: bigint) => auditor.pubkey().encryptWith(value, new PedersenOpening()).toBytes();
  return getConfidentialTransferInstructionDataEncoder().encode({
    newSourceDecryptableAvailableBalance: new Uint8Array(36),
    transferAmountAuditorCiphertextLo: encrypt(amount & 0xffffn),
    transferAmountAuditorCiphertextHi: encrypt(amount >> 16n),
    equalityProofInstructionOffset: 0,
    ciphertextValidityProofInstructionOffset: 0,
    rangeProofInstructionOffset: 0,
  });
}

describe('decryptAuditorAmount', () => {
  const auditor = new ElGamalKeypair();

  it.each([
    ['zero', 0n],
    ['one base unit', 1n],
    ['the largest low half', 0xffffn],
    ['the first amount with a high half', 0x1_0000n],
    ['a 250-token salary', 250_000_000n],
    ['a 12,345.678901-token salary', 12_345_678_901n],
  ])('recombines the lo/hi halves of %s', (_, amount) => {
    expect(decryptAuditorAmount(transferDataFor(amount, auditor), auditor.secret())).toBe(amount);
  });
});

describe('isConfidentialInstructionData', () => {
  const transfer = CONFIDENTIAL_TRANSFER_CONFIDENTIAL_TRANSFER_DISCRIMINATOR;

  it('matches the confidential-transfer prefix and kind', () => {
    expect(isConfidentialInstructionData(transferDataFor(1n, new ElGamalKeypair()), transfer)).toBe(true);
  });

  it('rejects other confidential instructions, other token instructions and empty data', () => {
    expect(isConfidentialInstructionData(new Uint8Array([27, CONFIDENTIAL_WITHDRAW_CONFIDENTIAL_TRANSFER_DISCRIMINATOR]), transfer)).toBe(false);
    expect(isConfidentialInstructionData(new Uint8Array([3, transfer]), transfer)).toBe(false);
    expect(isConfidentialInstructionData(new Uint8Array(), transfer)).toBe(false);
    expect(isConfidentialInstructionData(undefined, transfer)).toBe(false);
  });
});
