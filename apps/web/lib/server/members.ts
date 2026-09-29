import 'server-only';

import { randomBytes } from 'node:crypto';

import { isAddress } from '@solana/kit';

import { parseAmount } from '@sealed/core';

import { badRequest } from './http';
import { Member, type CompanyDoc } from './models';
import { encryptAmount } from './secrets';

export type MemberInput = { name?: string; salary?: string; wallet?: string; email?: string };

/**
 * Validates new team members (one, or a whole import) and returns the documents to insert.
 * Nothing is added unless every entry is valid: the error lists each problem, by `labels[i]`.
 */
export async function prepareMembers(company: CompanyDoc, inputs: MemberInput[], labels?: string[]) {
  const errors: string[] = [];
  const wallets = new Set<string>();
  const prepared = inputs.map((input, index) => {
    const problem = (message: string) => errors.push(labels ? `${labels[index]}: ${message}` : message);
    const name = input.name?.trim() ?? '';
    if (name.length < 1 || name.length > 80) problem('Name must be 1 to 80 characters.');
    let salary = 0n;
    try {
      salary = parseAmount(input.salary ?? '', company.decimals);
    } catch (error) {
      problem((error as Error).message);
    }
    const wallet = input.wallet?.trim() || undefined;
    if (wallet) {
      if (!isAddress(wallet)) problem('That is not a Solana address.');
      else if (wallets.has(wallet)) problem('That wallet appears twice.');
      wallets.add(wallet);
    }
    return {
      companyId: company._id,
      name,
      email: input.email?.trim() || undefined,
      wallet,
      salaryEnc: encryptAmount(salary),
      inviteToken: randomBytes(18).toString('base64url'),
    };
  });

  const taken = await Member.find({ companyId: company._id, wallet: { $in: [...wallets] } }, { wallet: 1 });
  for (const { wallet } of taken) {
    const index = prepared.findIndex(member => member.wallet === wallet);
    errors.push(`${labels ? `${labels[index]}: ` : ''}Someone on the team already uses that wallet.`);
  }
  if (errors.length > 0) {
    const shown = errors.slice(0, 5).join(' ');
    throw badRequest(errors.length > 5 ? `${shown} (and ${errors.length - 5} more)` : shown);
  }
  return prepared;
}
