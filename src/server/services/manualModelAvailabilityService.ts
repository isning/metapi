import { and, eq } from 'drizzle-orm';
import { db, runtimeDbDialect, schema } from '../db/index.js';
import { isApiKeyAccount } from './accountExtraConfig.js';
import { getPreferredAccountToken } from './accountTokenService.js';

type AccountRow = typeof schema.accounts.$inferSelect;

async function upsertAccountModel(
  tx: any,
  accountId: number,
  modelName: string,
  checkedAt: string,
) {
  const values = {
    accountId,
    modelName,
    available: true,
    isManual: true,
    latencyMs: null,
    checkedAt,
  };
  if (runtimeDbDialect === 'mysql') {
    const existing = await tx.select().from(schema.modelAvailability)
      .where(and(
        eq(schema.modelAvailability.accountId, accountId),
        eq(schema.modelAvailability.modelName, modelName),
      )).get();
    if (existing) {
      await tx.update(schema.modelAvailability).set(values)
        .where(eq(schema.modelAvailability.id, existing.id)).run();
      return;
    }
    await tx.insert(schema.modelAvailability).values(values).run();
    return;
  }
  await tx.insert(schema.modelAvailability).values(values).onConflictDoUpdate({
    target: [schema.modelAvailability.accountId, schema.modelAvailability.modelName],
    set: { available: true, isManual: true, latencyMs: null, checkedAt },
  }).run();
}

async function upsertTokenModel(
  tx: any,
  tokenId: number,
  modelName: string,
  checkedAt: string,
) {
  const values = {
    tokenId,
    modelName,
    available: true,
    isManual: true,
    latencyMs: null,
    checkedAt,
  };
  if (runtimeDbDialect === 'mysql') {
    const existing = await tx.select().from(schema.tokenModelAvailability)
      .where(and(
        eq(schema.tokenModelAvailability.tokenId, tokenId),
        eq(schema.tokenModelAvailability.modelName, modelName),
      )).get();
    if (existing) {
      await tx.update(schema.tokenModelAvailability).set(values)
        .where(eq(schema.tokenModelAvailability.id, existing.id)).run();
      return;
    }
    await tx.insert(schema.tokenModelAvailability).values(values).run();
    return;
  }
  await tx.insert(schema.tokenModelAvailability).values(values).onConflictDoUpdate({
    target: [schema.tokenModelAvailability.tokenId, schema.tokenModelAvailability.modelName],
    set: { available: true, isManual: true, latencyMs: null, checkedAt },
  }).run();
}

export async function saveManualModelsForAccount(
  account: AccountRow,
  modelNames: string[],
): Promise<{ target: 'account' | 'token'; tokenId: number | null }> {
  const checkedAt = new Date().toISOString();
  const token = isApiKeyAccount(account)
    ? await getPreferredAccountToken(account.id)
    : null;
  if (isApiKeyAccount(account) && !token) {
    throw new Error('API Key 账号缺少可用的默认模型 Key');
  }

  await db.transaction(async (tx) => {
    for (const modelName of modelNames) {
      if (token) {
        await upsertTokenModel(tx, token.id, modelName, checkedAt);
      } else {
        await upsertAccountModel(tx, account.id, modelName, checkedAt);
      }
    }
  });
  return token
    ? { target: 'token', tokenId: token.id }
    : { target: 'account', tokenId: null };
}
