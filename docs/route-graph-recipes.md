# Route Graph Recipes

本页提供常见 Route Graph 配置片段。示例使用 `version: 1`。为便于复制，部分示例只展示 `nodes[]`、`edges[]` 或 `macros[]` 中的相关片段。

## 1. Public 模型直连 supply

适合最小测试。

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "entry:demo",
      "type": "entry",
      "enabled": true,
      "visibility": "public",
      "ownership": "manual",
      "match": {
        "kind": "model",
        "requestedModelPattern": "demo",
        "displayName": "demo"
      },
      "selectionStrategy": "weighted"
    },
    {
      "id": "route-endpoint:supply:demo",
      "type": "route_endpoint",
      "enabled": true,
      "visibility": "internal",
      "ownership": "manual",
      "routeEndpointId": "route-endpoint:supply:demo",
      "endpointKind": "supply",
      "exposure": "none",
      "resolutionStatus": "resolved",
      "ownerKind": "manual_route",
      "sourceKind": "inline",
      "backend": { "kind": "supply" },
      "config": {
        "targets": [
          { "targetId": "demo-target", "model": "gpt-4o", "weight": 10 }
        ],
        "targetSelection": { "strategy": "weighted" }
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
  "macros": [],
  "metadata": {}
}
```

## 2. 手动路由组 70/30

```json
{
  "id": "macro:manual:balanced-chat",
  "kind": "candidate_selector",
  "enabled": true,
  "visibility": "public",
  "ownership": "manual",
  "name": "balanced-chat",
  "config": {
    "surface": {
      "entry": {
        "kind": "external",
        "visibility": "public",
        "match": {
          "kind": "model",
          "requestedModelPattern": "balanced-chat",
          "displayName": "balanced-chat"
        }
      },
      "output": "route"
    },
    "policy": { "strategy": "weighted" },
    "groups": [
      {
        "id": "default",
        "label": "Default",
        "enabled": true,
        "priority": 0,
        "input": {
          "kind": "route_endpoints",
          "endpointIds": [
            "route-endpoint:supply:site-a:gpt-4o",
            "route-endpoint:supply:site-b:gpt-4o"
          ]
        },
        "defaults": { "enabled": true, "weight": 10, "priority": 0 }
      }
    ],
    "candidateOverrides": {
      "bySupplyEndpointId": {
        "route-endpoint:supply:site-a:gpt-4o": { "weight": 70 },
        "route-endpoint:supply:site-b:gpt-4o": { "weight": 30 }
      }
    }
  }
}
```

## 3. 主备切换

`priority_order` 会先选择最高优先级组。只有高优先级候选不可用时，才进入下一层。

```json
{
  "policy": { "strategy": "priority_order" },
  "groups": [
    {
      "id": "primary",
      "label": "Primary",
      "enabled": true,
      "priority": 100,
      "input": {
        "kind": "route_endpoints",
        "endpointIds": ["route-endpoint:supply:primary:gpt-4o"]
      },
      "defaults": { "weight": 10, "priority": 100 }
    },
    {
      "id": "backup",
      "label": "Backup",
      "enabled": true,
      "priority": 50,
      "input": {
        "kind": "route_endpoints",
        "endpointIds": ["route-endpoint:supply:backup:gpt-4o"]
      },
      "defaults": { "weight": 10, "priority": 50 }
    },
    {
      "id": "fallback",
      "label": "Capacity fallback",
      "enabled": true,
      "priority": 0,
      "input": {
        "kind": "synthetic",
        "statusCode": 503,
        "message": "No upstream endpoint is available."
      },
      "defaults": { "weight": 1, "priority": 0 }
    }
  ]
}
```

## 4. Internal 自动组重映射

把自动组改成 internal 后，再用手动 public 组重新暴露。

```json
{
  "id": "macro:manual:premium-claude",
  "kind": "candidate_selector",
  "enabled": true,
  "visibility": "public",
  "ownership": "manual",
  "name": "premium-claude",
  "config": {
    "surface": {
      "entry": {
        "kind": "external",
        "visibility": "public",
        "match": {
          "kind": "model",
          "requestedModelPattern": "premium-claude",
          "displayName": "premium-claude"
        }
      },
      "output": "route"
    },
    "policy": { "strategy": "weighted" },
    "groups": [
      {
        "id": "internal-products",
        "enabled": true,
        "priority": 0,
        "input": {
          "kind": "route_endpoints",
          "endpointIds": [
            "route-endpoint:product:auto-model:claude-sonnet",
            "route-endpoint:product:auto-model:claude-opus"
          ]
        },
        "defaults": { "weight": 10, "priority": 0 }
      }
    ]
  }
}
```

## 5. 添加 payload 默认值

```json
{
  "filters": {
    "operations": [
      {
        "type": "set_payload",
        "path": "reasoning_effort",
        "value": "medium",
        "mode": "default"
      }
    ]
  }
}
```

## 6. DeepSeek `-max` 注入 reasoning effort

这个模式用于把下游的 `deepseek-v4-pro-max` 暴露成一个高推理强度入口。路由时先把请求模型名改回上游实际模型 `deepseek-v4-pro`，再在构建上游请求前注入 reasoning 参数。

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
        "path": "thinking",
        "value": { "type": "enabled" },
        "mode": "override"
      },
      {
        "type": "set_payload",
        "path": "reasoning_effort",
        "value": "high",
        "mode": "override"
      }
    ]
  }
}
```

完整的 macro 片段：

```json
{
  "id": "macro:manual:deepseek-v4-pro-max",
  "kind": "candidate_selector",
  "enabled": true,
  "visibility": "public",
  "ownership": "manual",
  "name": "deepseek-v4-pro-max",
  "config": {
    "surface": {
      "entry": {
        "kind": "external",
        "visibility": "public",
        "match": {
          "kind": "model",
          "requestedModelPattern": "deepseek-v4-pro-max",
          "displayName": "deepseek-v4-pro-max"
        }
      },
      "output": "route"
    },
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
          "path": "thinking",
          "value": { "type": "enabled" },
          "mode": "override"
        },
        {
          "type": "set_payload",
          "path": "reasoning_effort",
          "value": "high",
          "mode": "override"
        }
      ]
    },
    "policy": { "strategy": "weighted" },
    "groups": [
      {
        "id": "deepseek-pro",
        "label": "DeepSeek V4 Pro",
        "enabled": true,
        "priority": 0,
        "input": {
          "kind": "route_endpoints",
          "endpointIds": ["route-endpoint:supply:deepseek:deepseek-v4-pro"]
        },
        "defaults": { "enabled": true, "weight": 10, "priority": 0 }
      }
    ]
  }
}
```

`override` 表示 `-max` 入口总是强制使用高推理强度。如果希望保留下游请求里已经传入的 `reasoning_effort`，把对应操作改成 `"mode": "default"`。

## 7. 去掉模型后缀

把 `gpt-4o-debug` 改成 `gpt-4o` 后再进入选路。

```json
{
  "filters": {
    "operations": [
      {
        "type": "rewrite_model",
        "source": "current_model",
        "operation": "strip_suffix",
        "suffix": "-debug"
      }
    ]
  }
}
```

## 8. 强制 Responses endpoint

```json
{
  "filters": {
    "operations": [
      {
        "type": "set_endpoint_preference",
        "endpoint": "responses"
      }
    ]
  }
}
```

## 9. Synthetic 503 响应

作为 macro group：

```json
{
  "id": "synthetic-fallback",
  "label": "Synthetic fallback",
  "enabled": true,
  "priority": 0,
  "input": {
    "kind": "synthetic",
    "statusCode": 503,
    "message": "No route is available."
  },
  "defaults": {
    "enabled": true,
    "weight": 1,
    "priority": 0
  }
}
```

作为独立节点：

```json
{
  "id": "synthetic:no-route",
  "type": "synthetic_endpoint",
  "enabled": true,
  "visibility": "internal",
  "ownership": "manual",
  "statusCode": 503,
  "message": "No route is available."
}
```

## 10. 按 metadata 打分

```json
{
  "policy": {
    "strategy": "cel_score",
    "cel": "metadata.qualityScore * 100 - metadata.costRank"
  }
}
```

候选 metadata：

```json
{
  "metadata": {
    "qualityScore": 0.98,
    "costRank": 2,
    "region": "sg"
  }
}
```

## 11. Inline endpoint

适合临时或导入型手动路由组。长期存在的上游端点更推荐建成独立 supply endpoint。

```json
{
  "id": "inline-site-a",
  "label": "Inline Site A",
  "enabled": true,
  "priority": 0,
  "input": {
    "kind": "inline_endpoints",
    "endpoints": [
      {
        "targetId": "inline:site-a:gpt-4o",
        "model": "gpt-4o",
        "weight": 10,
        "metadata": {
          "provider": "openai",
          "siteName": "site-a"
        }
      }
    ]
  },
  "defaults": {
    "weight": 10,
    "priority": 0
  }
}
```

## 12. 请求相关选择

根据请求 payload 选择候选。因为依赖请求上下文，静态概率通常会显示为动态或 `N/A`。

```json
{
  "policy": {
    "strategy": "cel_select",
    "cel": "payload.user_tier == \"premium\" ? 1 : 0"
  }
}
```

## 13. 只启用某地区候选

```json
{
  "policy": {
    "strategy": "weighted",
    "rank": "{\"enabled\": metadata.region == \"sg\", \"weight\": metadata.qualityScore}"
  }
}
```

如果地区来自请求，例如 `payload.region`，概率会变成动态估算。
