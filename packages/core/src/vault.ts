/**
 * Client for the Sealed Vault program (programs/sealed-vault): backs a company's confidential
 * payroll token 1:1 with USDC. `wrap` takes USDC in and mints company tokens; `unwrap` burns them
 * and pays USDC out. The program checks supply == USDC held after every instruction.
 */
import {
  AuthorityType,
  fetchMint,
  fetchToken,
  getSetAuthorityInstruction,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';
import {
  AccountRole,
  getAddressEncoder,
  getProgramDerivedAddress,
  getU64Encoder,
  some,
  type Address,
  type Instruction,
  type Signature,
  type TransactionSigner,
} from '@solana/kit';

import type { SealedClient } from './client';

export const SEALED_VAULT_PROGRAM_ADDRESS = 'CTfg335Wow4yDCZGizkDnFk3SCT2GChkNsZVicTgbffm' as Address;
/** The classic SPL Token program, which USDC uses. */
export const TOKEN_PROGRAM_ADDRESS = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA' as Address;
const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111' as Address;

// Anchor instruction discriminators, from target/idl/sealed_vault.json.
const INIT_COMPANY = new Uint8Array([4, 20, 200, 152, 94, 207, 211, 98]);
const WRAP = new Uint8Array([178, 40, 10, 189, 228, 129, 186, 140]);
const UNWRAP = new Uint8Array([126, 175, 198, 14, 212, 69, 50, 44]);

export const VAULT_ERRORS: Record<number, string> = {
  6000: 'Amount must be greater than zero',
  6001: "The company token's mint authority must be the company vault PDA",
  6002: 'The company token must start with zero supply',
  6003: 'The company token must have the same decimals as USDC',
  6004: 'Company tokens must use the Token-2022 program',
  6005: 'Company token supply must equal the USDC held in the vault',
};

const encoder = getAddressEncoder();

/** The company's vault account (the mint authority of its token). */
export async function findVaultCompanyAddress(companyMint: Address, programAddress = SEALED_VAULT_PROGRAM_ADDRESS) {
  const [address] = await getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode('company'), encoder.encode(companyMint)],
  });
  return address;
}

/** The program-owned USDC account backing the company's token. */
export async function findUsdcVaultAddress(company: Address, programAddress = SEALED_VAULT_PROGRAM_ADDRESS) {
  const [address] = await getProgramDerivedAddress({
    programAddress,
    seeds: [new TextEncoder().encode('usdc_vault'), encoder.encode(company)],
  });
  return address;
}

const readonly = (address: Address) => ({ address, role: AccountRole.READONLY });
const writable = (address: Address) => ({ address, role: AccountRole.WRITABLE });
const signer = (account: TransactionSigner, role: AccountRole) => ({ address: account.address, role, signer: account });
const amountData = (discriminator: Uint8Array, amount: bigint) =>
  new Uint8Array([...discriminator, ...getU64Encoder().encode(amount)]);

export async function getInitCompanyInstruction(input: {
  admin: TransactionSigner;
  companyMint: Address;
  usdcMint: Address;
  usdcTokenProgram?: Address;
}): Promise<Instruction> {
  const company = await findVaultCompanyAddress(input.companyMint);
  return {
    programAddress: SEALED_VAULT_PROGRAM_ADDRESS,
    accounts: [
      signer(input.admin, AccountRole.WRITABLE_SIGNER),
      writable(company),
      readonly(input.companyMint),
      readonly(input.usdcMint),
      writable(await findUsdcVaultAddress(company)),
      readonly(TOKEN_2022_PROGRAM_ADDRESS),
      readonly(input.usdcTokenProgram ?? TOKEN_PROGRAM_ADDRESS),
      readonly(SYSTEM_PROGRAM_ADDRESS),
    ],
    data: INIT_COMPANY,
  };
}

export async function getWrapInstruction(input: {
  depositor: TransactionSigner;
  companyMint: Address;
  usdcMint: Address;
  depositorUsdc: Address;
  recipientToken: Address;
  amount: bigint;
  usdcTokenProgram?: Address;
}): Promise<Instruction> {
  const company = await findVaultCompanyAddress(input.companyMint);
  return {
    programAddress: SEALED_VAULT_PROGRAM_ADDRESS,
    accounts: [
      signer(input.depositor, AccountRole.READONLY_SIGNER),
      readonly(company),
      writable(input.companyMint),
      readonly(input.usdcMint),
      writable(await findUsdcVaultAddress(company)),
      writable(input.depositorUsdc),
      writable(input.recipientToken),
      readonly(TOKEN_2022_PROGRAM_ADDRESS),
      readonly(input.usdcTokenProgram ?? TOKEN_PROGRAM_ADDRESS),
    ],
    data: amountData(WRAP, input.amount),
  };
}

export async function getUnwrapInstruction(input: {
  holder: TransactionSigner;
  companyMint: Address;
  usdcMint: Address;
  holderToken: Address;
  recipientUsdc: Address;
  amount: bigint;
  usdcTokenProgram?: Address;
}): Promise<Instruction> {
  const company = await findVaultCompanyAddress(input.companyMint);
  return {
    programAddress: SEALED_VAULT_PROGRAM_ADDRESS,
    accounts: [
      signer(input.holder, AccountRole.READONLY_SIGNER),
      readonly(company),
      writable(input.companyMint),
      readonly(input.usdcMint),
      writable(await findUsdcVaultAddress(company)),
      writable(input.holderToken),
      writable(input.recipientUsdc),
      readonly(TOKEN_2022_PROGRAM_ADDRESS),
      readonly(input.usdcTokenProgram ?? TOKEN_PROGRAM_ADDRESS),
    ],
    data: amountData(UNWRAP, input.amount),
  };
}

/**
 * Hands a new payroll mint's mint authority to the vault and registers it. After this, company
 * tokens can only come into existence by wrapping USDC.
 */
export async function registerVaultBackedMint(
  client: SealedClient,
  input: { companyMint: Address; mintAuthority: TransactionSigner; admin: TransactionSigner; usdcMint: Address; usdcTokenProgram?: Address },
): Promise<Signature> {
  const result = await client.sendTransaction([
    getSetAuthorityInstruction(
      {
        owned: input.companyMint,
        owner: input.mintAuthority,
        authorityType: AuthorityType.MintTokens,
        newAuthority: some(await findVaultCompanyAddress(input.companyMint)),
      },
      { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
    ),
    await getInitCompanyInstruction(input),
  ]);
  return result.context.signature;
}

/** Company token supply and the USDC backing it; equal whenever the vault is healthy. */
export async function fetchVaultBacking(client: SealedClient, companyMint: Address) {
  const company = await findVaultCompanyAddress(companyMint);
  const [{ data: mint }, { data: vault }] = await Promise.all([
    fetchMint(client.rpc, companyMint),
    fetchToken(client.rpc, await findUsdcVaultAddress(company)),
  ]);
  return { supply: mint.supply, usdcHeld: vault.amount };
}
