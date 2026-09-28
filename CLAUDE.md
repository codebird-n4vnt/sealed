# Sealed — Complete Project Plan

> **For Claude Code:** read this whole file before doing any work. It is the source of truth
> for what Sealed is, why it exists, how it's built, and what "done" means. Decisions recorded
> here were made deliberately. Don't reverse them silently; if something here turns out to be
> wrong, say so and propose the change.

---

## 1. One-line pitch

**Sealed is private stablecoin payroll on Solana.** Companies pay their teams on-chain, and
only the employer, the employee and the company's accountant can see how much anyone earns.

---

## 2. The problem

Stablecoins are now a normal way to pay remote teams, contractors and DAO contributors. On a
public chain, every payment is visible to everyone, forever.

- **Employees see each other's pay.** A salary sheet the company would never publish becomes
  public the moment payroll runs.
- **Competitors see your burn rate and headcount,** and know exactly whom to poach and what to offer.
- **Wealthy wallets become targets** for phishing, social engineering and physical threats.
- **Vendors and partners see what others are paid,** which weakens every negotiation.

Salary confidentiality is the default in every normal company. On-chain payroll quietly removed
it, and that is a real reason businesses hesitate to run payroll in stablecoins.

---

## 3. The solution

Sealed runs payroll with Solana's native **Confidential Balances** (Token-2022). Amounts and
balances are encrypted on-chain, but the network still verifies every payment with
zero-knowledge proofs.

| Who | What they can see |
|---|---|
| **Company admin** | Everything they send: amounts per employee and the treasury balance |
| **Employee** | Their own payments and balance, decrypted in their browser with keys from their own wallet |
| **Accountant / auditor** | Every transfer amount on the company's token, via a view-only auditor key |
| **Everyone else** | That a payment happened between two addresses, but **not the amount** |

### Privacy model: be precise, never overclaim

Sealed hides **amounts and balances, not identities.** Stay honest about what remains public:

- Wallet and token-account addresses, the mint, and the fact and timing of each transfer are public.
- **Deposits into and withdrawals from confidential balances are public amounts.**
  - When the company funds payroll, the *total* is visible, but not each person's share.
  - If an employee withdraws exactly their salary to a public balance, that amount becomes visible.
- What Sealed does about this:
  - Fund the treasury in round lump sums.
  - Encourage employees to keep funds confidential, or to withdraw irregular amounts.
  - Later: confidential off-ramps.
- Never use the word "anonymous" in the product, the pitch or the docs.

---

## 4. Users

| Persona | Needs | Sealed gives them |
|---|---|---|
| **Company admin / finance lead** (crypto startup, remote-first company, DAO ops) | Pay 5–200 people monthly in stablecoins without publishing salaries | One-click confidential payroll runs, CSV import, run history |
| **Employee / contributor** | Get paid, see their pay, cash out, keep their pay private | Invite link → connect wallet → paid; never needs SOL for fees |
| **Accountant / auditor** | Verify payroll for tax, audits and compliance | View-only auditor key: decrypt all transfer amounts, export CSV |

**First customers to target:** Solana-native startups and DAOs already paying teams in USDC,
starting with Indian Web3 teams, which is also where the Superteam India track's
product-market-fit evidence will come from.

---

## 5. Why now

- **Confidential Balances are back.**
  - The ZK ElGamal proof program, which confidential transfers depend on, was disabled on
    19 June 2025 (epoch 805) after a bug.
  - It was re-enabled on 4 June 2026 (epoch 982) after five audits.
  - Token-2022 was redeployed with the confidential instructions about two weeks later.
- **Transaction format v1** activated on mainnet on 15 Sept 2026 (epoch 1035). It raises the
  transaction size limit to 4,096 bytes, enough to carry a full proof set inline.
- **Official TypeScript support now exists.**
  - `@solana-program/token-2022/confidential` provides key derivation, account setup and
    transfer instruction plans.
  - `@solana/zk-sdk` (WASM) handles encryption and proofs.
  - A browser app is now realistic.
- **Almost nobody has built a product on it.** Wallets barely support it, and there's no business product.
- **Stablecoin payroll is mainstream,** but the existing crypto payroll tools send ordinary,
  fully public transfers.

---

## 6. Competitive landscape

| Alternative | Problem |
|---|---|
| Paying from a multisig or wallet directly | Every amount public |
| Crypto payroll tools (e.g. Request Finance, Rise) | Pay on public rails; amounts visible on-chain |
| Consumer privacy apps (e.g. "private Venmo" hackathon projects like Veil) | Built for individuals, not payroll: no team management, no accountant view, no batch runs |
| Helius "Solana Rings" (Light Protocol team) | A different privacy protocol, devnet-only beta; infrastructure, not a payroll product |
| Mixers / anonymity protocols | Anonymity, not confidentiality — compliance-hostile, and not what businesses want |

**Sealed's position:** the first *business* product on Solana's *native* Confidential Balances,
with compliance built in through auditor keys.

---

## 7. Technical foundation: facts that constrain the design

Verified from the Solana docs and the spl-token CLI source. If you change anything that
depends on these, re-verify against source or `--help` first.

### Programs and addresses

