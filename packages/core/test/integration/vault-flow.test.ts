/**
 * M5: USDC in → confidential payroll → USDC out, through the Sealed Vault program.
 *
 * Needs the program deployed to the cluster (Surfpool by default):
 *   solana program deploy target/deploy/sealed_vault.so --program-id target/deploy/sealed_vault-keypair.json -u localhost
 * A test "USDC" mint on the classic SPL Token program stands in for USDC.
 */
import { join } from 'node:path';

import { getCreateAccountInstruction } from '@solana-program/system';
import {
  findAssociatedTokenPda as findClassicAta,
  getCreateAssociatedTokenIdempotentInstruction as getCreateClassicAtaInstruction,
  getInitializeMint2Instruction as getInitializeClassicMintInstruction,
  getMintToInstruction as getClassicMintToInstruction,
} from '@solana-program/token';
import { fetchToken, getMintToInstruction, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
import { generateKeyPairSigner, lamports, type Address, type KeyPairSigner } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  applyPendingBalance,
  approveConfidentialAccount,
  createPayrollMint,
  createRemoteSponsorSigner,
  createSealedClient,
  depositToConfidential,
  deriveKeys,
  fetchVaultBacking,
  findUsdcVaultAddress,
  findVaultCompanyAddress,
  getConfidentialBalance,
  getInitCompanyInstruction,
  getUnwrapInstruction,
  getWrapInstruction,
  parseAmount,
  payConfidential,
  registerVaultBackedMint,
  resolveRpcUrl,
  SEALED_VAULT_PROGRAM_ADDRESS,
  setupConfidentialAccount,
  sponsorTransaction,
  TOKEN_PROGRAM_ADDRESS,
  tokenAccountAddress,
  withdrawConfidential,
  type ConfidentialKeys,
  type SealedClient,
} from '../../src';
import { loadOrCreateKeypairSigner } from '../../src/node';

const RPC_URL = resolveRpcUrl(process.env.RPC_URL ?? 'localnet');
const RPC_SUBSCRIPTIONS_URL = process.env.RPC_SUBSCRIPTIONS_URL || undefined;
const EMPLOYER_KEYPAIR = join(import.meta.dirname, '..', '..', '..', '..', '.keys', 'employer.json');
const DECIMALS = 6;
const USDC_IN = parseAmount('1000');
const SALARY = parseAmount('250');

