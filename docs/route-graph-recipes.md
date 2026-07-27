# Route Graph Recipes

本页提供当前 graph-native source JSON 片段。示例省略无关的 `nodes[]`、`edges[]` 或 `macros[]` 外层结构。所有 policy 都使用 native dispatcher policy reference，所有主备关系都使用有序 fallback stages。

## 1. Public 模型直连 Supply

适合最小测试或只有一个上游 endpoint 的路径。

```json
{
  "nodes": [
    {
      "id": "entry:demo",
      "type": "entry",
      "enabled": true,
      "ownership": "manual",
      "match": {
        "kind": "model",
        "requestedModelPattern": "demo",
        "displayName": "demo"
      }
    },
    {
      "id": "route-endpoint:supply:demo",
      "type": "route_endpoint",
      "enabled": true,
      "ownership": "manual",
      "routeEndpointId": "route-endpoint:supply:demo",
      "endpointKind": "supply",
      "exposure": "none",
      "resolutionStatus": "resolved",
      "ownerKind": "manual",
      "sourceKind": "inline",
      "backend": { "kind": "supply" },
      "config": {
        "targets": [{ "targetId": "demo-target", "model": "gpt-4o", "weight": 10 }],
        "targetSelection": { "kind": "builtin", "builtin": "weighted" }
      }
    }
  ],
  "edges": [
    {
      "id": "edge:demo-entry-to-supply",
      "sourceNodeId": "entry:demo",
      "sourcePortId": "bidirect.out",
      "targetNodeId": "route-endpoint:supply:demo",
      "targetPortId": "bidirect.in",
      "kind": "bidirect_flow",
      "ownership": "manual"
    }
  ],
  "macros": []
}
```

## 2. 单个 Fallback Stage 内 70/30

同一个 stage 中的成员由该 stage 的 policy 选择。这里以权重 70/30 选择两个 endpoint。

```json
{
  "id": "macro:balanced-chat",
  "kind": "candidate_selector",
  "enabled": true,
  "ownership": "manual",
  "name": "balanced-chat",
  "config": {
    "surface": {
      "entry": {
        "kind": "external",
        "match": {
          "kind": "model",
          "requestedModelPattern": "balanced-chat",
          "displayName": "balanced-chat"
        }
      },
      "output": "route",
      "ports": [
        { "id": "bidirect.in", "label": "incoming flow", "direction": "input", "kind": "bidirect", "multiple": true, "manualEdgePolicy": "allow" },
        { "id": "candidates.in", "label": "candidate inputs", "direction": "input", "kind": "route", "multiple": true, "collection": { "type": "set", "min": 1 }, "manualEdgePolicy": "allow" },
        { "id": "route.out", "label": "candidate targets", "direction": "output", "kind": "route", "multiple": true, "collection": { "type": "set", "min": 1 }, "manualEdgePolicy": "allow" }
      ]
    },
    "policy": { "kind": "builtin", "builtin": "weighted" },
    "groups": [
      {
        "id": "primary",
        "label": "Primary",
        "enabled": true,
        "input": {
          "kind": "route_endpoints",
          "endpointIds": [
            "route-endpoint:supply:site-a-gpt-4o",
            "route-endpoint:supply:site-b-gpt-4o"
          ]
        },
        "members": [
          { "endpointId": "route-endpoint:supply:site-a-gpt-4o", "weight": 70 },
          { "endpointId": "route-endpoint:supply:site-b-gpt-4o", "weight": 30 }
        ]
      }
    ]
  }
}
```

## 3. 主备与 Synthetic Fallback

stage 的数组位置就是 fallback order。当前 stage 中没有 eligible execution alternative 后，才评估下一 stage。

```json
{
  "policy": { "kind": "builtin", "builtin": "weighted" },
  "groups": [
    {
      "id": "primary",
      "label": "Primary",
      "enabled": true,
      "input": {
        "kind": "route_endpoints",
        "endpointIds": ["route-endpoint:supply:primary-gpt-4o"]
      }
    },
    {
      "id": "backup",
      "label": "Backup",
      "enabled": true,
      "policy": { "kind": "builtin", "builtin": "stable_first" },
      "input": {
        "kind": "route_endpoints",
        "endpointIds": ["route-endpoint:supply:backup-gpt-4o"]
      }
    },
    {
      "id": "unavailable",
      "label": "Unavailable",
      "enabled": true,
      "input": {
        "kind": "synthetic",
        "statusCode": 503,
        "message": "No upstream endpoint is available."
      }
    }
  ]
}
```

不要用 numeric priority 表达主备。`priority`、`priority_order`、`routingStrategy` 和旧 `{ "strategy": ... }` policy 都会被拒绝。

## 4. 组合已有 Macro

一个 stage 可以通过 `graph_references` 引用另一个 macro。该形态不区分自动或
手动管理来源，且不会创建已废弃的 route product endpoint。

