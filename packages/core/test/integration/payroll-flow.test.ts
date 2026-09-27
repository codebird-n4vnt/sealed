/**
 * M1: the day-1 go/no-go flow in TypeScript, plus the accountant.
 *
 * An employer pays a brand-new employee (0 SOL) confidentially and covers every fee; the
 * employee decrypts and withdraws; the accountant decrypts the payment with the mint's auditor
 * key; the public sees no amount.
 *
 * Needs a cluster with the ZK ElGamal proof program:
 *   pnpm test:integration                      # Surfpool on localhost (default)
 *   RPC_URL=devnet pnpm test:integration       # devnet; the employer in .keys/ needs ~0.2 SOL
 */
import { join } from 'node:path';

import { fetchMint, fetchToken } from '@solana-program/token-2022';
import { generateKeyPairSigner, isSome, lamports, type Address, type KeyPairSigner } from '@solana/kit';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  applyPendingBalance,
  approveConfidentialAccount,
  auditTransaction,
  confidentialState,
  createPayrollMint,
  createRemoteSponsorSigner,
  createSealedClient,
  depositToConfidential,
  deriveKeys,
  fetchAuditedTransfers,
  fetchReceivedPayments,
  getConfidentialBalance,
  mintTestTokens,
  parseAmount,
  payConfidential,
  resolveRpcUrl,
  setupConfidentialAccount,
  sponsorTransaction,
  tokenAccountAddress,
  withdrawConfidential,
  type ConfidentialKeys,
  type Payment,
  type SealedClient,
} from '../../src';
import { loadOrCreateKeypairSigner } from '../../src/node';

const RPC_URL = resolveRpcUrl(process.env.RPC_URL ?? 'localnet');
const EMPLOYER_KEYPAIR = join(import.meta.dirname, '..', '..', '..', '..', '.keys', 'employer.json');
const MIN_EMPLOYER_LAMPORTS = 200_000_000n;
const DECIMALS = 6;
const FUND = parseAmount('1000');
const PAY = parseAmount('250');