- **Token-2022:** `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- **ZK ElGamal Proof program:** `ZkE1Gama1Proof11111111111111111111111111111`
- **Available on devnet and mainnet.** A stock `solana-test-validator` does **not** enable the
  proof program. Use devnet, or a mainnet-forking validator such as **Surfpool** (installed
  at `~/.surfpool`).

### How Confidential Balances work

1. **Mint:** the confidential transfer extension must be set **when the mint is created**.
   It can't be added later, so the existing USDC mint can't be used directly (see §9).
2. **Account setup:** each owner configures their own token account.
   - This sets the account's ElGamal public key and requires a pubkey-validity proof that only
     the owner can produce.
   - An alternative instruction, `ConfigureAccountWithRegistry`, uses an `ElGamalRegistry`
     account instead of a per-account proof. Investigate it: it could let an employee
     register a key once so the company provisions accounts for them.
3. **Balances:** each account has a **public** balance, a **pending** confidential balance and
   an **available** confidential balance.
4. **Deposit** moves public → pending. **Apply pending balance** moves pending → available.
5. **Transfer** moves an encrypted amount from the sender's *available* balance to the recipient's
   *pending* balance.
   - It needs three proofs: equality, ciphertext validity and range.
   - The standard flow is **3 transactions**: create and verify proof context accounts →
     verify the range proof → verify equality, transfer, and close the proof accounts.
6. **Withdraw** moves available → public. It needs proofs and reveals the withdrawn amount.
7. **Credit counter:** each incoming confidential credit increments a counter (default max
   65,536). The owner must apply pending balance periodically.

### Keys

- The standard derivation: the owner signs the constant message **`solana-conf-bal/v1`** once,
  and both the ElGamal keypair and the AES key are derived from that signature
  (`deriveConfidentialKeys({ signer })`).
- The keys are reproducible from the wallet alone, so there's nothing extra to store.
- **Treat that signature like a password.** Never request it casually, and never send it or
  the derived keys to the server.
- The CLI derives keys from the signer with `derive_confidential_keys(signer, b"")`.
  **Verified Sep 27: this matches `deriveConfidentialKeys` byte for byte** (the same ElGamal
  public key from `.keys/employee.json` via the CLI and via `packages/core`). Still configure
  demo accounts through the app.

### Reading balances

The **available** balance has an AES-encrypted fast path ("decryptable available balance"):
decrypt it with the AES key via `AeCiphertext` from `@solana/zk-sdk`. The UI must:
- Show the public balance.
- Show the decrypted available balance.
- Show pending separately.
- When keys are locked, show "confidential balance — unlock to view", **never 0**.

### Auditor

- A mint can hold **one** global auditor ElGamal public key.
- Every transfer then also includes the amount encrypted for the auditor, as auditor
  ciphertext lo and hi parts in the transfer data.
- The auditor can decrypt **transfer amounts**, not full balances.
- Rotation only affects future transfers, so keep old auditor keys.

### Approve policy

- **auto:** anyone can configure a confidential account.
- **manual:** the confidential-transfer authority must approve each account. Use this to
  restrict a company token to that company's employees.

### Fees

Every instruction has a separate fee payer, so **the company can pay all fees.** Employees need
zero SOL. The day-1 script proves this.
- CLI gotcha: pass `--fee-payer` explicitly. When a command also passes `--owner`, spl-token
  otherwise makes that owner the fee payer.
- In `packages/core`, the kit client's `payer` (the company) pays for every transaction,
  including proof and record accounts.

### Sequential transfers

A transfer's proofs depend on the sender's current available balance, so transfers from one
source account must run **in order**, each using the new balance. To pay many people faster,
split the treasury across several confidential sub-accounts and run them in parallel.

### Kill switch

A feature gate can disable the ZK ElGamal proof program network-wide, and it has happened before.
- While disabled, confidential balances can't move.
- Last time, the ciphertexts survived unchanged, with no migration.
- Design for it: keep only the current payroll float confidential, encourage withdrawal after
  payday, and have a public-payroll fallback mode.

### Libraries

- **TypeScript:**
  - `@solana-program/token-2022` and `@solana-program/token-2022/confidential` for instructions
    and high-level helpers:
    - `deriveConfidentialKeys`
    - `getCreateConfidentialTransferAccountInstructionPlan`
    - `getConfidentialTransferInstructionPlan`
    - `getApplyConfidentialPendingBalanceInstructionFromToken`
  - `@solana/zk-sdk` (WASM) for encryption, decryption and proof data.
  - `@solana-program/zk-elgamal-proof` for proof verification instructions.
  - These are built on `@solana/kit`.
- **Rust (fallback, or for the vault program's tests):** `spl-token-client` and
  `spl-token-confidential-transfer-proof-generation`.
- Check exact function signatures in the installed package and don't guess. Docs summaries
  have been wrong before.
- Learned while building M1 (`@solana-program/token-2022@0.19.0`):
  - The helpers take `ElGamalKeypair` / `AeKey` objects. `deriveConfidentialKeys` returns
    bytes, and `packages/core/src/keys.ts` converts them.
  - According to the library's own docs and tests (not observed here), the inline-proof
    transfer and withdraw plans sit within a few bytes of the transaction size limit and can't
    also fit the compute-unit-limit instruction that kit's executor adds by default.
  - `packages/core` therefore uses the `...WithRecordInstructionPlan` variants, which stage the
    range proof in a record account (more transactions, but rent is reclaimed).
  - `@solana/zk-sdk/bundler` resolves to the Node build under Node, so the same imports work
    server-side and in the browser.

---

## 8. Product scope

### MVP — must exist for the hackathon submission

**Employee portal**
- Accept an invite link → connect wallet → sign once to derive keys → the confidential account
  is created and configured (company pays the fees).
- See public, pending and available balances, decrypted in the browser.
- "Collect pay" (apply pending) and "Withdraw" (to public balance).
- Payment history with dates; amounts decrypted locally.

**Company dashboard**
- Create a company and connect the admin wallet (Sign-In With Solana).
- Treasury: fund with the company token, deposit to confidential, and show the confidential
  treasury balance.
- Team: add members by wallet or invite link, set each salary, see onboarding status.
- **Run payroll:**
  1. Review a table of who gets what.
  2. Confirm.
  3. Sealed executes confidential transfers one by one.
  4. Live progress and final status per employee, with signatures.
- Run history.

**Accountant view**
- Load the auditor key → list every transfer on the company token → decrypted amounts → CSV export.

**Demo company:** a seeded company with a 10-person mock team, so the whole flow can be shown in one video.

### Stretch — only if the MVP is solid

- **Sealed Vault program** (§9): USDC-backed, per-company confidential token. This is the most
  valuable stretch goal, because it turns the demo into a real product.
- CSV import of salaries.
- Parallel payroll across treasury sub-accounts.
- Registry-based onboarding (`ConfigureAccountWithRegistry`).
- Embedded wallets for employees who don't have one (e.g. Privy).
- Single-transaction transfers with the v1 transaction format.
- Scheduled, recurring payroll.

### Later (post-hackathon roadmap)

- Mainnet launch after an audit (apply for the CertiK / Adevar audit credits from this hackathon).
- Squads multisig approval for payroll runs.
- Confidential off-ramps and local-currency payouts.
- Payslips and tax exports per country.
- Vendor and contractor invoices.
- Confidential bonuses and equity-like grants.
- An API for other payroll providers.

### Explicitly out of scope

Anonymity features, mixers, cross-chain, token launches, and anything that hides *who* was paid.

---

## 9. Token strategy (important architecture decision)

**The problem:** the auditor key is **per mint.** If every company shared one "Sealed dollar"
mint, one auditor would see every company's payroll, and Sealed itself would become a
honeypot. USDC's mint can't get the extension at all. The Token Wrap program's wrapped mints
do include confidential transfers, but with the confidential authority set to `None` (so no
auditor can be set), and it's documented as not yet deployed on mainnet.

**The decision:** **each company gets its own confidential token, backed 1:1 by USDC.**

- **Hackathon MVP:** a devnet test stablecoin per demo company.
  - 6 decimals, confidential transfers enabled.
  - Approve policy `manual`, with the company as the confidential-transfer authority.
  - Auditor key = the company's accountant.
  - This proves the full product experience.
- **Sealed Vault program (Anchor), the stretch goal and the real product:**
  - `init_company`: registers a company token. The company creates the Token-2022 mint with
    the confidential extension, its auditor and `manual` approve policy, and sets the mint
    authority to the vault's PDA.
  - `wrap`: the company deposits USDC into the vault; the vault mints the equivalent company
    token to the company's treasury.
  - `unwrap`: the holder burns company tokens; the vault releases USDC.
  - Invariant: **company token supply == USDC held for that company.** Test it.
- **PYUSD** already has the confidential extension, but its approve policy and auditor are
  controlled by the issuer. Check them on-chain (`spl-token display <PYUSD mint>`) before
  treating it as an option; it isn't the primary path.

---

## 10. Architecture

```
┌─────────────────────────────── Browser ───────────────────────────────┐
│  Employee portal          Company dashboard          Accountant view  │
│  - derive keys (wallet)   - team, salaries, runs     - auditor key    │
│  - configure account      - approve payroll run        (local only)   │
│  - decrypt / apply /      - progress + history       - decrypt + CSV  │
│    withdraw (proofs WASM)                                             │
└──────────────┬───────────────────────┬────────────────────────────────┘
               │ partially-signed tx   │ API (auth: Sign-In With Solana)
               ▼                       ▼
