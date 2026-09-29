# Sealed: pitch

Narrative and deck outline for the Colosseum and Superteam India submissions. Anything in
**[brackets]** is a placeholder to fill with real data before recording. Never invent traction.

## The one-liner

Sealed is private stablecoin payroll on Solana. Companies pay their teams on-chain, and only the
employer, the employee and the company's accountant can see how much anyone earns.

## The story (about 2 minutes spoken)

1. **The problem.** Stablecoins are a normal way to pay remote teams, contractors and DAO
   contributors. On a public chain, every payment is readable by everyone, forever. Your team sees
   each other's salaries. Competitors read your burn rate and know whom to poach. People with big
   balances become targets. Salary confidentiality is the default in every company, and on-chain
   payroll quietly removed it.
2. **The solution.** Sealed pays your team with Solana's native Confidential Balances. Amounts and
   balances are encrypted on-chain, and the network still verifies every payment with
   zero-knowledge proofs. Employees see their own pay in their browser. The accountant gets a
   view-only key that decrypts every payment, for tax and audit. Everyone else sees that a payment
   happened, but not how much.
3. **Why now.** Confidential Balances were disabled in June 2025 after a bug and re-enabled in June
   2026 after audits. Official TypeScript support now makes a browser app realistic. And almost
   nobody has built a product on it: wallets barely support it, and there's no business product.
   Sealed is the first.
4. **What we built.** A working product on devnet: the company dashboard with one-click approved
   payroll runs, the employee portal where people join with zero SOL, and the accountant view with
   CSV export. With the new v1 transaction format, each payment is one transaction: a 10-person run
   takes about 25 seconds. It includes a fee sponsor that checks every transaction it pays for, a
   payroll engine that can't pay anyone twice (tested against a simulated chain where transactions
   land late or never), and the Sealed Vault program for USDC backing. The Confidential Balances
   code is a reusable open-source toolkit (`packages/core`).
5. **Traction.** **[N]** teams contacted, **[N]** devnet pilots or letters of intent. Quote:
   **["…" — Name, Role, Company]**.
6. **What's next.** The Sealed Vault (USDC in, confidential payroll, USDC out), an audit, mainnet,
   Squads approvals for payroll runs, and confidential off-ramps.

## Deck outline (10 slides)

1. **Title.** Sealed: private stablecoin payroll on Solana. One line, logo, devnet demo URL.
2. **Problem.** A real-looking public USDC payroll on an explorer, every salary readable. "Salary
   confidentiality is the default everywhere except on-chain."
3. **Solution.** The who-sees-what table: admin, employee, accountant, everyone else.
4. **Demo screenshots.** Payroll run in progress; the explorer showing no amount; Priya's decrypted
   pay; the accountant's CSV.
5. **How it works.** The architecture diagram (`docs/architecture.png`): keys from the wallet,
   company pays fees, proofs verified on-chain, auditor key.
6. **Why now.** The ZK ElGamal proof program was re-enabled in June 2026, v1 transactions went live
   in September 2026, official TS support exists, and there's no business product yet.
7. **Market.** Teams paying contributors in stablecoins: Solana startups, DAOs, remote-first
   companies. Start with Indian Web3 teams paying global contributors. **[Market sizing with
   sources]**
8. **Traction.** **[Teams contacted, pilots, letters of intent, quotes, devnet payroll runs and
   payments]**
9. **Business model** (hypothesis). A per-active-employee monthly fee, with a free tier for small
   DAOs. Later: premium compliance exports and multisig approvals. **[What pilots said about
   willingness to pay]**
10. **Roadmap and team.** The Sealed Vault, audit (CertiK/Adevar credits), mainnet, Squads
    approvals, confidential off-ramps. The founder: **[name, background, why you]**.

## Say this honestly

- Sealed hides **amounts and balances, not identities.** Addresses and the fact of a payment are
  public. Never say "anonymous".
- Deposits and withdrawals are public amounts. Fund the treasury in round sums; employees shouldn't
  withdraw exactly their salary.
- It runs on test networks only until audited.

## Judge questions

| Question | Answer |
|---|---|
| Isn't this privacy for its own sake? | Salary confidentiality is the default in every company; on-chain payroll removed it. Sealed restores it. |
| Compliance? | The auditor key gives accountants and regulators read access to every amount by design; addresses stay public for screening. |
| USDC doesn't support confidential transfers. | Each company gets its own confidential token backed 1:1 by USDC through the Sealed Vault. PYUSD is a possible alternative. |
| What if confidential transfers get switched off again? | Balances freeze but aren't lost (the ciphertexts survived last time). Sealed keeps only the payroll float confidential and encourages withdrawal after payday. |
| Withdrawals reveal amounts. | True, and the app says so. Round-sum funding, keeping pay private, irregular withdrawals; confidential off-ramps are on the roadmap. |
| Who holds the keys? | Employees derive theirs from their own wallet, in the browser. The accountant holds the auditor key file. The company's Payroll Vault key is on the server for this MVP; production moves it to browser signing or an HSM with multisig approval. |
| Can the company's fee sponsorship be abused? | Every sponsored transaction is checked against a policy (own account only, rent capped, proof rent returns to the company) and rate-limited per employee. |
| India? | Pitch it globally. Paying Indian employees in crypto brings India's crypto tax and TDS rules into play, so lead with companies paying global teams. (Not tax advice.) |
