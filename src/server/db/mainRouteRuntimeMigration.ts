import type Database from 'better-sqlite3';
import { createHash, randomUUID } from 'node:crypto';
import { compileRouteGraphSource } from '../../shared/routeGraph.js';
import { stableRoutingIdentityJson } from '../../shared/routingIdentity.js';
import { buildRouteRuntimeStorageArtifact } from '../services/routeRuntimeArtifactService.js';
import { migratePreviousRouteBackupToCurrentRuntime } from '../services/backupImportMigration.js';
import { materializeCompiledRouterPlan } from '../../shared/compiledRuntime.js';

function hasTable(sqlite: Database.Database, table: string): boolean {
  return !!sqlite.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
  ).get(table);
}

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  return hasTable(sqlite, table)
    && (sqlite.prepare(`PRAGMA table_info(\`${table}\`)`).all() as Array<{ name: string }>)
      .some((row) => row.name === column);
}

function readRows(sqlite: Database.Database, table: string): Array<Record<string, unknown>> {
  return hasTable(sqlite, table)
    ? sqlite.prepare(`SELECT * FROM \`${table}\``).all() as Array<Record<string, unknown>>
    : [];
}

function publishedMainAccountRows(sqlite: Database.Database): Array<Record<string, unknown>> {
  return readRows(sqlite, 'accounts').map((row) => ({ ...row, siteId: row.site_id }));
}

function publishedMainTokenRows(sqlite: Database.Database): Array<Record<string, unknown>> {
  return readRows(sqlite, 'account_tokens').map((row) => ({ ...row, accountId: row.account_id }));
}