┌──────────────────────── Sealed backend (Next.js server) ──────────────┐
│  Payroll engine: builds + signs confidential transfer plans           │
│    from the company's Payroll Vault signer, sequentially per account  │
│  Fee sponsor: co-signs employee txs as fee payer                      │
│  Jobs: payroll runs as persisted jobs (resume on failure)             │
│  DB (MongoDB): companies, members, invites, runs, payments (no keys)  │
└──────────────┬────────────────────────────────────────────────────────┘
               ▼
┌──────────────────────────── Solana ───────────────────────────────────┐
│ Token-2022 (Confidential Balances) · ZK ElGamal Proof program         │
│ Company token mint (auditor = accountant, approve = manual)           │
│ Sealed Vault program (stretch): USDC ⇄ company token, 1:1             │
└───────────────────────────────────────────────────────────────────────┘
```

### Key decisions

**Who signs payroll**
- **MVP:** each company has a **Payroll Vault signer**, a keypair the backend holds (devnet
  only) that owns the confidential treasury account.
- The admin approves each run by signing a message with their wallet; the backend then
  generates proofs and submits.
- This gives true one-click payroll.

**Production path for payroll signing**
- The treasury owner must be able to derive ElGamal and AES keys and sign proofs, and a
  multisig can't do that directly.
- Options:
  - Run proofs in the admin's browser, with wallet `signAllTransactions` per run.
  - Keep the vault signer in an HSM or MPC service, with Squads approval gating the backend.
- Document the choice; don't build it for the hackathon.

**Where proofs run**
- Company transfers: server-side, in Node with the `@solana/zk-sdk` WASM.
- Employee withdraws and account setup: in the browser, so employee keys never leave their device.

**Fee sponsorship**
- The backend builds employee transactions with the company's fee payer and partially signs them.
- The employee's wallet signs as owner, then the transaction is submitted.
- **As built (Sep 27): the other way round.** The employee's browser builds each transaction,
  because the proofs need the employee's secret keys. The server co-signs as fee payer only after
  the transaction passes the sponsor policy (`packages/core/src/sponsor.ts`), and it rate-limits per
  employee. The policy check is what makes co-signing safe. See its header for the one known gap:
  proof-account rent. It only exists in v0 mode: in v1 mode (the default on devnet since Sep 28)
  employee withdrawals are one transaction with no proof accounts.

**What's stored off-chain**
- MongoDB: companies, members, wallets, invites, payroll runs, per-payment status and signatures.
- Salary amounts are stored **encrypted at rest** (app-level AES-GCM key from env), so the
  database alone doesn't leak payroll. This is an MVP limitation; document it.
- **Never store:** employee key-derivation signatures, derived ElGamal/AES keys, or the auditor secret key.

**Payroll runs are resumable jobs**
- Each payment moves through `pending → proving → submitted → confirmed | failed`.
- A crash mid-run must never double-pay: check on-chain state before retrying.

**Wallets and auth**
- Wallet Standard via the `@solana/kit` ecosystem.
- Sign-In With Solana for sessions.
- Check the currently recommended React wallet package before choosing.

### Suggested repo layout

```
sealed/
├── CLAUDE.md                  ← this file
├── README.md
├── apps/
│   └── web/                   Next.js (App Router, TypeScript, Tailwind)
│       ├── app/(employee)/    employee portal
│       ├── app/(company)/     company dashboard
│       ├── app/(auditor)/     accountant view
│       └── app/api/           payroll engine, fee sponsor, auth
├── packages/
│   └── core/                  TS library: keys, account setup, deposit, apply,
│                              transfer plans, withdraw, decrypt, auditor decrypt
│                              (all Confidential Balances logic lives here, tested)
├── programs/
│   └── sealed-vault/          Anchor program (stretch)
├── scripts/
│   ├── day1-confidential-transfer.sh   CLI go/no-go test (already exists)
│   └── seed-demo-company.ts            creates the demo company + mock team
└── docs/
    ├── pitch.md               pitch narrative and deck outline
    ├── demo-script.md         shot-by-shot video script
    └── architecture.png       diagram for the submission
