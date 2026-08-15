import { beforeEach, describe, expect, it, vi } from 'vitest';

const { updateSetMock, invalidateMock, invalidateAccountsSnapshotMock } = vi.hoisted(() => ({
  updateSetMock: vi.fn(),
  invalidateMock: vi.fn(),
  invalidateAccountsSnapshotMock: vi.fn(),
}));

vi.mock('../db/index.js', () => ({
  db: {
    update: () => ({
      set: (values: Record<string, unknown>) => {
        updateSetMock(values);
        return { where: () => ({ run: async () => undefined }) };
      },
    }),
  },
  schema: { accounts: { id: 'id' } },
}));

vi.mock('./routeGraphService.js', () => ({
  invalidateRouteGraphReadCaches: (...args: unknown[]) => invalidateMock(...args),
}));

vi.mock('./accountsOverviewService.js', () => ({
  invalidateAccountsSnapshot: (...args: unknown[]) => invalidateAccountsSnapshotMock(...args),
}));

describe('accountRuntimeIdentityMutationService', () => {
  beforeEach(() => {
    updateSetMock.mockReset();
    invalidateMock.mockReset();
    invalidateAccountsSnapshotMock.mockReset();
    invalidateAccountsSnapshotMock.mockResolvedValue(undefined);
  });

  it('invalidates the dispatch identity cache after persisting credential state', async () => {
    const { updateAccountRuntimeIdentity } = await import('./accountRuntimeIdentityMutationService.js');

    await updateAccountRuntimeIdentity(42, { credential: 'rotated-credential', status: 'active' });

    expect(updateSetMock).toHaveBeenCalledWith(expect.objectContaining({
      credential: 'rotated-credential',
      status: 'active',
      updatedAt: expect.any(String),
    }));
    expect(invalidateMock).toHaveBeenCalledWith('account-mutated');
    expect(invalidateAccountsSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it('invalidates account picker snapshots for committed catalog changes', async () => {
    const { recordAccountsCatalogMutation } = await import('./accountRuntimeIdentityMutationService.js');

    await recordAccountsCatalogMutation();

    expect(invalidateMock).not.toHaveBeenCalled();
    expect(invalidateAccountsSnapshotMock).toHaveBeenCalledTimes(1);
  });

});
