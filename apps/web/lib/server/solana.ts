import 'server-only';

import { fetchMaybeMint, fetchMaybeToken } from '@solana-program/token-2022';
import {
  createKeyPairSignerFromPrivateKeyBytes,
  createNoopSigner,
  lamports,
  type Address,
  type KeyPairSigner,
} from '@solana/kit';

import { getCreateAssociatedTokenIdempotentInstruction } from '@solana-program/token-2022';

import {
  approveConfidentialAccount,
  confidentialState,
  createPayrollMint,
  createSealedClient,
  depositToConfidential,
  deriveKeys,
  findVaultCompanyAddress,
  getConfidentialBalance,
  getWrapInstruction,
  isVaultProgramDeployed,
  mintTestTokens,
  registerVaultBackedMint,
  setupConfidentialAccount,
  TOKEN_PROGRAM_ADDRESS,
  tokenAccountAddress,
  usdcAccountAddress,
  type ConfidentialKeys,
  type SealedClient,
} from '@sealed/core';

import { TRANSACTION_VERSION } from '../config';
import { USDC_MINT } from '../config';
import { env } from './env';
import type { CompanyDoc } from './models';
import { decryptBytes, encryptBytes } from './secrets';

/** A new keypair, returned with its encrypted seed for storage. */
export async function generateStoredKeypair(): Promise<{ address: Address; seedEnc: string }> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  return { address: signer.address, seedEnc: encryptBytes(seed) };
}

const signerCache = new Map<string, Promise<KeyPairSigner>>();
const loadSigner = (seedEnc: string) => {
  let signer = signerCache.get(seedEnc);
  if (!signer) {
    signer = createKeyPairSignerFromPrivateKeyBytes(decryptBytes(seedEnc));
    signerCache.set(seedEnc, signer);
  }
  return signer;
};

const clientCache = new Map<string, Promise<SealedClient>>();
const keysCache = new Map<string, Promise<ConfidentialKeys>>();

export type CompanyChain = {
  vault: KeyPairSigner;
  /** Signs and pays as the vault. */
  client: SealedClient;
  /** The vault's confidential-balance keys (for the treasury). */
  keys: ConfidentialKeys;
  mint: Address;
};

export async function companyChain(company: CompanyDoc): Promise<CompanyChain> {
  const vault = await loadSigner(company.vault.seedEnc);
  let client = clientCache.get(vault.address);
  if (!client) {
    client = createSealedClient({
      rpcUrl: env.rpcUrl,
      rpcSubscriptionsUrl: env.rpcSubscriptionsUrl,
      feePayer: vault,
      transactionVersion: TRANSACTION_VERSION,
    });
    clientCache.set(vault.address, client);
  }
  let keys = keysCache.get(vault.address);
  if (!keys) {
    keys = deriveKeys(vault);
    keysCache.set(vault.address, keys);
  }
  return { vault, client: await client, keys: await keys, mint: company.mint.address as Address };
}

export async function vaultSol(company: CompanyDoc): Promise<bigint> {
  const { client, vault } = await companyChain(company);
  return (await client.rpc.getBalance(vault.address).send()).value;
}

/** Devnet/localnet SOL for the vault's fees. Public devnet airdrops are often rate-limited. */
export async function airdropToVault(company: CompanyDoc): Promise<void> {
  const { client, vault } = await companyChain(company);
  const before = await vaultSol(company);
  await client.rpc.requestAirdrop(vault.address, lamports(1_000_000_000n)).send();
  for (let i = 0; i < 20 && (await vaultSol(company)) <= before; i++) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
  }
}

/**
 * Creates the company token (manual approval, the accountant's auditor key) and the vault's
 * confidential treasury account. Safe to call again after an interruption.
 */
export async function setupCompanyOnChain(company: CompanyDoc): Promise<void> {
  const { client, vault, keys, mint } = await companyChain(company);

  const existing = await fetchMaybeMint(client.rpc, mint);
  if (!existing.exists) {
    await createPayrollMint(client, {
      mint: await loadSigner(company.mint.seedEnc),
      authority: vault,
      decimals: company.decimals,
      approvePolicy: 'manual',
      auditorElgamalPubkey: company.auditorElgamalPubkey as Address,
    });
  }
  if (company.backing === 'usdc') {
    // Hand minting to the Sealed Vault (only if not done yet), and open the USDC funding account.
    const vaultPda = await findVaultCompanyAddress(mint);
    const current = existing.exists ? existing.data.mintAuthority : null;
    if (!(current && current.__option === 'Some' && current.value === vaultPda)) {
      await registerVaultBackedMint(client, { companyMint: mint, mintAuthority: vault, admin: vault, usdcMint: USDC_MINT as Address });
    }
    await client.sendTransaction(
      getCreateAssociatedTokenIdempotentInstruction({
        payer: vault,
        ata: await usdcFundingAddress(company),
        owner: vault.address,
        mint: USDC_MINT as Address,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      }),
    );
  }
  const treasury = await setupConfidentialAccount(client, { owner: vault, mint, keys });
  await approveConfidentialAccount(client, { mint, authority: vault, owner: vault.address });

  company.treasuryAccount = treasury;
  company.status = 'ready';
  await company.save();
}

