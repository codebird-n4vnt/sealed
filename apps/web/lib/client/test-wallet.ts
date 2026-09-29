'use client';

// A Wallet Standard wallet that lives in this browser, for devnet demos and testing: it lets one
// browser act as the company admin, an employee and the accountant, with no extension installed.
// Keys sit in localStorage, so never use it for anything of value.

import {
  SolanaSignMessage,
  SolanaSignTransaction,
  type SolanaSignMessageFeature,
  type SolanaSignMessageInput,
  type SolanaSignMessageOutput,
  type SolanaSignTransactionFeature,
  type SolanaSignTransactionInput,
  type SolanaSignTransactionOutput,
} from '@solana/wallet-standard-features';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressEncoder,
  getTransactionDecoder,
  getTransactionEncoder,
  signBytes,
  type KeyPairSigner,
} from '@solana/kit';
import type { Wallet, WalletAccount, WalletIcon } from '@wallet-standard/base';
import {
  StandardConnect,
  StandardDisconnect,
  StandardEvents,
  type StandardConnectFeature,
  type StandardDisconnectFeature,
  type StandardEventsFeature,
  type StandardEventsListeners,
} from '@wallet-standard/features';
import { registerWallet } from '@wallet-standard/wallet';

export const TEST_WALLET_NAME = 'Sealed Test Wallet';
const STORAGE_KEY = 'sealed:test-wallet:v1';
const CHAINS = ['solana:devnet', 'solana:localnet'] as const;
const ICON = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#1c1917"/><circle cx="16" cy="16" r="8" fill="#b8492f"/><path d="M12 16h8M16 12v8" stroke="#fff7ed" stroke-width="2" stroke-linecap="round"/></svg>',
)}` as WalletIcon;

export type TestIdentity = { label: string; seed: string };
type Stored = { active: number; identities: TestIdentity[] };

function readStore(): Stored {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Stored | null;
    if (stored && Array.isArray(stored.identities)) return stored;
  } catch {
    // Unreadable storage: start fresh.
  }
  return { active: -1, identities: [] };
}

function writeStore(stored: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode: identities last for this page only.
  }
}

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromBase64 = (text: string) => Uint8Array.from(atob(text), c => c.charCodeAt(0));

class SealedTestWallet implements Wallet {
  readonly version = '1.0.0' as const;
  readonly name = TEST_WALLET_NAME;
  readonly icon = ICON;
  readonly chains = CHAINS;
  #signer: KeyPairSigner | null = null;
  #account: WalletAccount | null = null;
  #changeListeners: StandardEventsListeners['change'][] = [];

  get accounts() {
    return this.#account ? [this.#account] : [];
  }

  get features(): StandardConnectFeature &
    StandardDisconnectFeature &
    StandardEventsFeature &
    SolanaSignMessageFeature &
    SolanaSignTransactionFeature {
    return {
      [StandardConnect]: { version: '1.0.0', connect: this.#connect },
      [StandardDisconnect]: { version: '1.0.0', disconnect: this.#disconnect },
      [StandardEvents]: { version: '1.0.0', on: this.#on },
      [SolanaSignMessage]: { version: '1.0.0', signMessage: this.#signMessage },
      [SolanaSignTransaction]: {
        version: '1.0.0',
        supportedTransactionVersions: ['legacy', 0, 1],
        signTransaction: this.#signTransaction,
      },
    };
  }

  /** The stored identities and which one is active. */
  identities(): Stored {
    return readStore();
  }

  /** Creates a new identity (a fresh keypair with 0 SOL) and makes it active. */
  async createIdentity(label: string): Promise<void> {
    const stored = readStore();
    const seed = crypto.getRandomValues(new Uint8Array(32));
    stored.identities.push({ label: label.trim() || `Identity ${stored.identities.length + 1}`, seed: toBase64(seed) });
    stored.active = stored.identities.length - 1;
    writeStore(stored);
    await this.#load(stored);
  }

  /**
   * Adds identities from a file: Sealed's `{ identities: [{ label, seed }] }` (written by the demo
   * seed script) or a Solana CLI keypair (a JSON array of 64 bytes). The last one becomes active.
   */
  async importIdentities(text: string, fallbackLabel: string): Promise<number> {
    const parsed = JSON.parse(text) as unknown;
    const incoming: TestIdentity[] = Array.isArray(parsed)
      ? [{ label: fallbackLabel, seed: toBase64(Uint8Array.from((parsed as number[]).slice(0, 32))) }]
      : ((parsed as { identities?: TestIdentity[] }).identities ?? []);
    const valid = incoming.filter(i => typeof i.seed === 'string' && fromBase64(i.seed).length === 32);
    if (valid.length === 0) throw new Error('No identities found in that file.');
    const stored = readStore();
    for (const identity of valid) {
      if (!stored.identities.some(existing => existing.seed === identity.seed)) stored.identities.push(identity);
    }
    stored.active = stored.identities.findIndex(i => i.seed === valid[valid.length - 1]!.seed);
    writeStore(stored);
    await this.#load(stored);
    return valid.length;
  }

  /** Reconnects the active identity after a reload, like an already-authorized wallet. */
  async restore(): Promise<void> {
    const stored = readStore();
    if (stored.identities[stored.active]) await this.#load(stored);
  }

  async switchTo(index: number): Promise<void> {
    const stored = readStore();
    if (!stored.identities[index]) return;
    stored.active = index;
    writeStore(stored);
    await this.#load(stored);
  }

  async #load(stored: Stored) {
    const identity = stored.identities[stored.active];
    if (!identity) {
      this.#signer = null;
      this.#account = null;
    } else {
      this.#signer = await createKeyPairSignerFromPrivateKeyBytes(fromBase64(identity.seed));
      this.#account = Object.freeze({
        address: this.#signer.address,
        publicKey: new Uint8Array(getAddressEncoder().encode(this.#signer.address)),
        chains: CHAINS,
        features: [SolanaSignMessage, SolanaSignTransaction] as const,
        label: identity.label,
      });
    }
    this.#emit();
  }

  #emit() {
    for (const listener of this.#changeListeners) listener({ accounts: this.accounts });
  }

  #connect: StandardConnectFeature[typeof StandardConnect]['connect'] = async () => {
    if (!this.#account) {
      const stored = readStore();
      if (stored.identities.length === 0) await this.createIdentity('Test wallet 1');
      else await this.#load({ ...stored, active: Math.max(0, stored.active) });
    }
    return { accounts: this.accounts };
  };

  #disconnect: StandardDisconnectFeature[typeof StandardDisconnect]['disconnect'] = async () => {
    this.#signer = null;
    this.#account = null;
    this.#emit();
  };

  // 'change' is the only Wallet Standard event.
  #on: StandardEventsFeature[typeof StandardEvents]['on'] = (_event, listener) => {
    this.#changeListeners.push(listener);
    return () => {
      this.#changeListeners = this.#changeListeners.filter(l => l !== listener);
    };
  };

  #requireSigner(address: string): KeyPairSigner {
    if (!this.#signer || this.#signer.address !== address) throw new Error('Test wallet account is not connected.');
    return this.#signer;
  }

  #signMessage = async (...inputs: readonly SolanaSignMessageInput[]): Promise<readonly SolanaSignMessageOutput[]> => {
    const outputs: SolanaSignMessageOutput[] = [];
    for (const { account, message } of inputs) {
      const signer = this.#requireSigner(account.address);
      outputs.push({ signedMessage: message, signature: await signBytes(signer.keyPair.privateKey, message) });
    }
    return outputs;
  };

  #signTransaction = async (
    ...inputs: readonly SolanaSignTransactionInput[]
  ): Promise<readonly SolanaSignTransactionOutput[]> => {
    const outputs: SolanaSignTransactionOutput[] = [];
    for (const { account, transaction } of inputs) {
      const signer = this.#requireSigner(account.address);
      const decoded = getTransactionDecoder().decode(transaction);
      const signature = await signBytes(signer.keyPair.privateKey, decoded.messageBytes);
      const signed = { ...decoded, signatures: { ...decoded.signatures, [signer.address]: signature } };
      outputs.push({ signedTransaction: new Uint8Array(getTransactionEncoder().encode(signed)) });
    }
    return outputs;
  };
}

let instance: SealedTestWallet | null = null;

/** Registers the test wallet once per page and returns it. */
export function testWallet(): SealedTestWallet {
  if (!instance) {
    instance = new SealedTestWallet();
    registerWallet(instance);
    void instance.restore();
  }
  return instance;
}
