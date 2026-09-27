'use client';

import {
  SelectedWalletAccountContextProvider,
  useSelectedWalletAccount,
  useSignMessage,
  useWalletAccountTransactionSigner,
} from '@solana/react';
import type { Address, MessagePartialSigner, SignatureBytes } from '@solana/kit';
import type { UiWallet, UiWalletAccount } from '@wallet-standard/react';
import { useEffect, useMemo, type ReactNode } from 'react';

import { TEST_WALLET_ENABLED, WALLET_CHAIN } from '../config';
import { TEST_WALLET_NAME, testWallet } from './test-wallet';

const STORAGE_KEY = 'sealed:selected-wallet';

const supportsSealed = (wallet: UiWallet) =>
  wallet.chains.includes(WALLET_CHAIN) &&
  wallet.features.includes('solana:signMessage') &&
  wallet.features.includes('solana:signTransaction');

export function WalletProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (TEST_WALLET_ENABLED) testWallet();
  }, []);
  return (
    <SelectedWalletAccountContextProvider
      filterWallets={supportsSealed}
      stateSync={{
        getSelectedWallet: () => safeStorage(() => localStorage.getItem(STORAGE_KEY)) ?? null,
        storeSelectedWallet: key => safeStorage(() => localStorage.setItem(STORAGE_KEY, key)),
        deleteSelectedWallet: () => safeStorage(() => localStorage.removeItem(STORAGE_KEY)),
      }}
    >
      <TestWalletSync />
      {children}
    </SelectedWalletAccountContextProvider>
  );
}

/**
 * Keeps the selection on the test wallet's active identity when it is the chosen wallet, across
 * reloads and identity switches (its address changes, which would otherwise drop the selection).
 */
function TestWalletSync() {
  const [account, setAccount, wallets] = useSelectedWalletAccount();
  const testAccount = wallets.find(wallet => wallet.name === TEST_WALLET_NAME)?.accounts[0];
  useEffect(() => {
    if (!testAccount || account?.address === testAccount.address) return;
    const stored = safeStorage(() => localStorage.getItem(STORAGE_KEY));
    if (stored?.startsWith(`${TEST_WALLET_NAME}:`)) setAccount(testAccount);
  }, [account?.address, testAccount, setAccount]);
  return null;
}

function safeStorage<T>(action: () => T): T | undefined {
  try {
    return action();
  } catch {
    return undefined;
  }
}

/** The connected wallet account (if any), a setter, and the wallets that support Sealed. */
export function useWallet() {
  const [account, setAccount, wallets] = useSelectedWalletAccount();
  return { account, setAccount, wallets };
}

/**
 * Adapts the wallet's signMessage to the MessagePartialSigner that key derivation expects,
 * refusing wallets that alter the message (that would derive different keys).
 */
export function useMessageSigner(account: UiWalletAccount): MessagePartialSigner {
  const signMessage = useSignMessage(account);
  return useMemo(
    () => ({
      address: account.address as Address,
      async signMessages(messages) {
        const results = [];
        for (const message of messages) {
          const content = new Uint8Array(message.content);
          const { signature, signedMessage } = await signMessage({ message: content });
          if (signedMessage.length !== content.length || signedMessage.some((byte, i) => byte !== content[i])) {
            throw new Error('Your wallet changed the message before signing it, so it cannot be used here.');
          }
          results.push({ [account.address]: signature as SignatureBytes });
        }
        return results;
      },
    }),
    [account.address, signMessage],
  );
}

/** The wallet as a transaction signer for the Sealed network. */
export function useTransactionSigner(account: UiWalletAccount) {
  return useWalletAccountTransactionSigner(account, WALLET_CHAIN);
}

/** Signs arbitrary text with the wallet (sign-in, payroll approval). Returns the signature. */
export function useSignText(account: UiWalletAccount) {
  const signMessage = useSignMessage(account);
  return async (text: string) => {
    const message = new TextEncoder().encode(text);
    const { signature, signedMessage } = await signMessage({ message });
    if (new TextDecoder().decode(signedMessage) !== text) throw new Error('Your wallet changed the message before signing it.');
    return signature;
  };
}
