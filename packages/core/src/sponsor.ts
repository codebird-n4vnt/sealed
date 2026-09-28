/**
 * Fee sponsorship: the company pays for its employees' transactions (account setup, collecting
 * pay, withdrawing), so employees need zero SOL.
 *
 * Employee transactions are built in the employee's browser, because their proofs need the
 * employee's secret keys. The server then co-signs as fee payer. Before it does, this module
 * checks that the transaction can only spend the company's SOL on fees and on rent for accounts
 * that either belong to the employee's own token account or come back to the company:
 *
 * - Fee payer must be the sponsor. No address lookup tables. Legacy, v0 and v1 transactions; a
 *   v1 transaction's priority fee (a total in lamports, set in the message) is capped.
 * - Only these programs: Compute Budget, System, Associated Token, Token-2022, ZK ElGamal Proof.
 * - System: only CreateAccount funded by the sponsor, for ZK proof context accounts, at no more
 *   than rent-exempt lamports, at most two per transaction.
 * - Associated Token: only creating the employee's own account for the company mint.
 * - Token-2022: only Reallocate and the confidential Configure / Deposit / Withdraw /
 *   ApplyPendingBalance instructions, all on the employee's own token account.
 * - ZK proof program: verify instructions (context authority must be the sponsor, so only the
 *   sponsor can close the account and reclaim its rent) and CloseContextState with the rent
 *   returned to the sponsor.
 *
 * Known gap, in legacy/v0 transactions only: large proofs (the withdraw range proof) don't fit
 * in one transaction with their CreateAccount, so an account can be created in one transaction
 * and verified in the next. In between, someone could verify into it with their own authority and
 * later reclaim its rent (about 0.002 SOL). The server rate-limits sponsored proof accounts per
 * employee to bound this. One-transaction withdrawals in the v1 format (`one-transaction.ts`)
 * create no proof accounts at all, so they don't have the gap.
 */
import {
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  getTransactionEncoder,
  getU32Decoder,
  getU64Decoder,
  signBytes,
  type Address,
  type KeyPairSigner,
  type ReadonlyUint8Array,
  type SignatureBytes,
  type TransactionPartialSigner,
} from '@solana/kit';
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
} from '@solana-program/token-2022';

export const SYSTEM_PROGRAM_ADDRESS = '11111111111111111111111111111111' as Address;
export const COMPUTE_BUDGET_PROGRAM_ADDRESS = 'ComputeBudget111111111111111111111111111111' as Address;
export const ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS = 'ZkE1Gama1Proof11111111111111111111111111111' as Address;

// Instruction discriminators, checked against the installed program clients.
const SYSTEM_CREATE_ACCOUNT = 0;
const ATA_CREATE = 0;
const ATA_CREATE_IDEMPOTENT = 1;
const TOKEN_REALLOCATE = 29;
const TOKEN_CONFIDENTIAL_EXTENSION = 27;
const CONFIDENTIAL_CONFIGURE = 2;
const CONFIDENTIAL_DEPOSIT = 5;
const CONFIDENTIAL_WITHDRAW = 6;
const CONFIDENTIAL_APPLY_PENDING = 8;
const ZK_CLOSE_CONTEXT_STATE = 0;
const ZK_LAST_VERIFY = 12; // VerifyBatchedGroupedCiphertext3HandlesValidity
const COMPUTE_SET_UNIT_LIMIT = 2;
const COMPUTE_SET_UNIT_PRICE = 3;
const COMPUTE_SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT = 4;

const ALLOWED_CONFIDENTIAL_INSTRUCTIONS = new Set([
  CONFIDENTIAL_CONFIGURE,
  CONFIDENTIAL_DEPOSIT,
  CONFIDENTIAL_WITHDRAW,
  CONFIDENTIAL_APPLY_PENDING,
]);

/** Proof context accounts are small; this leaves ample room while bounding the rent at stake. */
const MAX_CONTEXT_ACCOUNT_SPACE = 4_096n;
const MAX_CONTEXT_ACCOUNTS_PER_TRANSACTION = 2;
/** Rent-exempt minimum: (128-byte account overhead + data) × 3,480 lamports/byte-year × 2 years. */
const rentExemptLamports = (space: bigint) => (128n + space) * 6_960n;