/** A token account's public balance; 0 if it doesn't exist yet. */
async function tokenBalance(client: SealedClient, address: Address): Promise<bigint> {
  const account = await fetchMaybeToken(client.rpc, address);
  return account.exists ? account.data.amount : 0n;
}

/** Where a USDC-backed company receives USDC before it's wrapped into the treasury. */
export async function usdcFundingAddress(company: CompanyDoc): Promise<Address> {
  return usdcAccountAddress(company.vault.address as Address, USDC_MINT as Address);
}

let vaultDeployed: Promise<boolean> | null = null;

/** Whether USDC backing is available here: the Sealed Vault program is deployed on this cluster. */
export async function vaultAvailable(): Promise<boolean> {
  vaultDeployed ??= createSealedClient({ rpcUrl: env.rpcUrl, feePayer: createNoopSigner(USDC_MINT as Address) })
    .then(isVaultProgramDeployed)
    .catch(() => {
      vaultDeployed = null;
      return false;
    });
  return vaultDeployed;
}

export type TreasuryBalances = {
  /** USDC received at the funding address, not yet wrapped (USDC-backed companies). */
  usdcWaiting?: bigint;
  /** Test tokens not yet moved into the confidential balance (public). */
  public: bigint;
  /** Available to pay out. Only the company can decrypt this. */
  confidential: bigint;
  pending: bigint;
  sol: bigint;
};

export async function treasuryBalances(company: CompanyDoc): Promise<TreasuryBalances> {
  const { client, vault, keys, mint } = await companyChain(company);
  const token = await tokenAccountAddress(vault.address, mint);
  const account = await fetchMaybeToken(client.rpc, token);
  const sol = await vaultSol(company);
  const usdcWaiting = company.backing === 'usdc' ? await tokenBalance(client, await usdcFundingAddress(company)) : undefined;
  if (!account.exists || !confidentialState(account.data)) return { usdcWaiting, public: 0n, confidential: 0n, pending: 0n, sol };
  const balance = await getConfidentialBalance(client, { owner: vault.address, mint, keys });
  return { usdcWaiting, public: account.data.amount, confidential: balance.availableBalance, pending: balance.pendingBalance, sol };
}

/**
 * USDC-backed companies: wraps all the USDC waiting at the funding address into company tokens
 * (1:1, through the Sealed Vault) and moves them into the confidential treasury.
 */
export async function wrapIntoTreasury(company: CompanyDoc): Promise<bigint> {
  const { client, vault, keys, mint } = await companyChain(company);
  const funding = await usdcFundingAddress(company);
  const amount = await tokenBalance(client, funding);
  if (amount === 0n) return 0n;
  await client.sendTransaction(
    await getWrapInstruction({
      depositor: vault,
      companyMint: mint,
      usdcMint: USDC_MINT as Address,
      depositorUsdc: funding,
      recipientToken: await tokenAccountAddress(vault.address, mint),
      amount,
    }),
  );
  await depositToConfidential(client, { owner: vault, mint, keys, amount, decimals: company.decimals });
  return amount;
}

/**
 * Devnet only: mints test stablecoins to the treasury and moves them into its confidential
 * balance. In production the Sealed Vault program would wrap USDC 1:1 instead.
 * The funded total is public; each person's share of it is not.
 */
export async function fundTreasury(company: CompanyDoc, amount: bigint): Promise<void> {
  const { client, vault, keys, mint } = await companyChain(company);
  await mintTestTokens(client, { mint, authority: vault, owner: vault.address, amount });
  await depositToConfidential(client, { owner: vault, mint, keys, amount, decimals: company.decimals });
}

/** Whether `wallet`'s token account for the company is configured and approved. */
export async function memberAccountState(company: CompanyDoc, wallet: string) {
  const { client, mint } = await companyChain(company);
  const token = await tokenAccountAddress(wallet as Address, mint);
  const account = await fetchMaybeToken(client.rpc, token);
  const state = account.exists ? confidentialState(account.data) : undefined;
  return { token, configured: !!state, approved: !!state?.approved };
}

/** Approves a member's configured account (the company token uses manual approval). */
export async function approveMemberAccount(company: CompanyDoc, wallet: string): Promise<void> {
  const { client, vault, mint } = await companyChain(company);
  await approveConfidentialAccount(client, { mint, authority: vault, owner: wallet as Address });
}
