#!/usr/bin/env bash
# Sealed — Day 1 go/no-go test.
#
# Proves the core of Sealed works end to end on devnet:
#   an EMPLOYER pays an EMPLOYEE confidentially, the employee receives and withdraws it,
#   and the employer pays every transaction fee (the employee needs zero SOL).
#
# Usage (from the repo root):
#   bash scripts/day1-confidential-transfer.sh
#
# Optional:
#   RPC_URL=http://127.0.0.1:8899 bash scripts/day1-confidential-transfer.sh   # e.g. Surfpool
#   PAY_AMOUNT=250 FUND_AMOUNT=1000 bash scripts/day1-confidential-transfer.sh
#
# Note: a stock solana-test-validator does NOT enable the ZK ElGamal proof program.
# Use devnet (default) or a mainnet-forking validator such as Surfpool.

set -euo pipefail

RPC_URL="${RPC_URL:-devnet}"
FUND_AMOUNT="${FUND_AMOUNT:-1000}"   # test stablecoin minted to the employer
PAY_AMOUNT="${PAY_AMOUNT:-250}"      # one "salary" payment
TOKEN_2022="TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KEYS="$ROOT/.keys"
RUN="$KEYS/run-$(date +%Y%m%d-%H%M%S)"
CFG="$KEYS/solana-cli.yml"

say()  { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m✔ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✘ %s\033[0m\n' "$*" >&2; exit 1; }

explorer_cluster() {
  case "$RPC_URL" in
    devnet|d|*devnet*) echo "?cluster=devnet" ;;
    *) echo "?cluster=custom&customUrl=$RPC_URL" ;;
  esac
}

# ---------------------------------------------------------------------------
say "Checking tools"
command -v solana >/dev/null        || fail "solana CLI not found. Install: https://solana.com/docs/intro/installation"
command -v solana-keygen >/dev/null || fail "solana-keygen not found (comes with the solana CLI)."
command -v spl-token >/dev/null     || fail "spl-token not found. Install: cargo install spl-token-cli --locked"
SPL_HELP="$(spl-token --help 2>&1 || true)"
grep -q "configure-confidential-transfer-account" <<<"$SPL_HELP" \
  || fail "Your spl-token is too old for confidential transfers. Run: cargo install spl-token-cli --locked"
ok "solana: $(solana --version | head -n1)"
ok "spl-token: $(spl-token --version | head -n1)"

# ---------------------------------------------------------------------------
say "Setting up keys in .keys/ (gitignored)"
mkdir -p "$KEYS" "$RUN"
chmod 700 "$KEYS"

new_key() { [ -f "$1" ] || solana-keygen new -o "$1" --no-bip39-passphrase --silent >/dev/null; }
new_key "$KEYS/employer.json"   # company wallet: pays fees, holds treasury, mint authority
new_key "$KEYS/employee.json"   # employee wallet: owns their salary account, pays nothing
new_key "$RUN/mint.json"        # fresh test stablecoin mint for this run
new_key "$RUN/employer-acct.json"
new_key "$RUN/employee-acct.json"

# A dedicated CLI config so we never touch your global solana config.
solana config set -C "$CFG" --url "$RPC_URL" --keypair "$KEYS/employer.json" >/dev/null

EMPLOYER="$(solana-keygen pubkey "$KEYS/employer.json")"
EMPLOYEE="$(solana-keygen pubkey "$KEYS/employee.json")"
MINT="$(solana-keygen pubkey "$RUN/mint.json")"
ER_ACCT="$(solana-keygen pubkey "$RUN/employer-acct.json")"
EE_ACCT="$(solana-keygen pubkey "$RUN/employee-acct.json")"
ok "Employer wallet: $EMPLOYER"
ok "Employee wallet: $EMPLOYEE"

# Every spl-token call: our config, and the employer pays the fee. --fee-payer must be explicit:
# when a command passes --owner, spl-token otherwise makes that owner the fee payer.
ST=(spl-token -C "$CFG" --fee-payer "$KEYS/employer.json")

solana -C "$CFG" block-height >/dev/null 2>&1 \
  || fail "Can't reach the RPC at '$RPC_URL'. Check your internet (or that Surfpool is running)."

