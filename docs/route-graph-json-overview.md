# Route Graph JSON 结构

这篇说明如何审查、导入和验证 Route Graph source JSON。日常配置优先使用[路由组使用指南](./route-groups-guide.md)中的管理界面；只有批量导入、生成配置、审查 diff 或实现高级结构时，才直接编辑 JSON。

## 顶层结构

```json
{
  "nodes": [],
  "edges": [],
  "macros": [],
  "metadata": {}
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `nodes` | `RouteGraphNode[]` | 语义节点和少量手动 primitive |
| `edges` | `RouteGraphEdge[]` | 节点或 macro port 间的语义连接 |
| `macros` | `RouteGraphMacro[]` | 可 lower 的高级语义对象 |
| `metadata` | object | 图级扩展数据，不改变基础拓扑 |

`nodes` 和 `macros` 属于同一张 source graph。macro 会 lower 为 entry、filter、dispatcher、endpoint 和连接边；运行时只执行由它们编译出的 `compiledRouterBundle`。

## 最小可运行图

下面的图将下游模型 `public-model` 直接接到一个 supply endpoint。

```json
{
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

## Workspace、验证和发布 API

| API | 作用 |
|-----|------|
| `GET /api/route-graph/active` | 获取当前生效 source graph 与编译信息 |
| `GET /api/route-graph/draft` | 获取或创建草稿 |
| `GET /api/route-graph/workspace-index` | 分页读取 graph focus 索引 |
| `GET /api/route-graph/workspace?focusKind=...&focusId=...` | 读取一个 focus 的局部图窗口 |
| `POST /api/route-graph/workspace/nodes/reserve` | 为本地草稿节点预留服务端 ID，不持久化 |
| `POST /api/route-graph/workspace/connections/draft` | 基于本地 operation overlay 校验并分配 edge ID，不持久化 |
| `POST /api/route-graph/workspace/operations` | 原子保存本地 node/edge/macro 操作 |
| `POST /api/route-graph/validate` | 验证 authoring command 并返回 diagnostics/compiled graph |
| `POST /api/route-graph/workspace/validate` | 验证当前 revision 加本地 operation overlay |
| `PUT /api/route-graph/draft` | 保存草稿 |
| `POST /api/route-graph/draft/publish` | 发布草稿 |
| `POST /api/route-graph/draft/rebase` | 基于最新 active graph 重放草稿 |
| `DELETE /api/route-graph/draft` | 丢弃草稿 |

典型流程：

```text
打开 workspace focus
  -> 本地编辑 operations
  -> POST workspace/validate
  -> POST workspace/operations
  -> 发布 draft
```

## 验证产物

`POST /api/route-graph/validate` 和 workspace validate 返回：

| 字段 | 说明 |
|------|------|
| `source` | 规范化后的 source graph |
| `primitiveSource` | macro lower 后的调试图 |
| `compiled` | 含 `compiledRouterBundle` 的执行产物 |
| `diagnostics` | 验证与编译诊断 |
| `ok` | 是否没有 error 级诊断 |

`primitiveSource` 仅用于 inspector、生成视图和调试。请求路径执行
`compiled.compiledRouterBundle`，不会读取 Route Group 管理投影或编辑器布局。

## ID 规则

所有 durable graph ID 都由服务端分配。Workspace 中新增 node 使用
`/nodes/reserve` 获取正式 ID；批量 authoring 命令使用 `localRef` 引用本次
请求内的新对象，服务端在保存时分配其 ID。调用方不得从模型名、显示文本、
数字 ID 或 macro 规则拼接 node、macro、endpoint 或 edge ID。

JSON 备份中的已有 ID 只能原样引用；新对象使用 API 的 `localRef`/reservation
流程，不使用临时字符串冒充 durable ID。
