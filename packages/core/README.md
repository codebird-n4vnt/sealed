# @sealed/core

A TypeScript toolkit for Solana **Confidential Balances** (Token-2022), built for payroll and
usable for any app that moves confidential tokens. It sits on `@solana/kit`,
`@solana-program/token-2022` and `@solana/zk-sdk`, and adds what an app needs on top of the
low-level instructions:

- **One-transaction transfers and withdrawals** in the v1 transaction format: the proofs are
  verified inline and read through the instructions sysvar, so there are no proof accounts to fund
  and close. On devnet a transfer is 2,395 bytes and 238k compute units.
- **Fee sponsorship with a policy.** Users sign; a server co-signs as fee payer only after checking
  the transaction can spend its SOL on nothing but the user's own confidential account. The policy
  is unit-tested against the attacks it must refuse.
- **Decryption from chain history**, for the recipient (from the ciphertext-validity proof) and for
  the mint's auditor (from the transfer data), with an optional cache for rate-limited RPCs.
- **Keys from a wallet signature**, byte for byte the derivation the `spl-token` CLI uses.
- A client for the **Sealed Vault** program, which backs a confidential token 1:1 with USDC.

Everything here is exercised by the integration tests against devnet (see [Tests](#tests)). It's
part of this monorepo and not published to npm yet.

## A payment, end to end

```ts
import {
  approveConfidentialAccount, createPayrollMint, createSealedClient, depositToConfidential,
  deriveKeys, mintTestTokens, parseAmount, payConfidential, setupConfidentialAccount,
} from '@sealed/core';

// The company pays every fee. v1 transactions allow one-transaction payments.
const client = await createSealedClient({ rpcUrl: 'devnet', feePayer: company, transactionVersion: 1 });
const companyKeys = await deriveKeys(company); // one signature over `solana-conf-bal/v1`

// A mint with confidential transfers, manual approval, and the accountant as auditor.
await createPayrollMint(client, { mint, authority: company, decimals: 6, auditorElgamalPubkey: accountantKeys.elgamalPubkey });

// The treasury: configure, approve, fund, and move the funds into the confidential balance.
await setupConfidentialAccount(client, { owner: company, mint: mint.address, keys: companyKeys });
await approveConfidentialAccount(client, { mint: mint.address, authority: company, owner: company.address });
await mintTestTokens(client, { mint: mint.address, authority: company, owner: company.address, amount: parseAmount('1000') });
await depositToConfidential(client, { owner: company, mint: mint.address, keys: companyKeys, amount: parseAmount('1000'), decimals: 6 });

// Pay 250 confidentially, in one transaction. Only the recipient and the auditor can read the amount.
const { signature } = await payConfidential(client, {
  mint: mint.address,
  from: { owner: company, keys: companyKeys },
  to: employee.address, // their account must be configured and approved
  amount: parseAmount('250'),
  proofDelivery: 'one-transaction',
});
```

## The recipient's side, with zero SOL

The employee's transactions carry their own proofs, so they're built where their keys are (the
browser). The company co-signs as fee payer, after its policy check.

```ts
import {
  applyPendingBalance, createRemoteSponsorSigner, createSealedClient, fetchReceivedPayments,
  getConfidentialBalance, setupConfidentialAccount, withdrawConfidential,
} from '@sealed/core';

// In the browser: the fee payer is the company, reached through your server.
const employeeClient = await createSealedClient({
  rpcUrl: 'devnet',
  transactionVersion: 1,
  feePayer: createRemoteSponsorSigner(companyAddress, wire => api.sponsor(wire)),
});

await setupConfidentialAccount(employeeClient, { owner: employee, mint, keys }); // once
await applyPendingBalance(employeeClient, { owner: employee, mint, keys });      // "collect pay"
const balance = await getConfidentialBalance(employeeClient, { owner: employee.address, mint, keys });
const payments = await fetchReceivedPayments(employeeClient, { owner: employee.address, mint, keys });
await withdrawConfidential(employeeClient, { owner: employee, mint, keys, amount, decimals: 6, proofDelivery: 'one-transaction' });
```

```ts
// On the server: check, then sign as the fee payer. Throws SponsorPolicyError on anything else.
import { sponsorTransaction } from '@sealed/core';

const signature = await sponsorTransaction(wireTransaction, companySigner, { owner, token, mint });
```

The policy (`src/sponsor.ts`) accepts legacy, v0 and v1 transactions. It allows only the
confidential Configure, Deposit, Withdraw and ApplyPendingBalance instructions on the user's own
token account, ZK proof verification, creating the user's own token account, and bounded proof
context accounts whose rent returns to the sponsor. It caps priority fees.

## Auditing

```ts
import { fetchAuditedTransfers } from '@sealed/core';

// Every transfer out of the treasury, amounts decrypted with the mint's auditor key.
const transfers = await fetchAuditedTransfers(client, { tokenAccount: treasury, auditorSecret, cache });
```

History reads accept a `cache` (`TransactionCache`: only finalized transactions are stored), an
`onProgress` callback and an abort `signal`. Public RPCs allow about one history read per second,
so a cache turns a slow first load into instant reloads.

## One-transaction delivery, directly

`oneTransactionTransfer` and `oneTransactionWithdraw` take the plans that
`@solana-program/token-2022/confidential` builds with inline proofs, and repack them into one
transaction's instructions. They reuse the library's proof construction and throw on any plan
they don't recognise. `planningRpc(rpc)` saves the rent lookups for proof accounts that the repack
drops.

## Tests

```bash
pnpm test                                     # 59 unit tests, no cluster
RPC_URL=devnet pnpm test:integration          # the flows against devnet (or Surfpool by default)
pnpm bench:proofs                             # proof timings and one-transaction sizes, offline
```

The unit tests build real plans with synthetic keys and check what the chain will check: the
instruction layout, that every proof verifies, the transaction size, both decryptions, and the
sponsor policy.