```

Use pnpm workspaces. Keep all Confidential Balances code in `packages/core`, so the web app
never touches raw instructions.

---

## 11. Milestones

Build in this order. Each milestone has a clear definition of done. Don't start the next
milestone while the current one is broken.

### M0 — Prove the core (go / no-go)

- `scripts/day1-confidential-transfer.sh` runs end to end on devnet: an employer pays an
  employee confidentially, the employee withdraws, and the employer pays all fees.
- **Done when** the script prints GO. If it can't, stop and report before building anything else.
- **Status (Sep 27): ✅ GO on Surfpool and on devnet.**
  - `api.devnet.solana.com` failed two kinds of calls all day: account reads (`getAccountInfo`
    timed out) and history queries that reach its long-term storage. Everything else worked.
  - `scripts/devnet-rpc-proxy.mjs` routes those reads to OnFinality's public devnet RPC and the
    rest to the official RPC, pacing requests to avoid rate limits. Through it the script prints
    GO on devnet.
  - On Solscan (devnet), the payment shows as a Token-2022 ConfidentialTransfer with no amount.
  - The first run also fixed two script bugs: the fee payer and the balance check.
  - Sep 28: the public devnet RPC recovered, so the proxy is optional. It still allows only about
    one `getTransaction` per second per IP (see the README's "On devnet").

### M1 — Core library (`packages/core`)

- TypeScript implementations of: key derivation, create and configure account (with a
  sponsored fee payer), deposit, apply pending, confidential transfer (instruction plan),
  withdraw, balance decryption, and auditor decryption of transfer amounts.
- An integration test that reproduces the whole M0 flow in TypeScript against devnet or Surfpool.
- **Done when** the TS test passes end to end, including the accountant decrypting the transfer amount.
- **Status (Sep 27): ✅ done on Surfpool.** `pnpm test:integration` passes 9/9 in about 15s.
  - It covers a manual-approval mint with the accountant as auditor, a fresh 0-SOL employee
    onboarded with sponsored fees, the treasury deposit, the payment (public balance stays 0),
    the employee decrypting, the accountant decrypting (single transaction and treasury
    history), and collect + withdraw with the employee still at 0 SOL.
  - Every employee transaction in it goes through the sponsor policy, as in the app, and the
    employee's payment history is decrypted from chain data.
  - `pnpm test` runs 49 unit tests: amounts, the auditor's lo/hi split, and the sponsor policy
    (the allowed employee flows and the attacks it must refuse).
  - Devnet: ✅ 9/9 through the proxy
    (`RPC_URL=http://127.0.0.1:8898 RPC_SUBSCRIPTIONS_URL=wss://api.devnet.solana.com`).

### M2 — Employee portal

- The invite → connect → sign → configured flow, with fees sponsored.
- Balances decrypted in the browser; collect pay; withdraw; history.
- **Done when** a fresh wallet with 0 SOL can join, receive a payment and withdraw it.
- **Status (Sep 27): ✅ done on Surfpool, in the browser.** A fresh test-wallet identity with 0 SOL
  accepted an invite, set up its private account (the server checked and co-signed the sponsored
  transaction, then approved the account), received 4,200, saw it decrypted with the history,
  collected it and withdrew 1,000, still at 0 SOL.
