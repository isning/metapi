# Route Graph JSON 结构

这篇说明如何审查、导入和验证 Route Graph source JSON。日常配置优先使用[路由组使用指南](./route-groups-guide.md)中的管理界面；只有批量导入、生成配置、审查 diff 或实现高级结构时，才直接编辑 JSON。

## 顶层结构

Route Graph source 当前使用 `version: 1`。

```json
{
  "version": 1,
  "nodes": [],
  "edges": [],
  "macros": [],
  "metadata": {}
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `version` | `1` | Route Graph source 版本 |
| `nodes` | `RouteGraphNode[]` | 语义节点和少量手动 primitive |
| `edges` | `RouteGraphEdge[]` | 节点或 macro port 间的语义连接 |
| `macros` | `RouteGraphMacro[]` | 可 lower 的高级语义对象 |
| `metadata` | object | 图级扩展数据，不改变基础拓扑 |

`nodes` 和 `macros` 属于同一张 source graph。macro 会 lower 为 entry、filter、dispatcher、endpoint 和连接边；运行时只执行由它们编译出的 `compiledRouterBundle`。

## 最小可运行图

下面的图将下游模型 `public-model` 直接接到一个 supply endpoint。

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "entry:public-model",
      "type": "entry",
      "enabled": true,
      "ownership": "manual",
      "match": {
        "kind": "model",
        "requestedModelPattern": "public-model",
        "displayName": "public-model"
      }
    },
    {
      "id": "route-endpoint:supply:example-gpt-4o",
      "type": "route_endpoint",
      "enabled": true,
      "ownership": "manual",
      "routeEndpointId": "route-endpoint:supply:example-gpt-4o",
      "endpointKind": "supply",
      "exposure": "none",
      "resolutionStatus": "resolved",
      "ownerKind": "manual",
      "sourceKind": "inline",
      "backend": { "kind": "supply" },
      "config": {
        "targets": [
          {
            "targetId": "example-gpt-4o",
            "model": "gpt-4o",
            "weight": 10
          }
        ],
        "targetSelection": { "kind": "builtin", "builtin": "weighted" }
      }
    }
  ],
  "edges": [
    {
      "id": "edge:public-model-to-gpt-4o",
      "sourceNodeId": "entry:public-model",
      "sourcePortId": "bidirect.out",
      "targetNodeId": "route-endpoint:supply:example-gpt-4o",
      "targetPortId": "bidirect.in",
      "kind": "bidirect_flow",
      "ownership": "manual"
    }
  ],
  "macros": [],
  "metadata": {}
}
```

生产配置通常使用 `candidate_selector` macro 表达多个 endpoint 和明确的 fallback。

## Candidate Selector Macro

`config.groups` 是**有序 fallback stages**，不是优先级桶。第一个 stage 在其成员都不再 eligible 前持续被评估；只有它耗尽后才进入下一 stage。每个 stage 可继承 macro policy，或通过 `policy` 覆盖自己的 stage-local dispatcher policy。

```json
{
  "id": "macro:premium-chat",
  "kind": "candidate_selector",
  "enabled": true,
  "ownership": "manual",
  "name": "premium-chat",
  "config": {
    "surface": {
      "entry": {
        "kind": "external",
        "match": {
          "kind": "model",
          "requestedModelPattern": "premium-chat",
          "displayName": "premium-chat"
        }
      },
      "output": "route"
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
      },
      {
        "id": "backup",
        "label": "Backup",
        "enabled": true,
        "policy": { "kind": "builtin", "builtin": "stable_first" },
        "input": {
          "kind": "synthetic",
          "statusCode": 503,
          "message": "No upstream endpoint is available."
        }
      }
    ]
  }
}
```

`weight` 只影响当前 stage 内的选择。不要写 `priority`、`priority_order`、`routingStrategy` 或 `{ "strategy": ... }`：source graph 和 API 会拒绝这些旧形态。

候选连接边是图编辑器和 inspector 的连线表达。例如：

```json
{
  "id": "edge:site-a-to-premium-chat",
  "sourceNodeId": "route-endpoint:supply:site-a-gpt-4o",
  "sourcePortId": "route.out",
  "targetNodeId": "macro:premium-chat",
  "targetPortId": "candidates.in",
  "kind": "route_flow",
  "ownership": "manual"
}
```

由路由组投影产生的对象通过路由组和 fallback-stage API 修改；不要直接伪造其 ID 或在图中修改其 generated primitive。

## 验证和发布 API

| API | 作用 |
|-----|------|
| `GET /api/route-graph/active` | 获取当前生效 source graph 与编译信息 |
| `GET /api/route-graph/draft` | 获取或创建草稿 |
| `POST /api/route-graph/validate` | 验证 source graph 并返回 diagnostics |
| `POST /api/route-graph/compile` | 编译任意 source graph，用于调试 |
| `PUT /api/route-graph/draft` | 保存草稿 |
| `POST /api/route-graph/draft/publish` | 发布草稿 |
| `POST /api/route-graph/draft/rebase` | 基于最新 active graph 重放草稿 |
| `DELETE /api/route-graph/draft` | 丢弃草稿 |

典型流程：

```text
GET draft
  -> 修改 JSON
  -> POST validate
  -> PUT draft
  -> POST publish
```

## 编译产物

`POST /api/route-graph/compile` 返回：

| 字段 | 说明 |
|------|------|
| `source` | 规范化后的 source graph |
| `primitiveSource` | macro lower 后的调试图 |
| `compiled` | 含 `compiledRouterBundle` 的执行产物 |
| `diagnostics` | 验证与编译诊断 |
| `ok` | 是否没有 error 级诊断 |

`primitiveSource` 仅用于 inspector、生成视图和调试。请求路径执行 `compiled.compiledRouterBundle`，不会读取 route-group 管理表或编辑器布局。

## ID 规则

手写对象需要稳定 ID，但调用方不应从显示文本、模型名或数字 ID 拼接系统对象 ID。对已有 supply endpoint、route product 或 macro，请从 endpoint catalog、source graph 或管理 API 获取其实际 ID；让路由组投影和图编辑器生成其所拥有的 ID。

手写的全新 semantic node 可以使用稳定、可读的自有 ID，例如：

```text
entry:premium-chat
macro:premium-chat
filter:rewrite-model
synthetic:no-route
```

避免临时 ID、显示名引用和猜测系统生成的 endpoint ID。
