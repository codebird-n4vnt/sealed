# Sealed: demo video script

A 2–3 minute video that follows one story. It's recorded on devnet so the public explorer works.
Check Colosseum's current length and format rules before recording.

## Before recording

1. Configure `apps/web/.env.local` for devnet (`NEXT_PUBLIC_SOLANA_CLUSTER=devnet`) and start the
   app (`pnpm dev`, or a deployed URL).
2. Seed the demo company: `pnpm seed`. If the devnet airdrop is rate-limited, send 1 devnet SOL to
   the vault address it prints (faucet.solana.com); the script waits for it.
3. In the browser (one profile per role makes switching cleaner):
   - **Admin:** import `.keys/demo/test-wallet-identities.json` into the test wallet, or run the
     seed with `--admin <your Phantom address>`.
   - **Priya:** a fresh wallet with 0 SOL: a new test wallet identity named "Priya", or a new
     Phantom account on devnet.
   - **Accountant:** the seeded accountant identity, and `.keys/demo/auditor-key-acme-dao.json`.
4. Open a public USDC payroll example on Solscan for the opening shot (any transaction list of a
   known payroll or grants wallet, where every amount is readable).
5. Do one dry run of the whole script. Payroll for 10 people takes about 30–60 seconds on devnet, so
   plan to cut or speed up that part.

## Shot list

| # | Time | Screen | Voice-over |
|---|---|---|---|
| 1 | 0:00–0:20 | Solscan: a public stablecoin payroll, amounts highlighted | "This is how teams get paid on-chain today. Every salary, readable by everyone, forever: your team, your competitors, anyone watching big wallets." |
| 2 | 0:20–0:30 | Sealed landing page, the who-sees-what table | "Sealed is private payroll on Solana. Only the employer, the employee and the accountant can see amounts. Everyone else sees that a payment happened, not how much." |
| 3 | 0:30–1:00 | Priya's invite link → connect wallet (0 SOL visible) → sign → "Set up my private account" → "You're all set" | "Priya just joined Acme DAO. She connects her wallet: zero SOL. She signs once, and her private keys are derived in her browser. Acme pays the setup fee." |
| 4 | 1:00–1:40 | Admin dashboard: confidential treasury → Run payroll → review 10 salaries → Approve and pay (wallet signs) → live progress, payments turning green | "Acme's admin reviews this month's payroll: ten people. One signature approves it. Sealed generates zero-knowledge proofs and pays everyone confidentially, one by one." |
| 5 | 1:40–2:00 | Click "See what the public sees": Priya's payment on the explorer | "Here's that payment on the public explorer. A transfer between two addresses, and no amount anywhere." |
| 6 | 2:00–2:25 | Priya's My pay: Unlock → 4,200 decrypted, history → Collect pay → Withdraw a round amount; "0 SOL, fees paid by Acme DAO" | "Priya unlocks her pay with her wallet: 4,200, decrypted only in her browser. She collects it and withdraws, still without ever holding SOL." |
| 7 | 2:25–2:45 | Accountant view: amounts "Encrypted" → load the auditor key file → every amount decrypted → Export CSV | "For tax and audit, the accountant loads the company's auditor key. Every payment decrypts, straight from the chain. Export, done. Compliance is built in." |
| 8 | 2:45–3:00 | Closing slide: why now, traction, roadmap | "Confidential Balances came back to Solana in June 2026, and Sealed is the first business product on them. [Traction line.] Next: the Sealed Vault for USDC, an audit, and mainnet." |

## Technical walkthrough (separate video, if allowed)

1. Architecture diagram: browser, server, chain; where each key lives.
2. `packages/core`: key derivation (matches the CLI byte for byte), the confidential transfer plan
   (three proofs in context-state accounts), auditor and recipient decryption from chain history.
3. The sponsor policy (`sponsor.ts`) and its tests: what the company will and won't pay for.
4. The payroll engine: sequential payments, statuses, and the balance check that prevents paying
   anyone twice. Show a run resuming after a restart.
5. Tests: `pnpm test` and `pnpm test:integration`.
6. Honest limitations: test networks, the vault key on the server, withdrawals are public, the kill
   switch.