- Devnet: ✅ the same flow in the browser against the seeded devnet company
  (`sealed_devnet` database, via the RPC proxy). Priya started from a fresh identity with 0 SOL,
  collected and withdrew, and her history showed 4,200 with its real devnet timestamp.

### M3 — Company dashboard and payroll engine

- Company creation, the treasury (fund + deposit), team management, and salaries.
- A payroll run as a resumable job with live per-employee progress.
- **Done when** a 10-person run completes and every employee sees the correct decrypted amount,
  while a block explorer shows no amounts.
- **Status (Sep 27): ✅ done on Surfpool.**
  - A 10-person run was approved in the dashboard and completed with live progress (50,600 sUSD).
  - All 10 employees decrypted the right amounts: 9 checked with their own keys by script, Priya
    in the browser.
  - The payment as the public sees it (RPC `getTransaction`): no amount anywhere, public balances 0.
    The hosted explorer can't reach a local validator, so take the explorer screenshot on devnet.
  - Crash recovery was checked too. A payment that landed before a crash is marked paid without
    paying again, and its signature is recovered from the chain. One that never landed is retried
    once. The treasury paid exactly the expected total.
  - Devnet: ✅ a 10-person run approved in the browser completed with all 10 payments confirmed.
    On Solscan (devnet), Priya's payment shows a ConfidentialTransfer and no amount.
  - Sep 28, devnet, one-transaction mode (v1): a 10-person run completed in 26 s, every payment
    one transaction on its first attempt. The multi-transaction run the day before took about
    3.5 minutes.
  - Retries are now safe against late landings. When a payment errors after signing, the engine
    waits until that transaction's signature settles or its last valid block height passes, then
    checks the treasury. Resuming a submitted payment after a crash waits out its lifetime the same
    way. Transient errors (rate limits, websocket drops) are retried up to 3 times with backoff.
    Before this, two of ten payments in a rate-limited run failed outright.

### M4 — Accountant view

- Load the auditor key locally → list transfers → decrypt → CSV export.
- **Done when** the exported CSV matches the payroll run exactly.
- **Status (Sep 27): ✅ done on Surfpool.** Without the key, the view lists every treasury payment
  from the chain with amounts shown as encrypted. With the key file loaded, all 9 amounts of the
  seeded run decrypted correctly (46,400 in total). The CSV's 9 signatures and amounts match the
  run's confirmed payments exactly.
  - Devnet: ✅ 19 payments (last month's 9 plus today's 10) decrypted to 97,000 sUSD in total.
    The CSV's 19 signatures match the engine's confirmed payments exactly, with real dates.
  - Sep 28: 45 payments, 26 of them one-transaction, decrypted to 229,900 sUSD. The CSV's 45
    signatures match the engine's exactly. On the public RPC the first load of 53 transactions
    took 81 s; the browser caches finalized transactions, so reloads are instant.

### M5 — Sealed Vault program (stretch)

- Anchor program: `init_company`, `wrap`, `unwrap`, with the 1:1 backing invariant under test.
- **Done when** USDC in → confidential payroll → USDC out works on devnet.
- If time runs short, keep M5 as a clearly labelled design in the pitch and docs, not a half-working demo.
- **Status (Sep 27): ✅ built and tested on Surfpool; devnet deploy pending.**
  - The program is at `programs/sealed-vault` (Anchor 1.1.2), with program ID
    `CTfg335Wow4yDCZGizkDnFk3SCT2GChkNsZVicTgbffm`.
  - `init_company` only accepts a Token-2022 mint whose mint authority is the company PDA, with
    zero supply and USDC's decimals.
  - `wrap` and `unwrap` check supply == USDC held on-chain after every call.
  - `packages/core/test/integration/vault-flow.test.ts` passes 7/7 against the deployed program:
    - test USDC in → wrap into the confidential treasury → pay an employee confidentially;
    - the employee withdraws and unwraps to USDC, still at 0 SOL;
    - refused: minting around the vault, registering a mint the vault can't control, redeeming
      against another company's vault, and over-unwrapping.
  - Rust LiteSVM tests were dropped: that build needed several GB of disk the machine didn't have.
  - The web app still funds treasuries with test tokens, and the sponsor policy doesn't cover
    `unwrap` yet, so in the test the company pays its fee directly.
  - Devnet deploy needs about 1.8 devnet SOL, and devnet airdrops were rate-limited. Fund the
    deployer from faucet.solana.com, then run
    `pnpm vault:deploy -u http://127.0.0.1:8898 -k .keys/employer.json`
    (`RPC_URL=… pnpm test:integration` then runs the vault flow on devnet).

### M6 — Polish, traction and submission

- UI polish, an empty-states and errors pass, and the seeded demo company.
- Demo video, pitch video, README with setup instructions, architecture diagram.
- Traction evidence (§13).
- Submissions (§14).
- **Status (Sep 27): in progress.** Done: the seeded demo company (`pnpm seed`, in
  `apps/web/scripts/seed-demo.ts` rather than root `scripts/`, because it reuses the app's server
  modules), the README, `docs/architecture.png`, `docs/pitch.md`, `docs/demo-script.md`,
  `docs/traction.md`, `docs/submission.md`, and a passing production build. Left for the founder:
  the videos, the deck, traction calls, deploying the devnet demo, and the submissions.

### Cut line if behind schedule

Drop, in this order:
1. M5 (keep it as a design).
2. Parallel sub-accounts.
3. CSV import.
4. History pages.