describe('Sealed Vault: USDC in, confidential payroll, USDC out', { timeout: 180_000 }, () => {
  let client: SealedClient;
  let employer: KeyPairSigner;
  let employee: KeyPairSigner;
  let employerKeys: ConfidentialKeys;
  let employeeKeys: ConfidentialKeys;
  let usdcMint: Address;
  let companyMint: Address;
  let employerUsdc: Address;
  let employeeUsdc: Address;
  let treasury: Address;
  let employeeToken: Address;
  let deployed = false;

  const usdcBalance = async (account: Address) => (await fetchToken(client.rpc, account)).data.amount;

  beforeAll(async () => {
    employer = await loadOrCreateKeypairSigner(EMPLOYER_KEYPAIR);
    employee = await generateKeyPairSigner();
    client = await createSealedClient({ rpcUrl: RPC_URL, rpcSubscriptionsUrl: RPC_SUBSCRIPTIONS_URL, feePayer: employer });
    deployed = (await client.rpc.getAccountInfo(SEALED_VAULT_PROGRAM_ADDRESS, { encoding: 'base64' }).send()).value?.executable ?? false;
    if (!deployed) return;
    if ((await client.rpc.getBalance(employer.address).send()).value < 500_000_000n) {
      await client.rpc.requestAirdrop(employer.address, lamports(2_000_000_000n)).send();
    }
    [employerKeys, employeeKeys] = await Promise.all([deriveKeys(employer), deriveKeys(employee)]);

    // A test USDC mint on the classic token program, and 1,000 USDC for the company.
    const usdc = await generateKeyPairSigner();
    usdcMint = usdc.address;
    [employerUsdc] = await findClassicAta({ owner: employer.address, mint: usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    [employeeUsdc] = await findClassicAta({ owner: employee.address, mint: usdcMint, tokenProgram: TOKEN_PROGRAM_ADDRESS });
    await client.sendTransaction([
      getCreateAccountInstruction({
        payer: employer,
        newAccount: usdc,
        lamports: await client.rpc.getMinimumBalanceForRentExemption(82n).send(),
        space: 82,
        programAddress: TOKEN_PROGRAM_ADDRESS,
      }),
      getInitializeClassicMintInstruction({ mint: usdcMint, decimals: DECIMALS, mintAuthority: employer.address }),
      getCreateClassicAtaInstruction({ payer: employer, ata: employerUsdc, owner: employer.address, mint: usdcMint }),
      getCreateClassicAtaInstruction({ payer: employer, ata: employeeUsdc, owner: employee.address, mint: usdcMint }),
      getClassicMintToInstruction({ mint: usdcMint, token: employerUsdc, mintAuthority: employer, amount: USDC_IN }),
    ]);
  }, 60_000);

  it('registers a vault-backed company token', async ({ skip }) => {
    if (!deployed) skip();
    const mint = await generateKeyPairSigner();
    companyMint = mint.address;
    await createPayrollMint(client, { mint, authority: employer, decimals: DECIMALS });
    await registerVaultBackedMint(client, { companyMint, mintAuthority: employer, admin: employer, usdcMint });
    expect(await fetchVaultBacking(client, companyMint)).toEqual({ supply: 0n, usdcHeld: 0n });
  });

  it('wraps USDC 1:1 into the confidential treasury', async ({ skip }) => {
    if (!deployed) skip();
    treasury = await setupConfidentialAccount(client, { owner: employer, mint: companyMint, keys: employerKeys });
    await approveConfidentialAccount(client, { mint: companyMint, authority: employer, owner: employer.address });
    await client.sendTransaction(
      await getWrapInstruction({
        depositor: employer,
        companyMint,
        usdcMint,
        depositorUsdc: employerUsdc,
        recipientToken: treasury,
        amount: USDC_IN,
      }),
    );
    expect(await usdcBalance(employerUsdc)).toBe(0n);
    expect(await fetchVaultBacking(client, companyMint)).toEqual({ supply: USDC_IN, usdcHeld: USDC_IN });

    await depositToConfidential(client, { owner: employer, mint: companyMint, keys: employerKeys, amount: USDC_IN, decimals: DECIMALS });
    const balance = await getConfidentialBalance(client, { owner: employer.address, mint: companyMint, keys: employerKeys });
    expect(balance.availableBalance).toBe(USDC_IN);
  });

  it('pays an employee confidentially, who withdraws and unwraps to USDC with 0 SOL', async ({ skip }) => {
    if (!deployed) skip();
    employeeToken = await tokenAccountAddress(employee.address, companyMint);
    const employeeClient = await createSealedClient({
      rpcUrl: RPC_URL,
      rpcSubscriptionsUrl: RPC_SUBSCRIPTIONS_URL,
      feePayer: createRemoteSponsorSigner(employer.address, wire =>
        sponsorTransaction(wire, employer, { owner: employee.address, token: employeeToken, mint: companyMint }),
      ),
      estimateResourceLimits: false,
    });
    await setupConfidentialAccount(employeeClient, { owner: employee, mint: companyMint, keys: employeeKeys });
    await approveConfidentialAccount(client, { mint: companyMint, authority: employer, owner: employee.address });

    await payConfidential(client, { mint: companyMint, from: { owner: employer, keys: employerKeys }, to: employee.address, amount: SALARY });
    await applyPendingBalance(employeeClient, { owner: employee, mint: companyMint, keys: employeeKeys });
    await withdrawConfidential(employeeClient, { owner: employee, mint: companyMint, keys: employeeKeys, amount: SALARY, decimals: DECIMALS, proofDelivery: 'inline' });

    // The employee signs the unwrap; the company pays its fee.
    await client.sendTransaction(
      await getUnwrapInstruction({ holder: employee, companyMint, usdcMint, holderToken: employeeToken, recipientUsdc: employeeUsdc, amount: SALARY }),
    );
    expect(await usdcBalance(employeeUsdc)).toBe(SALARY);
    expect((await fetchToken(client.rpc, employeeToken)).data.amount).toBe(0n);
    expect(await fetchVaultBacking(client, companyMint)).toEqual({ supply: USDC_IN - SALARY, usdcHeld: USDC_IN - SALARY });
    expect((await client.rpc.getBalance(employee.address).send()).value).toBe(0n);
  });

  it('refuses to mint company tokens outside the vault', async ({ skip }) => {
    if (!deployed) skip();
    const attempt = client.sendTransaction(
      getMintToInstruction(
        { mint: companyMint, token: treasury, mintAuthority: employer, amount: 1_000_000n },
        { programAddress: TOKEN_2022_PROGRAM_ADDRESS },
      ),
    );
    await expect(attempt).rejects.toThrow();
    expect(await fetchVaultBacking(client, companyMint)).toEqual({ supply: USDC_IN - SALARY, usdcHeld: USDC_IN - SALARY });
  });

  it('refuses to register a token whose mint authority was not handed to the vault', async ({ skip }) => {
    if (!deployed) skip();
    const mint = await generateKeyPairSigner();
    await createPayrollMint(client, { mint, authority: employer, decimals: DECIMALS });
    // init_company alone, with the employer still able to mint.
    const attempt = client.sendTransaction(await getInitCompanyInstruction({ admin: employer, companyMint: mint.address, usdcMint }));
    await expect(attempt).rejects.toThrow();
  });

  it("refuses to redeem one company's tokens against another company's vault", async ({ skip }) => {
    if (!deployed) skip();
    // A second company with its own backing.
    const other = await generateKeyPairSigner();
    await createPayrollMint(client, { mint: other, authority: employer, decimals: DECIMALS });
    await registerVaultBackedMint(client, { companyMint: other.address, mintAuthority: employer, admin: employer, usdcMint });
    const otherVault = await findUsdcVaultAddress(await findVaultCompanyAddress(other.address));

    // The treasury holds company tokens; point the unwrap at the other company's vault.
    const unwrap = await getUnwrapInstruction({ holder: employer, companyMint, usdcMint, holderToken: treasury, recipientUsdc: employerUsdc, amount: 1n });
    const accounts = [...unwrap.accounts!];
    accounts[4] = { ...accounts[4]!, address: otherVault };
    await expect(client.sendTransaction({ ...unwrap, accounts })).rejects.toThrow();
    expect(await fetchVaultBacking(client, companyMint)).toEqual({ supply: USDC_IN - SALARY, usdcHeld: USDC_IN - SALARY });
  });

  it('refuses to unwrap more than the holder has', async ({ skip }) => {
    if (!deployed) skip();
    const attempt = client.sendTransaction(
      await getUnwrapInstruction({ holder: employee, companyMint, usdcMint, holderToken: employeeToken, recipientUsdc: employeeUsdc, amount: 1n }),
    );
    await expect(attempt).rejects.toThrow();
    expect(await usdcBalance(employeeUsdc)).toBe(SALARY);
  });
});