# ---------------------------------------------------------------------------
say "Funding the employer with SOL for fees"
lamports() { solana -C "$CFG" balance "$1" --lamports | awk '{print $1}'; }
if [ "$(lamports "$EMPLOYER")" -lt 500000000 ]; then
  solana -C "$CFG" airdrop 1 "$EMPLOYER" >/dev/null 2>&1 || true
  sleep 3
fi
if [ "$(lamports "$EMPLOYER")" -lt 200000000 ]; then
  fail "Employer has too little SOL and the airdrop was rate-limited.
Get devnet SOL at https://faucet.solana.com for: $EMPLOYER
then run this script again."
fi
ok "Employer balance: $(solana -C "$CFG" balance "$EMPLOYER")"
ok "Employee balance: $(solana -C "$CFG" balance "$EMPLOYEE")  (stays at 0 — the company pays all fees)"

# ---------------------------------------------------------------------------
say "1/9 Creating a test stablecoin with confidential transfers enabled (6 decimals)"
"${ST[@]}" --program-id "$TOKEN_2022" create-token "$RUN/mint.json" \
  --decimals 6 --enable-confidential-transfers auto
ok "Mint: $MINT"

say "2/9 Creating token accounts (employer pays for both)"
"${ST[@]}" create-account "$MINT" "$RUN/employer-acct.json"
"${ST[@]}" create-account "$MINT" "$RUN/employee-acct.json" --owner "$EMPLOYEE"
ok "Employer account: $ER_ACCT"
ok "Employee account: $EE_ACCT"

say "3/9 Configuring confidential transfers (each OWNER signs; employer pays the fee)"
"${ST[@]}" configure-confidential-transfer-account --address "$ER_ACCT"
"${ST[@]}" configure-confidential-transfer-account --address "$EE_ACCT" --owner "$KEYS/employee.json"

say "4/9 Minting $FUND_AMOUNT test stablecoins to the employer treasury (public)"
"${ST[@]}" mint "$MINT" "$FUND_AMOUNT" "$ER_ACCT"

say "5/9 Employer deposits the treasury into its confidential balance"
"${ST[@]}" deposit-confidential-tokens "$MINT" "$FUND_AMOUNT" --address "$ER_ACCT"
"${ST[@]}" apply-pending-balance --address "$ER_ACCT"

say "6/9 PAYROLL: employer pays $PAY_AMOUNT to the employee CONFIDENTIALLY"
"${ST[@]}" transfer "$MINT" "$PAY_AMOUNT" "$EE_ACCT" --from "$ER_ACCT" --confidential

say "7/9 What the public sees on the employee account (public balance should be 0)"
"${ST[@]}" display "$EE_ACCT"

say "8/9 Employee applies pending balance and withdraws (employer still pays fees)"
"${ST[@]}" apply-pending-balance --address "$EE_ACCT" --owner "$KEYS/employee.json"
"${ST[@]}" withdraw-confidential-tokens "$MINT" "$PAY_AMOUNT" --address "$EE_ACCT" --owner "$KEYS/employee.json"

say "9/9 Checking the result"
EE_PUBLIC="$("${ST[@]}" balance --address "$EE_ACCT" | awk 'NF{v=$1} END{print v}')"  # output ends with a blank line
EE_SOL="$(lamports "$EMPLOYEE")"
echo "Employee public token balance after withdraw: $EE_PUBLIC (expected $PAY_AMOUNT)"

if [ "$EE_SOL" = "0" ]; then
  ok "Employee paid zero fees"
else
  printf '\033[1;33m! Employee wallet holds %s lamports (expected 0 unless you funded it yourself)\033[0m\n' "$EE_SOL"
fi

if awk -v a="$EE_PUBLIC" -v b="$PAY_AMOUNT" 'BEGIN{exit !(a+0==b+0)}'; then
  C="$(explorer_cluster)"
  printf '\n\033[1;32mGO ✅  Confidential payroll works end to end.\033[0m\n'
  cat <<EOF

Open these the way the public would. You'll see the transactions, but not the payment amount:
  Employee account: https://explorer.solana.com/address/$EE_ACCT$C
  Employer account: https://explorer.solana.com/address/$ER_ACCT$C
  Mint:             https://explorer.solana.com/address/$MINT$C

Run details saved in: $RUN
Next: reproduce this flow in code (see CLAUDE.md → "Proposed architecture").
EOF
else
  fail "NO-GO: the balances didn't match. Scroll up for the first error and paste it into Claude Code."
fi
