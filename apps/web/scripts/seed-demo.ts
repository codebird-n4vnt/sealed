/**
 * Seeds the demo company: Acme DAO with a 10-person team.
 *
 * - Nine people are fully onboarded (private accounts configured, sponsored and approved), and
 *   last month's payroll run is already paid to them, so the accountant view has history.
 * - Priya is invited but not onboarded, so the video can show her joining with 0 SOL.
 * - Wallets and the auditor key are written to .keys/demo/ (gitignored). The admin and accountant
 *   are also written as test-wallet identities, to import in the browser's test wallet menu.
 *
 * Usage (from the repo root, with MongoDB and the cluster running):
 *   pnpm seed
 *   pnpm seed --admin <ADDRESS> --accountant <ADDRESS>   # your own wallets; skips the paid history
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  createKeyPairSignerFromPrivateKeyBytes,
  getAddressDecoder,
  getAddressEncoder,
  isAddress,
  signBytes,
  type KeyPairSigner,
} from '@solana/kit';
import { ElGamalKeypair } from '@solana/zk-sdk/bundler';
import mongoose from 'mongoose';

import {
  createRemoteSponsorSigner,
  createSealedClient,
  deriveKeys,
  parseAmount,
  setupConfidentialAccount,
  sponsorTransaction,
  tokenAccountAddress,
} from '@sealed/core';

import { connectDb } from '../lib/server/db';
import { env } from '../lib/server/env';
import { Company, Member, PayrollRun } from '../lib/server/models';
import { draftPayrollRun, processRun } from '../lib/server/payroll';
import { encryptAmount } from '../lib/server/secrets';
import {
  airdropToVault,
  approveMemberAccount,
  companyChain,
  fundTreasury,
  generateStoredKeypair,
  setupCompanyOnChain,
  vaultSol,
} from '../lib/server/solana';

const TEAM: Array<[name: string, salary: string]> = [
  ['Priya Sharma', '4200'],
  ['Arjun Mehta', '5100'],
  ['Sara Lindqvist', '6300'],
  ['Kwame Mensah', '4800'],
  ['Lucía Fernández', '5600'],
  ['Wei Chen', '7200'],
  ['Aisha Rahman', '3900'],
  ['Tom Becker', '4500'],
  ['Neha Iyer', '5400'],
  ['Diego Alvarez', '3600'],
];
const LIVE_ONBOARDING = 'Priya Sharma';
const TREASURY = '150000';

const { values: args } = parseArgs({
  options: {
    admin: { type: 'string' },
    accountant: { type: 'string' },
    name: { type: 'string', default: 'Acme DAO' },
    'app-url': { type: 'string', default: 'http://localhost:3000' },
  },
});

const KEYS = join(import.meta.dirname, '..', '..', '..', '.keys', 'demo');
const slug = (text: string) => text.normalize('NFD').replace(/[^\w\s-]/g, '').trim().toLowerCase().replace(/\s+/g, '-');
const log = (message: string) => console.log(`\x1b[36m›\x1b[0m ${message}`);

/** A fresh keypair, saved as a CLI keypair file and returned with its seed. */
async function newWallet(file: string): Promise<{ signer: KeyPairSigner; seed: Uint8Array }> {
  const seed = crypto.getRandomValues(new Uint8Array(32));
  const signer = await createKeyPairSignerFromPrivateKeyBytes(seed);
  const publicKey = getAddressEncoder().encode(signer.address);
  mkdirSync(join(file, '..'), { recursive: true, mode: 0o700 });
  writeFileSync(file, JSON.stringify([...seed, ...publicKey]), { mode: 0o600 });
  return { signer, seed };
}