describe('confidential payroll, end to end', { timeout: 180_000 }, () => {
  /** The company's client: the employer (the Payroll Vault signer) pays and signs. */
  let client: SealedClient;
  /**
   * The employee's client, as in their browser: the company sponsors fees, but only after the
   * sponsor policy approves each transaction (in the app, the server runs this check).
   */
  let employeeClient: SealedClient;
  let employer: KeyPairSigner;
  let employee: KeyPairSigner;
  let accountant: KeyPairSigner;
  let employerKeys: ConfidentialKeys;
  let employeeKeys: ConfidentialKeys;
  let accountantKeys: ConfidentialKeys;
  let mint: Address;
  let treasury: Address;
  let salaryAccount: Address;
  let payment: Payment;

  const sol = async (address: Address) => (await client.rpc.getBalance(address).send()).value;

  beforeAll(async () => {
    // The employer is persistent so devnet SOL can be topped up once; everyone else is new each run.
    employer = await loadOrCreateKeypairSigner(EMPLOYER_KEYPAIR);
    [employee, accountant] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    client = await createSealedClient({ rpcUrl: RPC_URL, feePayer: employer });

    if ((await sol(employer.address)) < MIN_EMPLOYER_LAMPORTS) {
      await client.rpc.requestAirdrop(employer.address, lamports(1_000_000_000n)).send().catch(() => {});
      for (let i = 0; i < 15 && (await sol(employer.address)) < MIN_EMPLOYER_LAMPORTS; i++) {
        await new Promise(resolve => setTimeout(resolve, 2_000));
      }
    }
    if ((await sol(employer.address)) < MIN_EMPLOYER_LAMPORTS) {
      throw new Error(`Employer ${employer.address} needs SOL on ${RPC_URL}: https://faucet.solana.com`);
    }
  }, 60_000);

  it('derives each wallet\'s keys from one signature, reproducibly', async () => {
    [employerKeys, employeeKeys, accountantKeys] = await Promise.all([
      deriveKeys(employer),
      deriveKeys(employee),
      deriveKeys(accountant),
    ]);
    const again = await deriveKeys(employee);
    expect(again.elgamalPubkey).toBe(employeeKeys.elgamalPubkey);
    expect(again.ae.toBytes()).toEqual(employeeKeys.ae.toBytes());
  });

  it('creates the company token: manual approval, accountant as auditor', async () => {
    const mintSigner = await generateKeyPairSigner();
    mint = mintSigner.address;
    await createPayrollMint(client, {
      mint: mintSigner,
      authority: employer,
      decimals: DECIMALS,
      auditorElgamalPubkey: accountantKeys.elgamalPubkey,
    });

    const { data } = await fetchMint(client.rpc, mint);
    const config = isSome(data.extensions)
      ? data.extensions.value.find(e => e.__kind === 'ConfidentialTransferMint')
      : undefined;
    expect(config).toMatchObject({
      autoApproveNewAccounts: false,
      auditorElgamalPubkey: { __option: 'Some', value: accountantKeys.elgamalPubkey },
    });
  });

  it('onboards a 0-SOL employee: they sign, the company sponsors and approves', async () => {
    salaryAccount = await tokenAccountAddress(employee.address, mint);
    const policy = { owner: employee.address, token: salaryAccount, mint };
    employeeClient = await createSealedClient({
      rpcUrl: RPC_URL,
      feePayer: createRemoteSponsorSigner(employer.address, wire => sponsorTransaction(wire, employer, policy)),
      estimateResourceLimits: false,
    });

    treasury = await setupConfidentialAccount(client, { owner: employer, mint, keys: employerKeys });
    await setupConfidentialAccount(employeeClient, { owner: employee, mint, keys: employeeKeys });
    await approveConfidentialAccount(client, { mint, authority: employer, owner: employer.address });
    await approveConfidentialAccount(client, { mint, authority: employer, owner: employee.address });

    const { data } = await fetchToken(client.rpc, salaryAccount);
    expect(confidentialState(data)).toMatchObject({ approved: true, elgamalPubkey: employeeKeys.elgamalPubkey });
    expect(await sol(employee.address)).toBe(0n);
  });

  it('funds the confidential treasury', async () => {
    await mintTestTokens(client, { mint, authority: employer, owner: employer.address, amount: FUND });
    await depositToConfidential(client, { owner: employer, mint, keys: employerKeys, amount: FUND, decimals: DECIMALS });

    const balance = await getConfidentialBalance(client, { owner: employer.address, mint, keys: employerKeys });
    expect(balance.availableBalance).toBe(FUND);
  });

  it('pays the employee without revealing the amount publicly', async () => {
    payment = await payConfidential(client, {
      mint,
      from: { owner: employer, keys: employerKeys },
      to: employee.address,
      amount: PAY,
    });
    expect(payment).toMatchObject({ sourceToken: treasury, destinationToken: salaryAccount });

    const { data } = await fetchToken(client.rpc, salaryAccount);
    expect(data.amount).toBe(0n); // the public balance
    expect(confidentialState(data)?.pendingBalanceCreditCounter).toBe(1n); // that a payment happened is public
  });

  it('lets the employee decrypt their pay', async () => {
    const balance = await getConfidentialBalance(client, { owner: employee.address, mint, keys: employeeKeys });
    expect(balance).toMatchObject({ pendingBalance: PAY, availableBalance: 0n });
  });

  it('lets the accountant decrypt the payment from the chain', async () => {
    const auditorSecret = accountantKeys.elgamal.secret();
    expect(await auditTransaction(client, { signature: payment.signature, auditorSecret })).toEqual([
      expect.objectContaining({ sourceToken: treasury, destinationToken: salaryAccount, amount: PAY }),
    ]);

    const history = await fetchAuditedTransfers(client, { tokenAccount: treasury, auditorSecret });
    expect(history.map(t => [t.signature, t.amount])).toEqual([[payment.signature, PAY]]);
  });

  it('shows the employee their payment history, decrypted locally', async () => {
    const history = await fetchReceivedPayments(employeeClient, { owner: employee.address, mint, keys: employeeKeys });
    expect(history).toEqual([expect.objectContaining({ signature: payment.signature, sourceToken: treasury, amount: PAY })]);
  });

  it('lets the employee collect and withdraw, still paying no fees', async () => {
    await applyPendingBalance(employeeClient, { owner: employee, mint, keys: employeeKeys });
    await withdrawConfidential(employeeClient, {
      owner: employee,
      mint,
      keys: employeeKeys,
      amount: PAY,
      decimals: DECIMALS,
      proofDelivery: 'inline', // no record accounts, which the sponsor policy doesn't allow
    });

    const { data } = await fetchToken(client.rpc, salaryAccount);
    expect(data.amount).toBe(PAY);
    const employerBalance = await getConfidentialBalance(client, { owner: employer.address, mint, keys: employerKeys });
    expect(employerBalance.availableBalance).toBe(FUND - PAY);
    expect(await sol(employee.address)).toBe(0n);
  });
});
