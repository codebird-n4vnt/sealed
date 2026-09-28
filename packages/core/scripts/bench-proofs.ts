/**
 * Times proof generation for one confidential transfer and one withdraw, the same proofs
 * @solana-program/token-2022's instruction plans build, with synthetic keys and balances. Then
 * builds each as ONE v1 transaction (proofs verified inline, read by Token-2022 through the
 * instructions sysvar) and prints its encoded size against the v1 and legacy limits.
 *
 * No cluster needed: addresses and the blockhash are placeholders, which doesn't change the size.
 *
 *   pnpm --filter @sealed/core bench:proofs
 */
import { getConfidentialTransferInstruction, getConfidentialWithdrawInstruction } from '@solana-program/token-2022';
import {
  verifyBatchedGroupedCiphertext3HandlesValidity,
  verifyBatchedRangeProofU128,
  verifyBatchedRangeProofU64,
  verifyCiphertextCommitmentEquality,
} from '@solana-program/zk-elgamal-proof';
import {
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getTransactionSize,
  getTransactionSizeLimit,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import {
  AeKey,
  BatchedGroupedCiphertext3HandlesValidityProofData,
  BatchedRangeProofU128Data,
  BatchedRangeProofU64Data,
  CiphertextCommitmentEqualityProofData,
  ElGamalKeypair,
  GroupedElGamalCiphertext3Handles,
  PedersenCommitment,
  PedersenOpening,
} from '@solana/zk-sdk/bundler';

const RUNS = Number(process.env.RUNS ?? 10);
const BALANCE = 150_000_000_000n; // 150,000 tokens at 6 decimals
const AMOUNT = 4_200_000_000n; // 4,200
const LO_BITS = 16n;
const INSTRUCTIONS_SYSVAR = 'Sysvar1nstructions1111111111111111111111111' as Address;

const sender = new ElGamalKeypair();
const recipient = new ElGamalKeypair().pubkey();
const auditor = new ElGamalKeypair().pubkey();
const aeKey = new AeKey();

function transferProofs() {
  const lo = AMOUNT & ((1n << LO_BITS) - 1n);
  const hi = AMOUNT >> LO_BITS;
  const [openingLo, openingHi] = [new PedersenOpening(), new PedersenOpening()];
  const groupedLo = GroupedElGamalCiphertext3Handles.encryptWith(sender.pubkey(), recipient, auditor, lo, openingLo);
  const groupedHi = GroupedElGamalCiphertext3Handles.encryptWith(sender.pubkey(), recipient, auditor, hi, openingHi);

  const remaining = BALANCE - AMOUNT;
  const remainingOpening = new PedersenOpening();
  const remainingCommitment = PedersenCommitment.from(remaining, remainingOpening);
  const remainingCiphertext = sender.pubkey().encryptWith(remaining, new PedersenOpening());

  const equality = new CiphertextCommitmentEqualityProofData(sender, remainingCiphertext, remainingCommitment, remainingOpening, remaining);
  const validity = new BatchedGroupedCiphertext3HandlesValidityProofData(
    sender.pubkey(), recipient, auditor, groupedLo, groupedHi, lo, hi, openingLo, openingHi,
  );
  const paddingOpening = new PedersenOpening();
  const range = new BatchedRangeProofU128Data(
    [
      remainingCommitment,
      PedersenCommitment.fromBytes(groupedLo.toBytes().slice(0, 32)),
      PedersenCommitment.fromBytes(groupedHi.toBytes().slice(0, 32)),
      PedersenCommitment.from(0n, paddingOpening),
    ],
    new BigUint64Array([remaining, lo, hi, 0n]),
    Uint8Array.from([64, 16, 32, 16]),
    [remainingOpening, openingLo, openingHi, paddingOpening],
  );
  // The auditor's copies of lo and hi: commitment plus the third handle (see auditor.ts).
  const auditorCiphertext = (grouped: Uint8Array) => Uint8Array.from([...grouped.slice(0, 32), ...grouped.slice(96, 128)]);
  return {
    equality: equality.toBytes(),
    validity: validity.toBytes(),
    range: range.toBytes(),
    auditorLo: auditorCiphertext(groupedLo.toBytes()),
    auditorHi: auditorCiphertext(groupedHi.toBytes()),
    newBalance: aeKey.encrypt(remaining).toBytes(),
  };
}

function withdrawProofs() {
  const remaining = BALANCE - AMOUNT;
  const opening = new PedersenOpening();
  const commitment = PedersenCommitment.from(remaining, opening);
  const ciphertext = sender.pubkey().encryptWith(remaining, new PedersenOpening());
  const equality = new CiphertextCommitmentEqualityProofData(sender, ciphertext, commitment, opening, remaining);
  const range = new BatchedRangeProofU64Data([commitment], new BigUint64Array([remaining]), Uint8Array.from([64]), [opening]);
  return { equality: equality.toBytes(), range: range.toBytes(), newBalance: aeKey.encrypt(remaining).toBytes() };
}

function time(label: string, build: () => Record<string, Uint8Array>) {
  build(); // warm up
  const samples: number[] = [];
  for (let i = 0; i < RUNS; i++) {
    const start = performance.now();
    build();
    samples.push(performance.now() - start);
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)]!;
  console.log(`${label}: median ${median.toFixed(0)} ms (min ${samples[0]!.toFixed(0)}, max ${samples.at(-1)!.toFixed(0)}) over ${RUNS} runs`);
}

