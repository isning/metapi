# Route Graph JSON 结构

这篇说明如何手写、导入和验证 Route Graph JSON。日常配置优先使用 [路由组使用指南](./route-groups-guide.md) 里的界面；只有需要批量导入、生成配置、审查 diff 或实现高级结构时，才建议直接编辑 JSON。

## 顶层结构

Route graph source 当前使用 `version: 1`。

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
| `version` | `1` | Route graph source 版本 |
| `nodes` | `RouteGraphNode[]` | 语义节点和少量手动 primitive 节点 |
| `edges` | `RouteGraphEdge[]` | 节点或 macro port 之间的语义连接 |
| `macros` | `RouteGraphMacro[]` | 路由组等高级语义对象 |
| `metadata` | object | 图级扩展信息，不参与核心路由语义 |

`nodes` 和 `macros` 是同一张图的两类对象。macro 不是第二套模型；它会在编译时 lower 成 entry、filter、dispatcher、candidate endpoint 等 primitive。

## 最小可运行图

这个示例把下游模型 `public-model` 直接路由到一个手动 supply endpoint。

```json
{
  "version": 1,
  "nodes": [
    {
      "id": "entry:public-model",
      "type": "entry",
      "enabled": true,
      "visibility": "public",
      "ownership": "manual",
      "match": {
        "kind": "model",
        "requestedModelPattern": "public-model",
        "displayName": "public-model"
      },
      "selectionStrategy": "weighted"
    },
    {
      "id": "route-endpoint:supply:manual:openai:gpt-4o",
      "type": "route_endpoint",
      "enabled": true,
      "visibility": "internal",
      "ownership": "manual",
      "routeEndpointId": "route-endpoint:supply:manual:openai:gpt-4o",
      "endpointKind": "supply",
      "exposure": "none",
      "resolutionStatus": "resolved",
      "ownerKind": "manual_route",
      "sourceKind": "inline",
      "backend": { "kind": "supply" },
      "config": {
        "targets": [
          {
            "targetId": "openai:gpt-4o",
            "model": "gpt-4o",
            "weight": 10
          }
        ],
        "targetSelection": { "strategy": "weighted" }
      }
    }
  ],
  "edges": [
    {
      "id": "edge:public-model:to:gpt-4o",
      "sourceNodeId": "entry:public-model",
      "sourcePortId": "bidirect.out",
      "targetNodeId": "route-endpoint:supply:manual:openai:gpt-4o",
      "targetPortId": "bidirect.in",
      "kind": "bidirect_flow",
      "ownership": "manual"
    }
  ],
  "macros": [],
  "metadata": {}
}
```

这种写法适合最小测试。生产配置更推荐用 `candidate_selector` macro 表达路由组。

## Macro 写法

这个示例定义一个手动 public 路由组，把两个已经存在的 supply endpoint 作为候选，并按 70/30 加权。

```json
{
  "id": "macro:manual:premium-chat",
  "kind": "candidate_selector",
  "enabled": true,
  "visibility": "public",
  "ownership": "manual",
  "name": "premium-chat",
  "config": {
    "surface": {
      "entry": {
        "kind": "external",
        "visibility": "public",
        "match": {
          "kind": "model",
          "requestedModelPattern": "premium-chat",
          "displayName": "premium-chat"
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
        "defaults": {
          "enabled": true,
          "weight": 10,
          "priority": 0
        }
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

语义图里通常还会保存候选连接边：

```json
{
  "sourceNodeId": "route-endpoint:supply:site-a:gpt-4o",
  "sourcePortId": "route.out",
  "targetNodeId": "macro:manual:premium-chat",
  "targetPortId": "candidates.in",
  "kind": "route_flow",
  "ownership": "manual"
}
```

`config.groups` 是路由行为的来源；candidate edge 是图编辑器和 inspector 的连接表达。自动生成的 candidate edge 不应直接删除，应通过路由组候选表写 override。

## 验证和发布 API

图编辑器使用这些 API：

| API | 作用 |
|-----|------|
| `GET /api/route-graph/active` | 获取当前生效图 |
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
| `compiled` | 编译结果 |
| `diagnostics` | 诊断列表 |
| `ok` | 是否没有 error 级诊断 |

运行时执行的是 `compiled.flatProgramBundle`。`primitiveSource` 用于 inspector、生成视图和调试，不是请求路径的执行格式。

## ID 规则

手写 JSON 时，ID 应该稳定、可读、可 diff。

推荐：

```text
entry:manual:premium-chat
macro:manual:premium-chat
route-endpoint:supply:manual:site-a:gpt-4o
route-endpoint:product:manual:premium-chat
edge:site-a-gpt-4o:to:premium-chat
```

避免：

```text
node1
tmp-1690000000
gpt
```

规则：

- 不要依赖 `name` 或显示文本作为引用；
- 手动对象的 `id` 应长期稳定；
- 自动 supply endpoint 的 ID 由系统生成；
- route product 用 `route_endpoint endpointKind=route_product` 表达；
- supply endpoint 用 `route_endpoint endpointKind=supply` 表达；
- `channel`、`pool`、`target_pool` 不属于 route graph source JSON。

## Ownership

| ownership | 是否用户直接编辑 | 说明 |
|-----------|------------------|------|
| `manual` | 可以 | 用户创建或导入的对象 |
| `auto_generated` | 不直接编辑 | 自动发现和自动路由组生成 |
| `system` | 不直接编辑 | 系统保留对象 |
| `derived` | 不直接编辑 | macro lowering 或编译生成 |

自动数据需要通过上层语义配置修改，例如候选 override、public/internal、启用状态、权重和优先级。

## 下一步

- 节点字段和 port：看 [节点参考](./route-graph-nodes-reference.md)。
- 请求改写：看 [Filter 参考](./route-graph-filters-reference.md)。
- CEL 和 metadata：看 [Metadata 与 CEL](./route-graph-metadata-cel-reference.md)。
- 直接复制例子：看 [Recipes](./route-graph-recipes.md)。
