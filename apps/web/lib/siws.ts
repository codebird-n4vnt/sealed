// Sign-In With Solana messages (the same text format wallets show for `solana:signIn`).

export type SignInFields = {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  chainId: string;
  nonce: string;
  issuedAt: string;
  expirationTime: string;
};

export const SIGN_IN_STATEMENT = 'Sign in to Sealed. This does not send a transaction or cost anything.';

export function createSignInMessage(fields: SignInFields): string {
  return [
    `${fields.domain} wants you to sign in with your Solana account:`,
    fields.address,
    '',
    fields.statement,
    '',
    `URI: ${fields.uri}`,
    'Version: 1',
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    `Expiration Time: ${fields.expirationTime}`,
  ].join('\n');
}

export function parseSignInMessage(text: string): SignInFields | null {
  const lines = text.split('\n');
  const header = /^(.+) wants you to sign in with your Solana account:$/.exec(lines[0] ?? '');
  const field = (name: string) => {
    const line = lines.find(l => l.startsWith(`${name}: `));
    return line?.slice(name.length + 2);
  };
  const fields = {
    domain: header?.[1],
    address: lines[1],
    statement: lines[3],
    uri: field('URI'),
    chainId: field('Chain ID'),
    nonce: field('Nonce'),
    issuedAt: field('Issued At'),
    expirationTime: field('Expiration Time'),
  };
  if (Object.values(fields).some(value => !value)) return null;
  const parsed = fields as SignInFields;
  // Reject anything that doesn't round-trip exactly, so no extra lines can be smuggled in.
  return createSignInMessage(parsed) === text ? parsed : null;
}

/** The message a company admin signs to approve a payroll run. */
export function payrollApprovalMessage(input: {
  company: string;
  runId: string;
  payments: number;
  total: string;
  symbol: string;
}): string {
  return [
    'Approve Sealed payroll run',
    `Company: ${input.company}`,
    `Run: ${input.runId}`,
    `Payments: ${input.payments}`,
    `Total: ${input.total} ${input.symbol}`,
  ].join('\n');
}
