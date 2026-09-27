# Sealed

Private stablecoin payroll on Solana. Salaries move on-chain, but amounts stay encrypted,
so only the employer, the employee and the company's accountant can read them.

Built on Token-2022 **Confidential Balances**, which were re-enabled on Solana mainnet in June 2026.

> Status: the core works. The CLI go/no-go test (M0) and the TypeScript core library with its
> end-to-end test (M1) both pass on a mainnet fork; the devnet run of M0 is pending a devnet RPC outage.
> Next: the employee portal (M2).

## Repo layout

| Path | What it is |
|---|---|
| `packages/core` | TypeScript library with all Confidential Balances logic: keys, account setup, deposit, pay, collect, withdraw, balance and auditor decryption |
| `scripts/day1-confidential-transfer.sh` | The go/no-go test with the `spl-token` CLI |
| `CLAUDE.md` | The full project plan |

## Day 1: prove the core works (CLI)

Requirements: the Solana CLI and `spl-token` (`cargo install spl-token-cli --locked`).

```bash
bash scripts/day1-confidential-transfer.sh
```

What it does, on devnet:
1. Creates a test stablecoin with confidential transfers enabled.
2. Gives an employer and an employee separate wallets.
3. The employer pays the employee confidentially and covers every fee, so the employee needs 0 SOL.
4. The employee withdraws the payment.
5. The script checks the numbers and prints **GO** or **NO-GO**.

If the devnet airdrop is rate-limited, get SOL at https://faucet.solana.com for the employer
address the script prints, then run it again.

## The core library

Requirements: Node 24+ and pnpm (`corepack enable pnpm`).

```bash
pnpm install
pnpm test                 # unit tests
pnpm test:integration     # the full payroll flow against a live cluster (below)
```

The integration test runs the day-1 flow in TypeScript and adds the accountant: the company
token requires the company to approve each account, and its auditor key belongs to the
accountant, who decrypts the payment from the chain. The employee is a fresh wallet with 0 SOL
on every run.

It needs a cluster with the ZK ElGamal proof program (a stock `solana-test-validator` doesn't
enable it). By default it uses [Surfpool](https://surfpool.run), a local validator that forks mainnet:

```bash
surfpool start --network mainnet --no-tui     # in another terminal
pnpm test:integration
```

Or run it on devnet (the employer in `.keys/employer.json` needs about 0.2 SOL):

```bash
RPC_URL=devnet pnpm test:integration
```

The CLI script also takes `RPC_URL=http://127.0.0.1:8899` to run on Surfpool.

## What's private and what isn't

| Private | Public |
|---|---|
| Salary amounts, account balances | Wallet and token account addresses, the mint, and that (and when) a payment happened |
| | Amounts moved into or out of confidential balances (funding the treasury, withdrawing) |