**Never drop** M0–M4 or the demo video.

---

## 12. The demo (what judges must see)

A 2–3 minute video that follows one story:

1. **Problem, 20s:** a real-looking public USDC payroll on Solscan, where every salary is readable.
2. **Company, 40s:** Acme DAO funds its treasury, reviews 10 salaries and clicks **Run payroll**.
   Live progress shows each payment confirming.
3. **Public view, 20s:** the same transactions on an explorer show payments happening, but
   **no amounts**.
4. **Employee, 30s:** Priya opens her invite link and connects her wallet. She has 0 SOL and
   pays no fees. She sees her decrypted pay and withdraws.
5. **Accountant, 20s:** loads the auditor key, sees every amount, exports CSV. Compliance is built in.
6. **Close, 20s:** why now (Confidential Balances re-enabled June 2026), traction numbers,
   and what's next (Vault and mainnet).

Record a separate technical walkthrough covering the architecture, the proofs and where keys
live, if the submission allows it.

---

## 13. Traction plan

The Superteam India judges explicitly score **"early traction indicators"**, so this is part of
the build, not an afterthought.

- **Who to contact:** Indian Web3 startups and DAOs that pay contributors in stablecoins, plus
  Solana ecosystem teams met through Superteam India.
- **What to ask for:** a 15-minute call, then a devnet pilot (they run a mock payroll) or a
  written letter of intent: "we would use Sealed for payroll if it launches on mainnet."
- **What to capture:** names or logos (with permission), quotes, number of teams, number of
  devnet payroll runs and payments, and the problems they described.
- **Target:** at least 5 teams contacted with evidence of interest, and at least 2 devnet
  pilots or letters of intent.
- **Pitch India honestly:** paying Indian employees in crypto brings India's crypto tax and TDS
  rules into play. Lead with companies paying **global** teams. (Not tax advice.)

---

## 14. Hackathon: targets, rules and submission

The founder is solo and physically based in India.

| Track | Prize | Deadline | Requirements |
|---|---|---|---|
| **Colosseum Crypto World's Fair — overall** | $30k grand + 20 × $15k; winners interviewed for the accelerator ($250k pre-seed) | **Oct 12, 2026, 11:59 pm PT (Oct 13, 12:29 pm IST)** | All chains compete in one pool, judged by the Colosseum team on product merit |
| **Colosseum — Solana ecosystem track** | 10 × $10k ($100k pool) | Oct 12, 2026 | Same submission |
| **Superteam India track** | $2.5k / $1.5k / $1k + Superteam India Member role | **Oct 13, 2026** | Solana only; team physically in India; **India selected as country on Colosseum**; submit on Colosseum **and** Superteam Earn |
| University Prize | $5k | Oct 12, 2026 | Eligibility not defined in the rules or FAQ; ask Colosseum |
| Public Goods Award | $5k | Oct 12, 2026 | Listed in the official rules; no separate entry described |
| CertiK / Adevar audit credits | credits | see listings | Useful for the Vault program before mainnet |

What the official sources say (checked Sep 27, 2026, from the rules PDF, the FAQ and the Superteam listing):

- **Prizes stack.** Track prizes are "awarded in addition" to the overall awards. The Superteam
  India pool pays "on top of anything you win globally". It pays in USDG; Colosseum pays in Phantom
  CASH.
- **Superteam India eligibility:** built on Solana, team based in India, registered on Colosseum
  with India as the country, submitted to both Colosseum and Earn, and eligible under the global
  rules. Only 4 submissions so far.
- **Colosseum submission portal asks for:**
  - name and description, chains and tools, teammates' backgrounds, location, and a logo;
  - the GitHub repo (public encouraged);
  - a **2–3 minute presentation video** (one of the first things judges watch);
  - a **product demo video of at most 3 minutes**;
  - go-to-market, demand validation and distribution plans.
- **Weekly updates:** a one-minute video each week, optional but "strongly recommended".
- **Pre-existing work:** only work done during the hackathon (Sep 14 – Oct 12) is judged, and past
  work must be disclosed. Sealed started Sep 27, so there's nothing prior to disclose. Content must
  be in English. One project per person.
- **Judging:** founder–market fit, insight, product and execution, market size, communication,
  viability and traction. The rules also list functionality, impact, novelty, UX, open source and
  composability, and the business plan. A shortlist gets a 15-minute Zoom interview.

**Not entering:** the Panta API sidetrack. It requires meaningful Panta API integration, and
Sealed doesn't use Panta.

### Superteam India judging criteria, and how Sealed answers them

1. **Ecosystem impact** (infrastructure, tooling, needed products for Solana): the first
   business product on newly re-enabled Confidential Balances, plus reusable `packages/core`
   tooling.
2. **Product-market fit** (defined problem, clear users, early traction): salary privacy for
   teams paid in stablecoins, with pilots or letters of intent from §13.
3. **Growth potential** (new users, deeper engagement): payroll is monthly and recurring, and
   every employee is onboarded to a Solana wallet.

### Submission checklist

- [ ] Colosseum project created, **country = India**, and all past or pre-existing work disclosed.
- [ ] Public GitHub repo with a README (setup, architecture, how to run the demo).
- [ ] Pitch video (2–3 min) and product demo video (≤ 3 min), in English.
- [ ] Weekly one-minute update videos on the Colosseum dashboard (recommended).
- [ ] Pitch deck: problem, solution, demo screenshots, why now, market, traction, business model, roadmap, team.
- [ ] Live devnet demo URL.
- [ ] Colosseum submission confirmed → **then** submit on Superteam Earn (India track) with the
      Colosseum project link, profile link and GitHub link.
