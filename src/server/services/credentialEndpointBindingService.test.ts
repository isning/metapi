import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  bootIsolatedRuntimeDb,
  type IsolatedRuntimeDbHandle,
} from '../../testing/dbHarness.js';
import { buildApiAttemptPlan, endpointCandidatesFromApiAttemptPlan } from '../proxy-core/apiVariants.js';

type DbModule = typeof import('../db/index.js');
type ServiceModule = typeof import('./credentialEndpointBindingService.js');

describe('credentialEndpointBindingService', () => {
  let runtimeDb: IsolatedRuntimeDbHandle;
  let db: DbModule['db'];
  let schema: DbModule['schema'];
  let service: ServiceModule;

  beforeAll(async () => {
    runtimeDb = await bootIsolatedRuntimeDb('metapi-credential-endpoint-binding-');
    db = runtimeDb.dbModule.db;
    schema = runtimeDb.dbModule.schema;
    service = await import('./credentialEndpointBindingService.js');
  });

  beforeEach(async () => {
    await db.delete(schema.credentialEndpointBindings).run();
    await db.delete(schema.apiEndpointProfiles).run();
    await db.delete(schema.accountTokens).run();
    await db.delete(schema.accounts).run();
    await db.delete(schema.sites).run();
  });

  afterAll(async () => {
    await runtimeDb.cleanup();
  });

  async function createCredentialFixture() {
    const site = await db.insert(schema.sites).values({
      name: 'Endpoint Matrix',
      url: 'https://endpoint-matrix.example.com',
      platform: 'openai',
    }).returning().get();
    const account = await db.insert(schema.accounts).values({
      siteId: site.id,
      username: 'primary',
      accessToken: 'access-token',
      apiToken: 'sk-account',
    }).returning().get();
    const token = await db.insert(schema.accountTokens).values({
      accountId: account.id,
      name: 'paid',
      token: 'sk-token',
      tokenGroup: 'paid',
    }).returning().get();
    return { site, account, token };
  }

  it('creates default endpoint profiles and matrix rows for account and token credentials', async () => {
    const { site, account, token } = await createCredentialFixture();

    const matrix = await service.listCredentialEndpointMatrix(site.id);

    expect(matrix.profiles.map((profile) => profile.apiType)).toEqual([
      'openai_chat_completions',
      'openai_responses',
      'anthropic_messages',
      'openai_embeddings',
      'openai_completions',
      'openai_images_generations',
      'openai_images_edits',
      'openai_videos_generations',
      'openai_videos',
    ]);
    expect(matrix.credentials.map((credential) => credential.credentialKey)).toEqual([
      `account:${account.id}`,
      `account-token:${token.id}`,
    ]);
    expect(matrix.credentials.every((credential) => (
      credential.bindings.length === matrix.profiles.length
      && credential.bindings.every((binding) => (
        binding.persisted === false
        && binding.enabled === true
        && binding.support === 'supported'
      ))
    ))).toBe(true);
  });

  it('persists key-scoped endpoint bindings and feeds the runtime api attempt planner', async () => {
    const { site, token } = await createCredentialFixture();
    const initial = await service.listCredentialEndpointMatrix(site.id);
    const chatProfile = initial.profiles.find((profile) => profile.apiType === 'openai_chat_completions');
    const responsesProfile = initial.profiles.find((profile) => profile.apiType === 'openai_responses');
    expect(chatProfile).toBeTruthy();
    expect(responsesProfile).toBeTruthy();

    await service.replaceCredentialEndpointBindings({
      siteId: site.id,
      credentialKey: `account-token:${token.id}`,
      bindings: [
        {
          apiEndpointProfileId: responsesProfile!.rowId,
          enabled: true,
          support: 'unsupported',
          priority: 0,
        },
        {
          apiEndpointProfileId: chatProfile!.rowId,
          enabled: true,
          support: 'supported',
          priority: 1,
        },
      ],
    });

    const config = await service.loadCredentialApiVariantConfig({
      siteId: site.id,
      accountId: token.accountId,
      tokenId: token.id,
    });
    expect(config?.credentialKey.credentialKey).toBe(`account-token:${token.id}`);

    const plan = buildApiAttemptPlan({
      siteId: site.id,
      credentialId: config?.credentialKey.credentialKey,
      endpointProfiles: config?.endpointProfiles,
      credentialEndpointBindings: config?.credentialEndpointBindings,
      endpointCandidates: ['responses', 'chat'],
    });

    expect(endpointCandidatesFromApiAttemptPlan(plan)).toEqual(['chat']);
    expect(plan.diagnostics.map((diagnostic) => diagnostic.code)).toContain('credential_endpoint_binding.not_plannable');
  });

  it('clears key-scoped endpoint bindings when reset to defaults', async () => {
    const { site, token } = await createCredentialFixture();
    const initial = await service.listCredentialEndpointMatrix(site.id);
    const responsesProfile = initial.profiles.find((profile) => profile.apiType === 'openai_responses');
    expect(responsesProfile).toBeTruthy();

    await service.replaceCredentialEndpointBindings({
      siteId: site.id,
      credentialKey: `account-token:${token.id}`,
      bindings: [{
        apiEndpointProfileId: responsesProfile!.rowId,
        enabled: false,
        support: 'supported',
        priority: 0,
      }],
    });
    await service.replaceCredentialEndpointBindings({
      siteId: site.id,
      credentialKey: `account-token:${token.id}`,
      bindings: [],
    });

    const matrix = await service.listCredentialEndpointMatrix(site.id);
    const credential = matrix.credentials.find((row) => row.credentialKey === `account-token:${token.id}`);
    expect(credential?.bindings.every((binding) => binding.persisted === false)).toBe(true);
    const config = await service.loadCredentialApiVariantConfig({
      siteId: site.id,
      accountId: token.accountId,
      tokenId: token.id,
    });
    expect(config).toBeNull();
  });
});