function sha256(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

function positiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function migrateLegacyChannelReferences(
  sqlite: Database.Database,
  targets: Array<{
    id: number;
    accountId: number | null;
    tokenId: number | null;
    oauthRouteUnitId: number | null;
    upstreamModelName: string;
  }>,
  artifact: ReturnType<typeof buildRouteRuntimeStorageArtifact>,
): void {
  const routesById = new Map(readRows(sqlite, 'token_routes').map((row) => [
    positiveInteger(row.id),
    text(row.model_pattern) || text(row.display_name),
  ]));
  const targetByIdentity = new Map(targets.map((target) => [
    `${target.accountId}|${target.tokenId}|${target.oauthRouteUnitId}|${target.upstreamModelName}`,
    target.id,
  ]));
  const targetIdByChannelId = new Map<number, number>();
  for (const channel of readRows(sqlite, 'route_channels')) {
    const channelId = positiveInteger(channel.id);
    const accountId = positiveInteger(channel.account_id);
    if (!channelId || !accountId) continue;
    const tokenId = positiveInteger(channel.token_id);
    const oauthRouteUnitId = positiveInteger(channel.oauth_route_unit_id);
    const sourceModel = text(channel.source_model)
      || routesById.get(positiveInteger(channel.route_id))
      || '';
    const targetId = targetByIdentity.get(`${accountId}|${tokenId}|${oauthRouteUnitId}|${sourceModel}`);
    if (targetId) targetIdByChannelId.set(channelId, targetId);
  }
  const updateTargetReference = (table: string, targetColumn: string) => {
    if (!hasColumn(sqlite, table, 'channel_id') || !hasColumn(sqlite, table, targetColumn)) return;
    const update = sqlite.prepare(`UPDATE \`${table}\` SET \`${targetColumn}\` = ? WHERE channel_id = ?`);
    for (const [channelId, targetId] of targetIdByChannelId) update.run(targetId, channelId);
  };
  updateTargetReference('proxy_logs', 'execution_target_id');
  updateTargetReference('proxy_video_tasks', 'execution_target_id');

  if (!hasColumn(sqlite, 'proxy_debug_traces', 'selected_channel_id')) return;
  const attemptsByTargetId = new Map<number, Array<{ attemptId: string; endpointId: string; entrypointId: string; publicModelName: string }>>();
  const bundle = artifact.compiledRouterBundle;
  if (!bundle) return;
  for (const plan of bundle?.plans || []) {
    const materialized = materializeCompiledRouterPlan(bundle, plan);
    for (const alternative of materialized.executionAlternatives || []) {
      const targetId = positiveInteger(alternative.executionAttempt?.transportBinding?.executionTargetId);
      const attemptId = text(alternative.executionAttempt?.executionAttemptId);
      const endpointId = text(alternative.endpoint?.endpointId);
      const entrypointId = text(materialized.entryNodeId);
      if (targetId && attemptId && endpointId && entrypointId) {
        const attempts = attemptsByTargetId.get(targetId) || [];
        attempts.push({ attemptId, endpointId, entrypointId, publicModelName: text(materialized.publicModelName) });
        attemptsByTargetId.set(targetId, attempts);
      }
    }
  }
  const traces = sqlite.prepare('SELECT id, sticky_hit_channel_id, selected_channel_id, selected_route_id FROM proxy_debug_traces').all() as Array<Record<string, unknown>>;
  const updateTrace = sqlite.prepare(`
    UPDATE proxy_debug_traces
    SET sticky_hit_execution_attempt_id = ?, selected_execution_attempt_id = ?,
        route_entrypoint_id = ?, runtime_endpoint_id = ?
    WHERE id = ?
  `);
  for (const trace of traces) {
    const selected = targetIdByChannelId.get(positiveInteger(trace.selected_channel_id) || 0);
    const sticky = targetIdByChannelId.get(positiveInteger(trace.sticky_hit_channel_id) || 0);
    const legacyRouteModel = routesById.get(positiveInteger(trace.selected_route_id));
    const attemptFor = (targetId: number | undefined) => (targetId ? attemptsByTargetId.get(targetId)?.find(
      (attempt) => attempt.publicModelName === legacyRouteModel,
    ) || attemptsByTargetId.get(targetId)?.[0] : undefined);
    const selectedAttempt = attemptFor(selected);
    const stickyAttempt = attemptFor(sticky);
    if (!selectedAttempt && !stickyAttempt) continue;
    updateTrace.run(
      stickyAttempt?.attemptId || null,
      selectedAttempt?.attemptId || null,
      selectedAttempt?.entrypointId || null,
      selectedAttempt?.endpointId || null,
      trace.id,
    );
  }
}

/**
 * Performs the one supported storage conversion: the published main router
 * tables become the native runtime's execution targets and active Source Graph.
 */
export function migratePublishedMainRouteRuntime(sqlite: Database.Database): boolean {
  if (!hasTable(sqlite, 'token_routes')) return false;
  const activeGraph = sqlite.prepare('SELECT 1 FROM route_graph_versions LIMIT 1').get();
  if (activeGraph) return false;

  const migrated = migratePreviousRouteBackupToCurrentRuntime({
    sites: readRows(sqlite, 'sites'),
    accounts: publishedMainAccountRows(sqlite),
    accountTokens: publishedMainTokenRows(sqlite),
    runtimeExecutionTargets: [],
    runtimeExecutionTargetState: [],
  } as never, {
    token_routes: readRows(sqlite, 'token_routes'),
    route_channels: readRows(sqlite, 'route_channels'),
    route_group_sources: readRows(sqlite, 'route_group_sources'),
  });
  if (!migrated.graphSource) return false;

  const compiled = compileRouteGraphSource(migrated.graphSource, { compactRuntimeBundle: true });
  if (!compiled.ok) {
    throw new Error(`Cannot migrate published route data: ${compiled.diagnostics.map((item) => item.message).join('; ')}`);
  }
  const artifact = buildRouteRuntimeStorageArtifact(compiled.compiled);
  const sourceGraphJson = JSON.stringify(compiled.source);
  const sourceGraphHash = sha256(stableRoutingIdentityJson(compiled.source));
  const now = new Date().toISOString();
  const artifactId = randomUUID();

  sqlite.transaction(() => {
    const insertTarget = sqlite.prepare(`
      INSERT INTO runtime_execution_targets (
        id, source_ref, execution_key, site_id, account_id, token_id,
        oauth_route_unit_id, credential_binding_id, endpoint_profile_id,
        upstream_model_name, normalized_model_name, enabled, discovered,
        source, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const target of migrated.section.runtimeExecutionTargets || []) {
      insertTarget.run(
        target.id, target.sourceRef, target.executionKey, target.siteId, target.accountId,
        target.tokenId, target.oauthRouteUnitId, target.credentialBindingId,
        target.endpointProfileId, target.upstreamModelName, target.normalizedModelName,
        target.enabled ? 1 : 0, target.discovered ? 1 : 0, target.source,
        target.metadataJson, target.createdAt, target.updatedAt,
      );
    }
    const insertState = sqlite.prepare(`
      INSERT INTO runtime_execution_target_state (
        id, execution_target_id, success_count, fail_count, total_latency_ms,
        latency_sample_count, last_used_at, last_selected_at, last_fail_at,
        consecutive_fail_count, cooldown_level, cooldown_until, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    for (const state of migrated.section.runtimeExecutionTargetState || []) {
      insertState.run(
        state.id, state.executionTargetId, state.successCount, state.failCount,
        state.totalLatencyMs, state.latencySampleCount, state.lastUsedAt,
        state.lastSelectedAt, state.lastFailAt, state.consecutiveFailCount,
        state.cooldownLevel, state.cooldownUntil, state.updatedAt,
      );
    }
    migrateLegacyChannelReferences(sqlite, migrated.section.runtimeExecutionTargets || [], artifact);
    const version = sqlite.prepare(`
      INSERT INTO route_graph_versions (version, source_graph_json, status, created_by, created_at, activated_at)
      VALUES (1, ?, 'active', 'main-migration', ?, ?)
    `).run(sourceGraphJson, now, now);
    const versionId = Number(version.lastInsertRowid);
    sqlite.prepare(`
      INSERT INTO compiled_runtime_artifacts (id, artifact_json, bundle_hash, source_graph_version_id, source_graph_hash, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(artifactId, JSON.stringify(artifact), artifact.compiledRouterBundle?.hash || artifact.hash, versionId, sourceGraphHash, now);
    sqlite.prepare('INSERT INTO route_graph_active_version (id, version_id, updated_at) VALUES (1, ?, ?)').run(versionId, now);
    sqlite.prepare('INSERT INTO compiled_runtime_active_artifact (id, artifact_id, updated_at) VALUES (1, ?, ?)').run(artifactId, now);
  })();
  return true;
}
