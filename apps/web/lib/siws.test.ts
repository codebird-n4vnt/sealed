import { describe, expect, it } from 'vitest';

import { createSignInMessage, parseSignInMessage, payrollApprovalMessage, SIGN_IN_STATEMENT, type SignInFields } from './siws';

const fields: SignInFields = {
  domain: 'sealed.example',
  address: '3jR4qyRRyxjmNYQMp6Zb9nHghffPC6fneuJcueRAJ8Mi',
  statement: SIGN_IN_STATEMENT,
  uri: 'https://sealed.example',
  chainId: 'devnet',
  nonce: '9f2c4e1a7b3d5f60',
  issuedAt: '2026-09-27T10:00:00.000Z',
  expirationTime: '2026-09-27T10:10:00.000Z',
};

describe('sign-in messages', () => {
  it('round-trip', () => {
    expect(parseSignInMessage(createSignInMessage(fields))).toEqual(fields);
  });

  it('use the Sign-In With Solana layout wallets display', () => {
    const lines = createSignInMessage(fields).split('\n');
    expect(lines[0]).toBe('sealed.example wants you to sign in with your Solana account:');
    expect(lines[1]).toBe(fields.address);
    expect(lines).toContain('Nonce: 9f2c4e1a7b3d5f60');
  });

  it('reject extra lines smuggled into the message', () => {
    const message = createSignInMessage(fields) + '\nResources:\n- https://evil.example';
    expect(parseSignInMessage(message)).toBeNull();
  });

  it('reject a statement that hides another field', () => {
    const message = createSignInMessage({ ...fields, statement: `${SIGN_IN_STATEMENT}\nNonce: attacker` });
    expect(parseSignInMessage(message)).toBeNull();
  });

  it('reject a changed header or missing fields', () => {
    const message = createSignInMessage(fields);
    expect(parseSignInMessage(message.replace('wants you to sign in', 'asks you to sign'))).toBeNull();
    expect(parseSignInMessage(message.replace(/\nNonce: .*/, ''))).toBeNull();
    expect(parseSignInMessage('')).toBeNull();
  });
});

describe('payroll approval messages', () => {
  it('name the company, run, count and total', () => {
    const message = payrollApprovalMessage({ company: 'Acme DAO', runId: 'run-1', payments: 10, total: '50600', symbol: 'sUSD' });
    expect(message).toBe(
      ['Approve Sealed payroll run', 'Company: Acme DAO', 'Run: run-1', 'Payments: 10', 'Total: 50600 sUSD'].join('\n'),
    );
  });
});