async function main() {
  if (args.admin && !isAddress(args.admin)) throw new Error('--admin must be a wallet address.');
  if (args.accountant && !isAddress(args.accountant)) throw new Error('--accountant must be a wallet address.');
  await connectDb();
  mkdirSync(KEYS, { recursive: true, mode: 0o700 });

  const identities: Array<{ label: string; seed: string }> = [];
  const admin = args.admin ? null : await newWallet(join(KEYS, 'admin.json'));
  const accountant = args.accountant ? null : await newWallet(join(KEYS, 'accountant.json'));
  if (admin) identities.push({ label: `${args.name} admin`, seed: Buffer.from(admin.seed).toString('base64') });
  if (accountant) identities.push({ label: `${args.name} accountant`, seed: Buffer.from(accountant.seed).toString('base64') });
  const adminWallet = args.admin ?? admin!.signer.address;
  const accountantWallet = args.accountant ?? accountant!.signer.address;

  // The accountant's auditor key, as the dashboard would download it.
  const auditor = new ElGamalKeypair();
  const auditorPubkey = getAddressDecoder().decode(auditor.pubkey().toBytes());

  log(`Creating ${args.name} on ${env.rpcUrl}`);
  const company = await Company.create({
    name: args.name,
    symbol: 'sUSD',
    adminWallet,
    accountantWallets: [accountantWallet],
    auditorElgamalPubkey: auditorPubkey,
    vault: await generateStoredKeypair(),
    mint: await generateStoredKeypair(),
  });
  const auditorFile = join(KEYS, `auditor-key-${slug(args.name)}.json`);
  writeFileSync(
    auditorFile,
    JSON.stringify(
      {
        type: 'sealed-auditor-key',
        version: 1,
        company: { id: company.id, name: company.name },
        elgamalPubkey: auditorPubkey,
        secretKey: Buffer.from(auditor.secret().toBytes()).toString('base64'),
        createdAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );

  log(`Funding the payroll vault ${company.vault.address} with test SOL`);
  for (let attempt = 0; attempt < 3 && (await vaultSol(company)) < 500_000_000n; attempt++) {
    await airdropToVault(company).catch(() => {});
  }
  if ((await vaultSol(company)) < 200_000_000n) {
    log(`The airdrop was rate-limited. Send 1 devnet SOL to ${company.vault.address} (faucet.solana.com). Waiting up to 10 minutes…`);
    for (let i = 0; i < 120 && (await vaultSol(company)) < 200_000_000n; i++) {
      await new Promise(resolve => setTimeout(resolve, 5_000));
    }
    if ((await vaultSol(company)) < 200_000_000n) throw new Error('The payroll vault was not funded.');
  }

  log('Creating the company token and confidential treasury');
  await setupCompanyOnChain(company);
  log(`Funding the treasury with ${TREASURY} sUSD`);
  await fundTreasury(company, parseAmount(TREASURY));

  const { vault, mint } = await companyChain(company);
  const invites: string[] = [];
  for (const [name, salary] of TEAM) {
    const member = new Member({
      companyId: company._id,
      name,
      email: `${slug(name).split('-')[0]}@acme.example`,
      salaryEnc: encryptAmount(parseAmount(salary)),
      inviteToken: Buffer.from(crypto.getRandomValues(new Uint8Array(18))).toString('base64url'),
    });
    if (name === LIVE_ONBOARDING) {
      await member.save();
      invites.push(`${name}: ${args['app-url']}/join/${member.inviteToken}`);
      continue;
    }

    log(`Onboarding ${name}`);
    const { signer: employee } = await newWallet(join(KEYS, 'team', `${slug(name)}.json`));
    const keys = await deriveKeys(employee);
    const token = await tokenAccountAddress(employee.address, mint);
    // Exactly the browser's path: the company sponsors fees, after the sponsor policy approves.
    const client = await createSealedClient({
      rpcUrl: env.rpcUrl,
      feePayer: createRemoteSponsorSigner(vault.address, wire =>
        sponsorTransaction(wire, vault, { owner: employee.address, token, mint }),
      ),
      estimateResourceLimits: false,
    });
    await setupConfidentialAccount(client, { owner: employee, mint, keys });
    await approveMemberAccount(company, employee.address);
    Object.assign(member, {
      wallet: employee.address,
      status: 'ready',
      tokenAccount: token,
      joinedAt: new Date(),
      readyAt: new Date(),
    });
    await member.save();
  }

  if (admin) {
    log("Paying last month's payroll (9 people) through the payroll engine");
    const { run } = await draftPayrollRun(company, adminWallet);
    if (!run?.approval?.message) throw new Error('Nothing to pay.');
    const signature = await signBytes(admin.signer.keyPair.privateKey, new TextEncoder().encode(run.approval.message));
    await PayrollRun.updateOne(
      { _id: run._id },
      {
        status: 'running',
        startedAt: new Date(),
        heartbeatAt: new Date(),
        'approval.signature': Buffer.from(signature).toString('base64'),
        'approval.wallet': adminWallet,
      },
    );
    await processRun(run.id);
    const finished = await PayrollRun.findById(run._id);
    log(`Run finished: ${finished?.status}`);
  }

  if (identities.length > 0) {
    writeFileSync(join(KEYS, 'test-wallet-identities.json'), JSON.stringify({ identities }, null, 2), { mode: 0o600 });
  }

  console.log(`
\x1b[1;32mSeeded ${company.name}.\x1b[0m
  Dashboard:        ${args['app-url']}/company/${company.id}
  Admin wallet:     ${adminWallet}
  Accountant:       ${accountantWallet}
  Auditor key file: ${auditorFile}
  Live onboarding:  ${invites.join('\n                    ')}
${identities.length > 0 ? `  Test wallet:      import ${join(KEYS, 'test-wallet-identities.json')} from the wallet menu\n` : ''}`);
}

main()
  .catch(error => {
    console.error(`\x1b[31m${error instanceof Error ? error.message : error}\x1b[0m`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
