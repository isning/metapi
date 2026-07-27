import { describe, expect, it } from "vitest";
import {
  compileRouteGraphSource,
  normalizeRouteGraphNode,
} from "../../shared/routeGraph.js";
import { createRouteGroupFacadeMacro } from "./routeGroupGraphFacadeService.js";

describe("routeGroupGraphFacadeService", () => {
  it("keeps Route Group stage/member state inside a Graph macro and compiles without side-table edges", () => {
    const endpoint = normalizeRouteGraphNode({
      id: "route-endpoint:managed:target-7",
      type: "route_endpoint",
      routeEndpointId: "route-endpoint:managed:target-7",
      name: "deepseek-v4-flash",
      enabled: true,
      ownership: "derived",
      endpointKind: "supply",
      exposure: "none",
      resolutionStatus: "resolved",
      ownerKind: "macro",
      sourceKind: "upstream_model",
      backend: { kind: "supply" },
      metadata: { upstreamModel: "deepseek-v4-flash" },
      config: {
        targets: [
          {
            targetId: "route-endpoint:managed:target-7",
            model: "deepseek-v4-flash",
            transportBinding: { kind: "execution_target", executionTargetId: 7 },
          },
        ],
      },
    });

    const result = createRouteGroupFacadeMacro(
      { nodes: [endpoint], edges: [], macros: [] },
      {
        kind: "manual",
        modelName: "deepseek-v4-flash-rerouted",
        stages: [
          {
            id: "fallback-stage:managed:primary",
            metadata: { generationRole: "generated_primary" },
            members: [
              {
                kind: "endpoint",
                endpointId: endpoint.routeEndpointId,
                memberId: "dispatcher-member:managed:primary-target-7",
                weight: 10,
              },
            ],
          },
        ],
      },
    );

    expect(result.source.edges).toEqual([]);
    expect(result.macro.config.groups[0]).toMatchObject({
      id: "fallback-stage:managed:primary",
      metadata: { generationRole: "generated_primary" },
      members: [
        {
          memberId: "dispatcher-member:managed:primary-target-7",
          endpointId: endpoint.routeEndpointId,
          weight: 10,
        },
      ],
    });

    const compiled = compileRouteGraphSource(result.source);
    expect(compiled.ok).toBe(true);
    expect(
      compiled.compiled.compiledRouterBundle?.matcher.exact[
        "deepseek-v4-flash-rerouted"
      ],
    ).toBeDefined();
  });

  it("compiles a model-pattern Route Group source into matching endpoint candidates", () => {
    const endpoints = ["deepseek-v4-flash", "qwen-max"].map((model, index) =>
      normalizeRouteGraphNode({
        id: `route-endpoint:managed:pattern-${index}`,
        type: "route_endpoint",
        routeEndpointId: `route-endpoint:managed:pattern-${index}`,
        name: model,
        enabled: true,
        ownership: "derived",
        endpointKind: "supply",
        exposure: "none",
        resolutionStatus: "resolved",
        ownerKind: "macro",
        sourceKind: "upstream_model",
        metadata: { upstreamModel: model },
        config: {
          targets: [{
            targetId: `target-${index}`,
            model,
            transportBinding: { kind: "execution_target", executionTargetId: index + 1 },
          }],
        },
      }),
    );
    const result = createRouteGroupFacadeMacro(
      { nodes: endpoints, edges: [], macros: [] },
      {
        kind: "manual",
        modelName: "deepseek-rerouted",
        candidateSource: { kind: "model_pattern", pattern: "re:^deepseek-v4" },
        stages: [
          {
            id: "fallback-stage:managed:pattern",
            acceptUnassigned: true,
          },
        ],
      },
    );

    expect(result.macro.config.candidateSource).toEqual({
      kind: "model_pattern",
      pattern: "re:^deepseek-v4",
    });
    expect(result.macro.config.groups[0]).toMatchObject({
      acceptUnassigned: true,
      input: { kind: "synthetic", statusCode: 503 },
    });
    const compiled = compileRouteGraphSource(result.source);
    expect(compiled.ok).toBe(true);
    const serialized = JSON.stringify(compiled.compiled);
    expect(serialized).toContain("deepseek-v4-flash");
    expect(serialized).not.toContain("qwen-max");
  });
});
