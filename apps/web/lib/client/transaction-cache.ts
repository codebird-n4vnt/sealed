'use client';

import type { Address, Signature } from '@solana/kit';

import type { DecodedTransaction, TransactionCache } from '@sealed/core';

import { CLUSTER } from '../config';
import { fromBase64, toBase64 } from './api';

// Finalized transactions, kept in this browser's localStorage. They're public chain data and never
// change, and public RPCs allow only a few history reads per second, so reloading the accountant
// view or pay history reads only what's new. Nothing decrypted is stored: instruction data holds
// amounts only in encrypted form, exactly as it is on-chain.
const PREFIX = `sealed:tx:${CLUSTER}:`;

type Stored = {
  slot: string;
  blockTime: string | null;
  instructions: Array<{ programAddress: string; accounts: string[]; data: string }>;
};

export const transactionCache: TransactionCache = {
  get(signature: Signature): DecodedTransaction | undefined {
    try {
      const raw = localStorage.getItem(PREFIX + signature);
      if (!raw) return undefined;
      const stored = JSON.parse(raw) as Stored;
      return {
        signature,
        slot: BigInt(stored.slot),
        blockTime: stored.blockTime === null ? null : BigInt(stored.blockTime),
        instructions: stored.instructions.map(instruction => ({
          programAddress: instruction.programAddress as Address,
          accounts: instruction.accounts as Address[],
          data: fromBase64(instruction.data),
        })),
      };
    } catch {
      return undefined;
    }
  },
  set(signature: Signature, transaction: DecodedTransaction) {
    const stored: Stored = {
      slot: String(transaction.slot),
      blockTime: transaction.blockTime === null ? null : String(transaction.blockTime),
      instructions: transaction.instructions.map(instruction => ({
        programAddress: instruction.programAddress,
        accounts: instruction.accounts,
        data: toBase64(instruction.data),
      })),
    };
    try {
      localStorage.setItem(PREFIX + signature, JSON.stringify(stored));
    } catch {
      // Storage full or unavailable (e.g. a private window): just read from the chain next time.
    }
  },
};
