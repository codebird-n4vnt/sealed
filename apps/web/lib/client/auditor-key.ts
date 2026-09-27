'use client';

import { getAddressDecoder, type Address } from '@solana/kit';
import { ElGamalKeypair, ElGamalSecretKey } from '@solana/zk-sdk/bundler';

import { fromBase64, toBase64 } from './api';

// The auditor key is generated in the admin's browser when a company is created. Only its public
// half goes to the server and the mint; the secret is saved as a file for the accountant.

export type AuditorKeyFile = {
  type: 'sealed-auditor-key';
  version: 1;
  company: { id: string; name: string };
  elgamalPubkey: Address;
  secretKey: string;
  createdAt: string;
};

export function generateAuditorKey() {
  const keypair = new ElGamalKeypair();
  return {
    elgamalPubkey: getAddressDecoder().decode(keypair.pubkey().toBytes()),
    secretKey: toBase64(keypair.secret().toBytes()),
  };
}

export function downloadAuditorKey(file: AuditorKeyFile) {
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `sealed-auditor-key-${file.company.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** Reads a key file and checks its secret matches its public key. */
export function parseAuditorKey(text: string): { file: AuditorKeyFile; secret: ElGamalSecretKey } {
  let file: AuditorKeyFile;
  try {
    file = JSON.parse(text) as AuditorKeyFile;
  } catch {
    throw new Error('That file is not a Sealed auditor key.');
  }
  if (file?.type !== 'sealed-auditor-key' || typeof file.secretKey !== 'string') {
    throw new Error('That file is not a Sealed auditor key.');
  }
  const secret = ElGamalSecretKey.fromBytes(fromBase64(file.secretKey));
  const pubkey = getAddressDecoder().decode(ElGamalKeypair.fromSecretKey(secret).pubkey().toBytes());
  if (pubkey !== file.elgamalPubkey) throw new Error('This auditor key file is damaged.');
  return { file, secret };
}