- [x] Stacking: the Superteam India pool pays on top of global prizes, and track prizes add to
      the overall awards. Still check the Earn FAQ before adding any *other* sidetrack.

---

## 15. Business model (hypothesis to test in traction calls)

- A per-active-employee monthly fee, like normal payroll software, with a free tier for small DAOs.
- Later: vault float yield (only with clear disclosure and consent), and premium compliance
  exports and multisig approvals.
- Validate willingness to pay in every traction call. Don't state prices as facts in the pitch.

---

## 16. Risks and prepared answers

| Risk / judge question | Answer |
|---|---|
| "Isn't this privacy for its own sake?" | Salary confidentiality is the default in every company; on-chain payroll removed it. Sealed restores it. |
| "Compliance?" | Auditor keys give accountants and regulators full read access to amounts; addresses stay public for screening. |
| "USDC doesn't support confidential transfers." | Per-company confidential tokens backed 1:1 by USDC through the Sealed Vault; PYUSD as a possible alternative. |
| "What if confidential transfers get switched off again?" | Balances freeze but aren't lost (ciphertexts survived last time); Sealed keeps only the payroll float confidential and has a public fallback. |
| "Withdrawals reveal amounts." | True, and we say so: round-sum funding, keeping pay confidential, irregular withdrawals, confidential off-ramps on the roadmap. |
| Proof generation is slow or heavy | Company proofs run server-side; employees only prove their own withdrawals; parallel sub-accounts for large teams. |
| Solo founder, tight timeline | The milestone order and cut line in §11 protect the demo. |
| Key custody of the Payroll Vault signer | Devnet only for the MVP; the production path (browser proofs or HSM/MPC + Squads) is documented. |

---

## 17. Security and privacy rules (non-negotiable)

- **Devnet only** until an audit. Never put mainnet keys in this repo.
- **Keypairs live in `.keys/`** (gitignored). Never commit keypairs, `.env`, signatures or derived keys.
- Never send an employee's derivation signature, ElGamal secret or AES key to the backend, and never log them.
- The auditor secret key is loaded **locally in the accountant's browser** and never uploaded.
- Never log salary amounts in plaintext on the server; store them encrypted at rest.
- A payroll retry must check on-chain state first, so nobody is ever double-paid.
- Confirm on-chain success before marking any payment "confirmed".

---

## 18. Testing strategy

- **Unit tests** (`packages/core`): amount conversion (decimals), lo/hi split handling for
  auditor decryption, and state transitions of payroll jobs.
- **Integration tests:** the full flow against devnet or Surfpool. This is the same flow as the
  day-1 script, in TypeScript.
- **Vault program:** Anchor tests for wrap/unwrap and the 1:1 backing invariant, including failure cases.
- **Manual QA before recording:** a 10-person run, a 0-SOL employee, an accountant CSV that
  matches the run, and an explorer showing no amounts.

---

## 19. Open questions (resolve early, then update this file)