```json
{
  "id": "macro:premium-claude",
  "kind": "candidate_selector",
  "enabled": true,
  "ownership": "manual",
  "name": "premium-claude",
  "config": {
    "surface": {
      "entry": {
        "kind": "external",
        "match": {
          "kind": "model",
          "requestedModelPattern": "premium-claude",
          "displayName": "premium-claude"
        }
      },
      "output": "route",
      "ports": [
        { "id": "bidirect.in", "label": "incoming flow", "direction": "input", "kind": "bidirect", "multiple": true, "manualEdgePolicy": "allow" },
        { "id": "candidates.in", "label": "candidate inputs", "direction": "input", "kind": "route", "multiple": true, "collection": { "type": "set", "min": 1 }, "manualEdgePolicy": "allow" },
        { "id": "route.out", "label": "candidate targets", "direction": "output", "kind": "route", "multiple": true, "collection": { "type": "set", "min": 1 }, "manualEdgePolicy": "allow" }
      ]
    },
    "policy": { "kind": "registry", "policyId": "platform-default" },
    "groups": [
      {
        "id": "products",
        "label": "Products",
        "enabled": true,
        "input": {
          "kind": "graph_references",
          "endpointIds": [],
          "macroIds": ["macro:claude-sonnet", "macro:claude-opus"]
        },
        "members": [
          { "macroId": "macro:claude-sonnet", "weight": 8 },
          { "macroId": "macro:claude-opus", "weight": 2 }
        ]
      }
    ]
  }
}
```

## 5. 请求改写和 Payload 默认值

在 macro 或 filter node 中添加 filter operations：

```json
{
  "filters": {
    "operations": [
      {
        "type": "rewrite_model",
        "source": "current_model",
        "operation": "strip_suffix",
        "suffix": "-max"
      },
      {
        "type": "set_payload",
        "path": "reasoning_effort",
        "value": "high",
        "mode": "default"
      },
      {
        "type": "set_endpoint_preference",
        "endpoint": "responses"
      }
    ]
  }
}
```

`default` 保留调用方已提供的值；`override` 强制替换它。

## 6. Inline Endpoint

适合临时手写图。长期上游端点应由管理层创建并从 endpoint catalog 引用。

```json
{
  "id": "inline-site-a",
  "label": "Inline Site A",
  "enabled": true,
  "input": {
    "kind": "inline_endpoints",
    "endpoints": [
      {
        "targetId": "inline-site-a-gpt-4o",
        "model": "gpt-4o",
        "weight": 10,
        "metadata": {
          "provider": "openai",
          "siteName": "site-a"
        }
      }
    ]
  }
}
```

## 7. Synthetic Response

作为 stage：

```json
{
  "id": "unavailable",
  "label": "Unavailable",
  "enabled": true,
  "input": {
    "kind": "synthetic",
    "statusCode": 503,
    "message": "No route is available."
  }
}
```

作为独立节点：

```json
{
  "id": "synthetic:no-route",
  "type": "synthetic_endpoint",
  "enabled": true,
  "ownership": "manual",
  "statusCode": 503,
  "message": "No route is available."
}
```

## 8. 按 Runtime Signal 加权

成本、余额或使用量等动态输入应放在 dispatcher policy，而不是放入 stage 顺序。

```json
{
  "kind": "inline",
  "policy": {
    "id": "cost-balanced",
    "name": "Cost balanced",
    "kind": "cel",
    "selectionMode": "weighted",
    "contributionExpression": "max(0.0, 0.70 * runtime.routingSignals.normalizedCostScore + 0.30 * runtime.routingSignals.normalizedBalanceScore)"
  }
}
```

该 policy 的理论概率依赖 runtime signal，模型广场在没有对应请求或即时 runtime 数据时应标记为动态，而不是伪造固定比例。

## 9. 请求相关 Direct 选择

当选择取决于完整请求时，使用 `direct` policy。返回值是当前 eligible option 数组的 index。

```json
{
  "kind": "inline",
  "policy": {
    "id": "premium-region",
    "name": "Premium region",
    "kind": "cel",
    "selectionMode": "direct",
    "selectExpression": "request.payload.user_tier == \"premium\" ? 1 : 0"
  }
}
```

没有请求上下文时，这类 policy 不应显示固定选择概率。

## 10. 禁用或排除已物化候选

对已存在 endpoint 的局部控制通过 `candidateOverrides` 表达：

```json
{
  "candidateOverrides": {
    "byEndpointId": {
      "route-endpoint:supply:site-a-gpt-4o": { "enabled": false },
      "route-endpoint:supply:site-b-gpt-4o": { "excluded": true }
    }
  }
}
```

移动候选到另一个 fallback stage 应通过路由组的 stage API 或编辑器完成，而不是给 candidate 写 priority。