// The verify helpers only need RPC to fund a context account, which inline verification skips.
const noRpc = undefined as never;

async function sizeAsOneV1Transaction(label: string, feePayer: TransactionSigner, instructions: Instruction[]) {
  const message = pipe(
    createTransactionMessage({ version: 1 }),
    m => setTransactionMessageFeePayerSigner(feePayer, m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: blockhash('11111111111111111111111111111111'), lastValidBlockHeight: 0n }, m),
    m => setTransactionMessageComputeUnitLimit(400_000, m),
    m => appendTransactionMessageInstructions(instructions, m),
  );
  const transaction = compileTransaction(message);
  console.log(
    `${label} as one v1 transaction: ${getTransactionSize(transaction)} bytes ` +
      `(v1 limit ${getTransactionSizeLimit(transaction)}, legacy limit 1232), ` +
      `${Object.keys(transaction.signatures).length} signature(s)`,
  );
}

time('transfer proofs', transferProofs);
time('withdraw proofs', withdrawProofs);

const [company, employee, source, destination, mint] = await Promise.all([
  generateKeyPairSigner(),
  generateKeyPairSigner(),
  generateKeyPairSigner(),
  generateKeyPairSigner(),
  generateKeyPairSigner(),
]);

// Payroll: the company's vault pays and signs as the treasury owner.
const t = transferProofs();
await sizeAsOneV1Transaction('transfer', company, [
  ...(await verifyCiphertextCommitmentEquality({ rpc: noRpc, payer: company, proofData: t.equality })),
  ...(await verifyBatchedGroupedCiphertext3HandlesValidity({ rpc: noRpc, payer: company, proofData: t.validity })),
  ...(await verifyBatchedRangeProofU128({ rpc: noRpc, payer: company, proofData: t.range })),
  getConfidentialTransferInstruction({
    sourceToken: source.address,
    mint: mint.address,
    destinationToken: destination.address,
    instructionsSysvar: INSTRUCTIONS_SYSVAR,
    authority: company,
    newSourceDecryptableAvailableBalance: t.newBalance,
    transferAmountAuditorCiphertextLo: t.auditorLo,
    transferAmountAuditorCiphertextHi: t.auditorHi,
    equalityProofInstructionOffset: -3,
    ciphertextValidityProofInstructionOffset: -2,
    rangeProofInstructionOffset: -1,
  }),
]);

// Employee withdraw: the employee signs as owner, the company co-signs as fee payer.
const w = withdrawProofs();
await sizeAsOneV1Transaction('withdraw', company, [
  ...(await verifyCiphertextCommitmentEquality({ rpc: noRpc, payer: company, proofData: w.equality })),
  ...(await verifyBatchedRangeProofU64({ rpc: noRpc, payer: company, proofData: w.range })),
  getConfidentialWithdrawInstruction({
    token: source.address,
    mint: mint.address,
    instructionsSysvar: INSTRUCTIONS_SYSVAR,
    authority: employee,
    amount: 1_000_000_000n,
    decimals: 6,
    newDecryptableAvailableBalance: w.newBalance,
    equalityProofInstructionOffset: -2,
    rangeProofInstructionOffset: -1,
  }),
]);