- [x] Does `ConfigureAccountWithRegistry` allow company-provisioned employee accounts after a one-time key registration?
  - Yes, by design (read from the JS client and the Token-2022 processor source, not tested yet).
  - The instruction takes only the token account, the mint, the owner's ElGamal registry account and
    an optional payer. There is no owner signature: the pubkey-validity proof was checked once when
    the registry account was created.
  - So an employee registers once (the `spl-elgamal-registry` program, a Rust crate in the
    token-2022 repo, with no JS client on npm yet). After that, the company can create and configure
    their token account for any company token without them signing.
  - Catch: the account starts with an all-zero "decryptable available balance" (the program can't
    encrypt with the owner's AES key). Clients must read all-zero as 0 until the owner's first
    apply-pending writes a real ciphertext.
  - Worth adopting after the hackathon: one employee setup covers every company that pays them.
- [x] Exact auditor-decryption API in `@solana/zk-sdk` (decrypting the lo/hi transfer-amount ciphertexts).
  - Decode the transfer's instruction data with `getConfidentialTransferInstructionDataDecoder`
    (from `@solana-program/token-2022`).
  - Pass `transferAmountAuditorCiphertextLo` and `...Hi` through `ElGamalCiphertext.fromBytes`,
    then `ElGamalSecretKey.decrypt`.
  - amount = lo + (hi << 16). Implemented in `packages/core/src/auditor.ts`.
- [x] Performance of WASM proof generation in the browser and in Node, per transfer.
  - Proof generation alone (`pnpm --filter @sealed/core bench:proofs`, Ryzen 5 5500U, Sep 28):
    - Node: a transfer's three proofs take 77 ms (median of 10); a withdraw's two take 38 ms.
    - Chrome 152 (the same `@solana/zk-sdk` 0.5.3 web build): 81 ms and 39 ms.
  - End to end on Surfpool, a transfer took about 3s and a withdraw about 2.5s. So network
    round trips dominate, not proofs.
  - A 100-person run is about 8s of proving, so a large run's time is set by transaction count
    and confirmation, not proof generation.
- [x] Can v1 transactions carry a whole confidential transfer in one transaction with current tooling?
  - Yes, going by size and compute. Measured offline from real encoded transactions (not sent to a
    cluster yet).
  - A transfer is three inline verify instructions plus the transfer, which reads them through
    the instructions sysvar (offsets -3, -2, -1). It compiles to **2,391 bytes** as a v1
    transaction. A withdraw is **1,721 bytes** with both signatures. The v1 limit is 4,096.
    - Proof data is 320 (equality) + 544 (batched 3-handle validity) + 1,000 (batched U128
      range) bytes for a transfer, and 320 + 936 (batched U64 range) for a withdraw.
  - Compute (Agave's zk-elgamal-proof constants): 6,400 + 16,400 + 200,000 = 222,800 CU of
    verification per transfer, far below the 1.4M per-transaction cap.
  - In v1, the compute-unit limit is a message config field, not an instruction, so it costs no
    instruction bytes. That removes the reason the library's inline plans couldn't take one.
  - Tooling: `@solana/kit` 8.3 compiles v1 messages. Token-2022's generated instruction builders
    take the offsets and the instructions sysvar. The high-level plan helpers still build the
    multi-transaction context-account flow, so a one-transaction path means composing the
    instructions directly.
  - It would cut payroll to one transaction per employee. It would also close the sponsor
    policy's proof-account gap, because a one-transaction withdraw creates no proof accounts.
  - ✅ Verified on devnet (Sep 28), `test/integration/one-transaction-flow.test.ts` 3/3:
    - a payment landed as one v1 transaction of 2,395 bytes and 238,484 CU;
    - a sponsored withdraw landed as one v1 transaction of 1,725 bytes and 123,926 CU, with the
      employee at 0 SOL;
    - both the employee and the accountant decrypt it from chain history.
  - Implemented in `packages/core/src/one-transaction.ts` (`proofDelivery: 'one-transaction'`,
    `transactionVersion: 1`). The app uses it on devnet. Surfpool's v1 support is unverified, so
    localnet stays on v0.
- [x] PYUSD on-chain confidential config: approve policy and auditor.
  - Read on mainnet (Sep 27, 2026):
    - approve policy `manual` (Paxos approves every confidential account);
    - audits disabled (no auditor key, so no accountant view);
    - the confidential transfer-fee extension (currently 0 bps, but transfers must use the
      with-fee instruction);
    - a Paxos permanent delegate.
  - Conclusion: PYUSD can't give Sealed its per-company auditor or open onboarding without Paxos.
    The per-company token backed 1:1 through the Sealed Vault stays the path (§9).
- [x] Does the CLI's key derivation match `solana-conf-bal/v1`? (It affects whether CLI-configured accounts are usable in the app.)
  - Yes, byte for byte (see §7 Keys).
- [x] Colosseum video requirements; sidetrack stacking rules. (Answers are in §14.)
- [ ] University Prize eligibility for a solo student. Neither the official rules nor the FAQ
      define it; ask Colosseum (hackathon@colosseum.com or Discord).

---

## 20. Working conventions for Claude Code

- **Verify before you claim.** For any Solana, Token-2022 or zk-sdk API, flag or function,
  read the installed package source, the Rust source, or `--help`. Never invent signatures.
  Web summaries of these docs have been wrong before.
- **Stack:** TypeScript everywhere possible (Next.js, `@solana/kit` ecosystem, MongoDB via
  Mongoose), plus Rust/Anchor for the vault program. Package manager: pnpm, pinned to 11.x
  through `packageManager` (corepack 0.34 can't launch pnpm 12's native binary).
- All Confidential Balances logic goes in `packages/core` with tests. UI code calls the core
  library, never raw instructions.
- Small, focused commits with clear messages. Keep `README.md` runnable from a clean clone.
- When a milestone is done, tick it in this file and note anything learned under the relevant section.
- **Keep the pitch honest:** amounts hidden, addresses public.

---

## 21. Glossary

- **Confidential Balances:** the Token-2022 extension that encrypts token amounts and balances (formerly "confidential transfers").
- **ElGamal keypair:** encrypts balances and amounts so the network can verify math on encrypted values.
- **AES key:** encrypts a fast-decrypt copy of the available balance for the owner.
- **Pending / available balance:** incoming funds land in pending and must be applied before spending.
- **Auditor key:** a mint-level ElGamal key that can decrypt all transfer amounts on that mint.
- **Approve policy:** `auto` (anyone can configure) or `manual` (the authority approves each account).
- **Payroll Vault signer:** the backend-held keypair that owns a company's confidential treasury (MVP).
- **Sealed Vault program:** the Anchor program that backs each company's confidential token 1:1 with USDC (stretch).

---

## 22. Sources

- Confidential Balances overview: https://solana.com/docs/tokens/extensions/confidential-transfer
- Transfer tokens (TS and Rust): https://solana.com/docs/tokens/extensions/confidential-transfer/transfer-tokens
- Integration guide (keys, balances, auditors): https://solana.com/docs/tokens/extensions/confidential-transfer/integration-guide
- Issuer guide (approve policy, auditor, mint/burn): https://solana.com/docs/tokens/extensions/confidential-transfer/issuer-guide
- CLI guide: https://www.solana-program.com/docs/confidential-balances
- Token Wrap program: https://www.solana-program.com/docs/token-wrap
- CLI source: https://github.com/solana-program/token-2022/tree/main/clients/cli/src
- Mainnet status, native vs Helius Rings: https://xroot.dev/blog/solana-confidential-transfers-native-vs-rings
- Kill switch and proof cost: https://xroot.dev/blog/solana-confidential-transfers-kill-switch-proof-cost
- Superteam India track: https://superteam.fun/earn/listing/colosseum-crypto-worlds-fair-hackathon-superteam-india-track
- Crypto World's Fair: https://colosseum.com/worldsfair
