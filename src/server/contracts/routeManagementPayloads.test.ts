import { describe, expect, it } from 'vitest';
import {
  parseRouteGraphAuthoringPayload,
  parseRouteGraphWorkspaceOperationsPayload,
  parseRouteGraphWorkspaceNodeCreatePayload,
  parseRouteGroupCandidateBatchCreatePayload,
  parseRouteGroupCandidateCreatePayload,
  parseRouteGroupCandidateUpdatePayload,
  parseRouteRebuildPayload,
} from './routeManagementPayloads.js';

describe('route management payloads', () => {
  it('parses candidate creation, batch and update commands without token-route fields', () => {
    expect(parseRouteGroupCandidateCreatePayload({
      sourceRef: '67d54dd0-45c8-4d98-b7b9-7ac550192ec7',
      stageId: 'fallback-stage:managed:test-a',
      weight: 7,
    })).toMatchObject({ success: true });
    expect(parseRouteGroupCandidateBatchCreatePayload({
      sourceRefs: ['67d54dd0-45c8-4d98-b7b9-7ac550192ec7'],
      stageId: 'fallback-stage:managed:test-a',
    })).toMatchObject({ success: true });
    expect(parseRouteGroupCandidateUpdatePayload({
      stageId: 'fallback-stage:managed:test-b',
      enabled: false,
    })).toMatchObject({ success: true });
  });

  it('rejects unknown candidate fields and malformed candidate input', () => {
    expect(parseRouteGroupCandidateCreatePayload({
      sourceRef: '67d54dd0-45c8-4d98-b7b9-7ac550192ec7',
      bucketId: 9,
    })).toEqual({
      success: false,
      error: 'Invalid route management payload.',
    });
    expect(parseRouteGroupCandidateBatchCreatePayload({ sourceRefs: ['not-a-reference'] })).toEqual({
      success: false,
      error: 'Invalid sourceRefs. Expected opaque source reference array.',
    });
    expect(parseRouteGroupCandidateUpdatePayload({ enabled: true, misspelledWeight: 2 })).toMatchObject({ success: false });
  });

  it('parses Graph authoring commands with explicit element references', () => {
    expect(parseRouteGraphAuthoringPayload({
      nodes: [{ localRef: 'entry-a', type: 'entry', enabled: true }],
      edges: [],
    })).toMatchObject({ success: true });
    expect(parseRouteGraphAuthoringPayload({
      nodes: [{ localRef: 'entry-a', type: 'entry', enabled: true }],
      edges: [{
        localRef: 'entry-to-existing',
        source: { kind: 'node', localRef: 'entry-a' },
        sourcePortId: 'out',
        target: { kind: 'node', id: 'manual:node:existing' },
        targetPortId: 'in',
        kind: 'request_flow',
        ownership: 'manual',
      }],
    })).toMatchObject({ success: true });
    expect(parseRouteGraphAuthoringPayload({
      nodes: [{ id: 'manual:node:existing', localRef: 'bad', type: 'entry' }],
      edges: [],
    })).toMatchObject({ success: false });
    expect(parseRouteGraphAuthoringPayload({
      nodes: [{ type: 'entry' }],
      edges: [],
    })).toMatchObject({ success: false });
    expect(parseRouteGraphAuthoringPayload({
      nodes: [{ localRef: 'entry-a', type: 'entry' }],
      edges: [{
        source: { kind: 'node', localRef: 'entry-a' },
        sourcePortId: 'out',
        target: { kind: 'node', localRef: 'entry-a' },
        targetPortId: 'in',
        kind: 'request_flow',
        ownership: 'manual',
      }],
    })).toMatchObject({ success: false });
    expect(parseRouteGraphWorkspaceOperationsPayload({
      revision: 'draft:1:1:1',
      operations: [{
        kind: 'upsert_node',
        node: { id: 'node-a', type: 'filter', enabled: true, ownership: 'manual' },
      }],
    })).toMatchObject({ success: true });
    expect(parseRouteRebuildPayload({ refreshModels: true, wait: false })).toMatchObject({ success: true });
    expect(parseRouteGraphWorkspaceNodeCreatePayload({
      revision: 'draft:1:1:1',
      node: {
        type: 'route_endpoint', enabled: true, ownership: 'manual', routeEndpointId: 'client-authored',
        endpointKind: 'supply', exposure: 'none', resolutionStatus: 'resolved', ownerKind: 'manual',
        sourceKind: 'inline', backend: { kind: 'supply' },
      },
    })).toMatchObject({ success: false });
    expect(parseRouteGraphWorkspaceOperationsPayload({
      revision: 'draft:1:1:1',
      operations: [{ kind: 'upsert_node', node: { id: 'node-a', type: 'filter', enabled: true, ownership: 'manual', typo: true } }],
    })).toMatchObject({ success: false });
  });

  it('requires an explicit manual-edge policy for authored ports', () => {
    const validPort = {
      id: 'request.custom.in',
      label: 'Custom input',
      direction: 'input',
      kind: 'request',
      manualEdgePolicy: 'allow',
    };
    expect(parseRouteGraphWorkspaceOperationsPayload({
      revision: 'draft:1:1:1',
      operations: [{
        kind: 'upsert_node',
        node: {
          id: 'node-a', type: 'filter', enabled: true, ownership: 'manual',
          dynamicPorts: [validPort],
        },
      }],
    })).toMatchObject({ success: true });
    expect(parseRouteGraphWorkspaceOperationsPayload({
      revision: 'draft:1:1:1',
      operations: [{
        kind: 'upsert_node',
        node: {
          id: 'node-a', type: 'filter', enabled: true, ownership: 'manual',
          dynamicPorts: [{ ...validPort, manualEdgePolicy: undefined }],
        },
      }],
    })).toMatchObject({ success: false });
    expect(parseRouteGraphWorkspaceOperationsPayload({
      revision: 'draft:1:1:1',
      operations: [{
        kind: 'upsert_macro',
        macro: {
          id: 'macro-a', kind: 'candidate_selector', enabled: true, ownership: 'manual',
          config: {
            surface: { entry: { kind: 'none' }, output: 'route', ports: [{ ...validPort, editable: false }] },
            policy: { kind: 'inherit_default' },
            groups: [],
          },
        },
      }],
    })).toMatchObject({ success: false });
  });
});
