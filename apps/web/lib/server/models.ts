import 'server-only';

import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose';

// Salaries, payment amounts and keys are stored encrypted (fields ending in `Enc`).
// Never stored at all: employee key-derivation signatures, derived keys, the auditor secret.

const storedKeypair = new Schema(
  { address: { type: String, required: true }, seedEnc: { type: String, required: true } },
  { _id: false },
);

const companySchema = new Schema(
  {
    name: { type: String, required: true },
    symbol: { type: String, required: true },
    decimals: { type: Number, required: true, default: 6 },
    adminWallet: { type: String, required: true, index: true },
    accountantWallets: { type: [String], default: [], index: true },
    auditorElgamalPubkey: { type: String, required: true },
    /** The Payroll Vault signer (devnet only): owns the treasury, pays fees, mint + approve authority. */
    vault: { type: storedKeypair, required: true },
    /** Kept so an interrupted setup reuses the same mint address. */
    mint: { type: storedKeypair, required: true },
    treasuryAccount: { type: String },
    status: { type: String, enum: ['setup', 'ready'], default: 'setup' },
  },
  { timestamps: true },
);

const memberSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true },
    email: { type: String },
    wallet: { type: String, index: true },
    salaryEnc: { type: String, required: true },
    inviteToken: { type: String, required: true, unique: true },
    status: { type: String, enum: ['invited', 'joined', 'ready'], default: 'invited' },
    tokenAccount: { type: String },
    /** Sponsorship rate limit window. */
    sponsor: {
      windowStart: { type: Date, default: () => new Date(0) },
      transactions: { type: Number, default: 0 },
      newAccounts: { type: Number, default: 0 },
    },
    joinedAt: Date,
    readyAt: Date,
  },
  { timestamps: true },
);

memberSchema.index(
  { companyId: 1, wallet: 1 },
  { name: 'one_member_per_wallet_per_company', unique: true, partialFilterExpression: { wallet: { $type: 'string' } } },
);

const payrollRunSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    status: { type: String, enum: ['draft', 'running', 'completed', 'partial', 'failed'], default: 'draft' },
    createdBy: { type: String, required: true },
    totalEnc: { type: String, required: true },
    count: { type: Number, required: true },
    approval: { message: String, signature: String, wallet: String },
    startedAt: Date,
    finishedAt: Date,
    heartbeatAt: Date,
  },
  { timestamps: true },
);

// At most one running payroll run per company: payments from one treasury must go out in order,
// so two concurrent runs would race on the same balance.
payrollRunSchema.index(
  { companyId: 1 },
  { name: 'one_running_run_per_company', unique: true, partialFilterExpression: { status: 'running' } },
);

const paymentSchema = new Schema(
  {
    runId: { type: Schema.Types.ObjectId, ref: 'PayrollRun', required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true },
    memberId: { type: Schema.Types.ObjectId, ref: 'Member', required: true },
    name: { type: String, required: true },
    wallet: { type: String, required: true },
    amountEnc: { type: String, required: true },
    status: {
      type: String,
      enum: ['pending', 'proving', 'submitted', 'confirmed', 'failed'],
      default: 'pending',
    },
    /** The treasury's available balance before the attempt; lets a retry tell if it landed. */
    treasuryBeforeEnc: String,
    attempts: { type: Number, default: 0 },
    signature: String,
    error: String,
  },
  { timestamps: true },
);

const sessionSchema = new Schema({
  tokenHash: { type: String, required: true, unique: true },
  wallet: { type: String, required: true },
  expiresAt: { type: Date, required: true, expires: 0 },
});

const nonceSchema = new Schema({
  value: { type: String, required: true, unique: true },
  usedAt: Date,
  expiresAt: { type: Date, required: true, expires: 0 },
});

function model<T extends Schema>(name: string, schema: T): Model<InferSchemaType<T>> {
  return (mongoose.models[name] as Model<InferSchemaType<T>>) ?? mongoose.model(name, schema);
}

export const Company = model('Company', companySchema);
export const Member = model('Member', memberSchema);
export const PayrollRun = model('PayrollRun', payrollRunSchema);
export const Payment = model('Payment', paymentSchema);
export const Session = model('Session', sessionSchema);
export const Nonce = model('Nonce', nonceSchema);

export type CompanyDoc = InstanceType<typeof Company>;
export type MemberDoc = InstanceType<typeof Member>;
export type PayrollRunDoc = InstanceType<typeof PayrollRun>;
export type PaymentDoc = InstanceType<typeof Payment>;
