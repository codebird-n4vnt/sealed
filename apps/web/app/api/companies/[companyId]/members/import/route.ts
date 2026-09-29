import { loadCompanyAsAdmin } from '@/lib/server/access';
import { assertEditable } from '@/lib/server/demo';
import { badRequest, json, readJson, route } from '@/lib/server/http';
import { prepareMembers, type MemberInput } from '@/lib/server/members';
import { Member } from '@/lib/server/models';
import { requireWallet } from '@/lib/server/session';
import { MAX_IMPORT_ROWS } from '@/lib/team-csv';

/** Adds many team members at once (a CSV import). All or nothing: any invalid row adds no one. */
export const POST = route<{ companyId: string }>(async (request, { params }) => {
  const wallet = await requireWallet();
  const company = await loadCompanyAsAdmin((await params).companyId, wallet);
  assertEditable(company);
  const { rows } = await readJson<{ rows?: Array<MemberInput & { line?: number }> }>(request);
  if (!Array.isArray(rows) || rows.length === 0) throw badRequest('No one to add.');
  if (rows.length > MAX_IMPORT_ROWS) throw badRequest(`At most ${MAX_IMPORT_ROWS} people per import.`);

  const prepared = await prepareMembers(company, rows, rows.map((row, index) => `Line ${row.line ?? index + 2}`));
  await Member.insertMany(prepared);
  return json({ added: prepared.length }, { status: 201 });
});