export type SponsorPolicy = {
  /** The company's fee payer (its Payroll Vault signer). */
  sponsor: Address;
  /** The employee's wallet. */
  owner: Address;
  /** The employee's token account for the company mint. */
  token: Address;
  mint: Address;
  /** Highest priority fee the sponsor will pay, in micro-lamports per compute unit (legacy/v0). */
  maxComputeUnitPrice?: bigint;
  /** Highest total priority fee the sponsor will pay in a v1 transaction, in lamports. */
  maxPriorityFeeLamports?: bigint;
};

export class SponsorPolicyError extends Error {
  constructor(message: string) {
    super(`Refusing to sponsor: ${message}`);
    this.name = 'SponsorPolicyError';
  }
}

const reject = (message: string): never => {
  throw new SponsorPolicyError(message);
};

/**
 * Checks a serialized (wire-format) transaction against the sponsorship policy.
 * Throws SponsorPolicyError explaining the first violation. Returns how many new (rent-bearing)
 * accounts the sponsor would fund, for rate limiting.
 */
export function checkSponsoredTransaction(
  wireTransaction: ReadonlyUint8Array,
  policy: SponsorPolicy,
): { newAccounts: number } {
  const transaction = getTransactionDecoder().decode(wireTransaction);
  const message = getCompiledTransactionMessageDecoder().decode(transaction.messageBytes);

  if (message.version !== 'legacy' && message.version !== 0 && message.version !== 1) {
    throw new SponsorPolicyError(`unsupported transaction version ${String((message as { version: unknown }).version)}`);
  }
  if ('addressTableLookups' in message && (message.addressTableLookups?.length ?? 0) > 0) {
    reject('address lookup tables are not allowed');
  }
  if (message.version === 1) {
    // Config values follow the mask's order; the priority fee (both low bits set) comes first.
    const priorityFee = (message.configMask & 0b11) === 0b11 ? message.configValues[0] : undefined;
    const maxFee = policy.maxPriorityFeeLamports ?? 100_000n;
    if (priorityFee && BigInt(priorityFee.value) > maxFee) reject(`priority fee above ${maxFee} lamports`);
  }
  // v1 messages split each instruction into a header and a payload.
  const instructions =
    message.version === 1
      ? message.instructionHeaders.map((header, index) => ({
          programAddressIndex: header.programAccountIndex,
          accountIndices: message.instructionPayloads[index]?.instructionAccountIndices,
          data: message.instructionPayloads[index]?.instructionData,
        }))
      : message.instructions;

  const accounts = message.staticAccounts;
  if (accounts[0] !== policy.sponsor) reject('the fee payer must be the company');

  const maxPrice = policy.maxComputeUnitPrice ?? 1_000_000n;
  let createdContextAccounts = 0;

  for (const [position, instruction] of instructions.entries()) {
    const at = `instruction ${position}`;
    const program = accounts[instruction.programAddressIndex];
    const data = instruction.data ?? new Uint8Array();
    const keys = (instruction.accountIndices ?? []).map(index => accounts[index] ?? reject(`${at}: bad account index`));
    const account = (index: number) => keys[index] ?? reject(`${at}: missing account ${index}`);

    switch (program) {
      case COMPUTE_BUDGET_PROGRAM_ADDRESS: {
        if (data[0] === COMPUTE_SET_UNIT_PRICE) {
          if (getU64Decoder().decode(data, 1) > maxPrice) reject(`${at}: priority fee above ${maxPrice} micro-lamports`);
        } else if (data[0] !== COMPUTE_SET_UNIT_LIMIT && data[0] !== COMPUTE_SET_LOADED_ACCOUNTS_DATA_SIZE_LIMIT) {
          reject(`${at}: compute budget instruction ${data[0]} not allowed`);
        }
        break;
      }

      case SYSTEM_PROGRAM_ADDRESS: {
        if (data.length !== 52 || getU32Decoder().decode(data) !== SYSTEM_CREATE_ACCOUNT) {
          reject(`${at}: only CreateAccount is allowed on the System program`);
        }
        const lamports = getU64Decoder().decode(data, 4);
        const space = getU64Decoder().decode(data, 12);
        const owner = getAddressDecoder().decode(data.slice(20, 52));
        if (account(0) !== policy.sponsor) reject(`${at}: accounts must be funded by the company`);
        if (owner !== ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS) reject(`${at}: may only create ZK proof context accounts`);
        if (space > MAX_CONTEXT_ACCOUNT_SPACE) reject(`${at}: account too large`);
        if (lamports > rentExemptLamports(space)) reject(`${at}: more lamports than rent requires`);
        if (++createdContextAccounts > MAX_CONTEXT_ACCOUNTS_PER_TRANSACTION) reject(`${at}: too many new accounts`);
        break;
      }

      case ASSOCIATED_TOKEN_PROGRAM_ADDRESS: {
        if (data.length > 1 || (data.length === 1 && data[0] !== ATA_CREATE && data[0] !== ATA_CREATE_IDEMPOTENT)) {
          reject(`${at}: only creating a token account is allowed`);
        }
        // Accounts: payer, associated token, owner, mint, system program, token program.
        if (account(1) !== policy.token || account(2) !== policy.owner || account(3) !== policy.mint) {
          reject(`${at}: may only create the employee's own token account for this company`);
        }
        if (account(5) !== TOKEN_2022_PROGRAM_ADDRESS) reject(`${at}: token account must use Token-2022`);
        break;
      }

      case TOKEN_2022_PROGRAM_ADDRESS: {
        const allowed =
          data[0] === TOKEN_REALLOCATE ||
          (data[0] === TOKEN_CONFIDENTIAL_EXTENSION && ALLOWED_CONFIDENTIAL_INSTRUCTIONS.has(data[1] ?? -1));
        if (!allowed) reject(`${at}: Token-2022 instruction ${data[0]}/${data[1]} not allowed`);
        if (account(0) !== policy.token) reject(`${at}: may only act on the employee's own token account`);
        break;
      }

      case ZK_ELGAMAL_PROOF_PROGRAM_ADDRESS: {
        const kind = data[0] ?? -1;
        if (kind === ZK_CLOSE_CONTEXT_STATE) {
          // Accounts: context state, destination, authority.
          if (account(1) !== policy.sponsor) reject(`${at}: proof account rent must return to the company`);
        } else if (kind >= 1 && kind <= ZK_LAST_VERIFY) {
          // Proof read from another account: [proof account, context?, authority?]; inline: [context?, authority?].
          const proofFromAccount = data.length === 5;
          const contextKeys = proofFromAccount ? keys.slice(1) : keys;
          if (contextKeys.length > 0 && contextKeys[1] !== policy.sponsor) {
            reject(`${at}: proof context authority must be the company`);
          }
        } else {
          reject(`${at}: ZK proof instruction ${kind} not allowed`);
        }
        break;
      }

      default:
        reject(`${at}: program ${program} not allowed`);
    }
  }
  return { newAccounts: createdContextAccounts };
}

/**
 * A fee-payer signer for the employee's side: it gets each transaction's sponsor signature from
 * `sign` (in the app, a call to the company's server, which runs sponsorTransaction).
 */
export function createRemoteSponsorSigner(
  address: Address,
  sign: (wireTransaction: Uint8Array) => Promise<SignatureBytes>,
): TransactionPartialSigner {
  return {
    address,
    async signTransactions(transactions) {
      return await Promise.all(
        transactions.map(async transaction => ({
          [address]: await sign(new Uint8Array(getTransactionEncoder().encode(transaction))),
        })),
      );
    },
  };
}

/** Checks the transaction against the policy, then signs it as the sponsor. */
export async function sponsorTransaction(
  wireTransaction: ReadonlyUint8Array,
  sponsor: KeyPairSigner,
  policy: Omit<SponsorPolicy, 'sponsor'>,
): Promise<SignatureBytes> {
  checkSponsoredTransaction(wireTransaction, { ...policy, sponsor: sponsor.address });
  const { messageBytes } = getTransactionDecoder().decode(wireTransaction);
  return await signBytes(sponsor.keyPair.privateKey, messageBytes);
}
