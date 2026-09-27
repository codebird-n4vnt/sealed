# Sealed: submission notes

Everything the Colosseum and Superteam Earn forms ask for, ready to paste. Submit on **Colosseum
first**, then on Superteam Earn (India track) with the Colosseum links.

| | Deadline |
|---|---|
| Colosseum Crypto World's Fair (overall + Solana ecosystem track) | Oct 12, 2026, 11:59 pm PT (Oct 13, 12:29 pm IST) |
| Superteam India track | Oct 13, 2026 (submit on Colosseum first) |

Prizes stack: Colosseum track prizes add to the overall awards, and the Superteam India pool pays
on top of anything won globally. Only work done during the hackathon (from Sep 14) is judged;
Sealed started on Sep 27, so there's no prior work to disclose.

## Project name

Sealed

## Short description (one line)

Private stablecoin payroll on Solana: only the employer, the employee and the accountant can see
how much anyone earns.

## Description

When companies pay their teams in stablecoins, every salary is public forever: teammates see each
other's pay, competitors read the burn rate, and big wallets become targets. Sealed restores
salary privacy with Solana's native Confidential Balances (Token-2022), re-enabled in June 2026.

Amounts and balances are encrypted on-chain and verified with zero-knowledge proofs. The company
funds a confidential treasury and runs payroll with one approved signature. Employees join from an
invite link with zero SOL: their keys are derived from their own wallet in the browser, and the
company pays every fee. The accountant gets a view-only auditor key that decrypts every payment for
tax and audit, with CSV export. Everyone else sees that a payment happened, but not the amount.

What's built: the core library (key derivation, confidential transfers, recipient and auditor
decryption, a fee-sponsorship policy with tests), a company dashboard with resumable payroll runs
that never pay anyone twice, the employee portal, and the accountant view. It all works end to end
on devnet. A Sealed Vault program backs each company token 1:1 with USDC (tested on a mainnet fork).

## Links

- GitHub: https://github.com/codebird-n4vnt/sealed
- Presentation (pitch) video, 2–3 minutes: **[link]**
- Product demo video, at most 3 minutes: **[link]**
- Deck: **[link]** (a draft deck was made alongside the code; share it before linking)
- Logo: `docs/logo.png` (512 × 512) or `docs/logo.svg`
- Live devnet demo: **[URL, once deployed]**
- Colosseum project: **[link]**
- Colosseum profile: **[link]**
- X: **[optional]**

## Checklist

- [ ] Colosseum project created, **country = India**, pre-existing work disclosed (none: started
      Sep 27, 2026).
- [ ] The repo is public, and the README covers setup, architecture and running the demo.
- [ ] Presentation video (2–3 min) and product demo video (≤ 3 min) recorded, in English. Judges
      watch the presentation video early, so make it clear and well produced.
- [ ] Weekly one-minute update videos on the Colosseum dashboard (optional, strongly recommended).
- [ ] The portal also asks for teammates' backgrounds, location, chains and tools, go-to-market,
      demand validation and distribution. Use `docs/pitch.md` and `docs/traction.md`.
- [ ] Deck exported (see `docs/pitch.md`).
- [ ] Live devnet demo deployed and seeded.
- [ ] Traction section filled with real numbers (`docs/traction.md`).
- [ ] Colosseum submission confirmed.
- [ ] Superteam Earn submission (India track) with the GitHub, Colosseum project and profile links.
- [ ] Checked the Superteam Earn FAQ "Can I submit my project to multiple Sidetracks?" before adding any.
- [ ] University Prize: check eligibility for a solo student.

## Deploying the devnet demo

Any Node host works (Render, Railway, Fly.io, a VPS). Vercel works for the pages and API, but
payroll runs are long-lived background jobs, so a server that keeps running is simpler. You need:

- MongoDB (Atlas free tier works) → `MONGODB_URI`.
- `DATA_ENCRYPTION_KEY` (32 random bytes, base64).
- `NEXT_PUBLIC_SOLANA_CLUSTER=devnet`, and ideally a private devnet RPC (Helius, Triton, QuickNode) in
  both `NEXT_PUBLIC_RPC_URL` and `RPC_URL`. The public devnet RPC rate-limits and has had outages.
- `pnpm install && pnpm --filter @sealed/web build && pnpm --filter @sealed/web start`.
