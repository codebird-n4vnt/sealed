/**
 * The payroll flow in the v1 transaction format: each payment and each withdrawal is ONE
 * transaction with its proofs verified inline, and no proof accounts are created.
 *
 * Needs a cluster with the ZK ElGamal proof program that accepts v1 transactions:
 *   RPC_URL=devnet pnpm test:integration one-transaction
 * On a cluster that rejects v1 (possibly a local validator), the tests are skipped.
 */
import { join } from 'node:path';

import { getTransferSolInstruction } from '@solana-program/system';
import { fetchToken, TOKEN_2022_PROGRAM_ADDRESS } from '@solana-program/token-2022';
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
  fetchAuditedTransfers,
  fetchDecodedTransaction,
  fetchReceivedPayments,
  mintTestTokens,
  parseAmount,
  payConfidential,
  resolveRpcUrl,
  setupConfidentialAccount,
  sponsorTransaction,
  tokenAccountAddress,
  withdrawConfidential,
  ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
  type ConfidentialKeys,
  type SealedClient,
} from '../../src';
import { loadOrCreateKeypairSigner } from '../../src/node';

const RPC_URL = resolveRpcUrl(process.env.RPC_URL ?? 'localnet');
const RPC_SUBSCRIPTIONS_URL = process.env.RPC_SUBSCRIPTIONS_URL || undefined;
const EMPLOYER_KEYPAIR = join(import.meta.dirname, '..', '..', '..', '..', '.keys', 'employer.json');
const DECIMALS = 6;
const FUND = parseAmount('1000');
const PAY = parseAmount('250');
const WITHDRAW = parseAmount('100');

describe('one-transaction payroll (v1 transactions)', { timeout: 180_000 }, () => {
  let client: SealedClient;
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
  let v1Supported = true;

  const sol = async (address: Address) => (await client.rpc.getBalance(address).send()).value;

  beforeAll(async () => {
    employer = await loadOrCreateKeypairSigner(EMPLOYER_KEYPAIR);
    [employee, accountant] = await Promise.all([generateKeyPairSigner(), generateKeyPairSigner()]);
    client = await createSealedClient({
      rpcUrl: RPC_URL,
      rpcSubscriptionsUrl: RPC_SUBSCRIPTIONS_URL,
      feePayer: employer,
      transactionVersion: 1,
    });
    if ((await sol(employer.address)) < 200_000_000n) {
      await client.rpc.requestAirdrop(employer.address, lamports(1_000_000_000n)).send().catch(() => {});
    }
    // A 1-lamport v1 transaction, to find out whether this cluster accepts the format at all.
    try {
      await client.sendTransaction(getTransferSolInstruction({ source: employer, destination: employer.address, amount: 1n }));
    } catch (error) {
      if (!/version|deserializ|invalid transaction/i.test(String(error))) throw error;
      v1Supported = false;
      console.warn(`Skipping: ${RPC_URL} does not accept v1 transactions (${String(error).split('\n')[0]}).`);
      return;
    }
    [employerKeys, employeeKeys, accountantKeys] = await Promise.all([deriveKeys(employer), deriveKeys(employee), deriveKeys(accountant)]);

    const mintSigner = await generateKeyPairSigner();
    mint = mintSigner.address;
    await createPayrollMint(client, { mint: mintSigner, authority: employer, decimals: DECIMALS, auditorElgamalPubkey: accountantKeys.elgamalPubkey });

    salaryAccount = await tokenAccountAddress(employee.address, mint);
    employeeClient = await createSealedClient({
      rpcUrl: RPC_URL,
      rpcSubscriptionsUrl: RPC_SUBSCRIPTIONS_URL,
      feePayer: createRemoteSponsorSigner(employer.address, wire =>
        sponsorTransaction(wire, employer, { owner: employee.address, token: salaryAccount, mint }),
      ),
      transactionVersion: 1,
    });
    treasury = await setupConfidentialAccount(client, { owner: employer, mint, keys: employerKeys });
    await setupConfidentialAccount(employeeClient, { owner: employee, mint, keys: employeeKeys });
    await approveConfidentialAccount(client, { mint, authority: employer, owner: employer.address });
    await approveConfidentialAccount(client, { mint, authority: employer, owner: employee.address });
    await mintTestTokens(client, { mint, authority: employer, owner: employer.address, amount: FUND });
    await depositToConfidential(client, { owner: employer, mint, keys: employerKeys, amount: FUND, decimals: DECIMALS });
  }, 120_000);

  it('pays in one transaction: three inline proofs and the transfer, no proof accounts', async ({ skip }) => {
    if (!v1Supported) skip();
    const { signature } = await payConfidential(client, {
      mint,
      from: { owner: employer, keys: employerKeys },
      to: employee.address,
      amount: PAY,
      proofDelivery: 'one-transaction',
    });
    const transaction = await fetchDecodedTransaction(client, signature);
    expect(transaction.instructions.map(i => i.programAddress)).toEqual([
      ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
      ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
      ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS,
      TOKEN_2022_PROGRAM_ADDRESS,
    ]);
    expect((await fetchToken(client.rpc, salaryAccount)).data.amount).toBe(0n);
  });

  it('lets the employee and the accountant decrypt it from the chain', async ({ skip }) => {
    if (!v1Supported) skip();
    await applyPendingBalance(employeeClient, { owner: employee, mint, keys: employeeKeys });
    const [received] = await fetchReceivedPayments(employeeClient, { owner: employee.address, mint, keys: employeeKeys });
    expect(received?.amount).toBe(PAY);
    const [audited] = await fetchAuditedTransfers(client, { tokenAccount: treasury, auditorSecret: accountantKeys.elgamal.secret() });
    expect(audited?.amount).toBe(PAY);
  });

  it('withdraws in one sponsored transaction, with the employee still at 0 SOL', async ({ skip }) => {
    if (!v1Supported) skip();
    const signature = await withdrawConfidential(employeeClient, {
      owner: employee,
      mint,
      keys: employeeKeys,
      amount: WITHDRAW,
      decimals: DECIMALS,
      proofDelivery: 'one-transaction',
    });
    expect((await fetchDecodedTransaction(client, signature)).instructions).toHaveLength(3);
    expect((await fetchToken(client.rpc, salaryAccount)).data.amount).toBe(WITHDRAW);
    expect(await sol(employee.address)).toBe(0n);
  });
});
