# Route Graph 节点参考

本页描述当前 source graph 的节点、port、macro 和 dispatcher policy。先读[JSON 结构](./route-graph-json-overview.md)，再把本页用作字段参考。

## 通用字段

所有 node 共享这些字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 图内唯一稳定 ID |
| `type` | string | 节点类型 |
| `name` | string/null | UI 显示名 |
| `enabled` | boolean | 是否参与编译和运行 |
| `ownership` | `manual`/`system`/`derived` | 谁拥有该对象 |
| `position` | `{x,y}` | 画布位置，不参与运行时 |
| `provenance` | object | 来源信息，用于诊断 |
| `dynamicPorts` | `RouteGraphPort[]` | 高级场景下追加或覆盖的 port |
| `metadata` | object | 静态图级扩展数据 |

`system` 代表由管理投影拥有的语义对象，`derived` 代表 macro lowering 生成的 primitive。两者都不表示自动或手动路由组来源；自动/手动仅是管理层 provenance。

## Port 模型

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 例如 `bidirect.out` |
| `label` | string | UI 显示名 |
| `direction` | `input`/`output` | 输入或输出 |
| `kind` | `request`/`bidirect`/`route` | 流类型 |
| `required` | boolean | 是否必需 |
| `multiple` | boolean | 是否允许多条连接 |
| `collection` | object | `single`、`arr` 或 `set` |
| `readonly` | boolean | 是否只读 |
| `enabled` | boolean | 是否启用 |

edge 必须从 output port 连接到 input port，且两侧 `kind` 必须一致。

## 默认 Port

| 节点 | 默认 port |
|------|-----------|
| `entry` | `bidirect.out` |
| `route_endpoint` | `route.out`, `bidirect.in` |
| `filter` | `request.in`, `request.out`, `bidirect.in`, `bidirect.out` |
| `dispatcher` | `route.in` 或 `bidirect.in`、`bidirect[1...].out` |
| `synthetic_endpoint` | `route.out`, `bidirect.in` |

`dispatcher.mode = "route"` 消费 route candidate；`mode = "flow"` 选择 bidirect flow 分支。

## entry

`entry` 是下游可请求模型的 ingress。节点类型本身已经表达外部入口语义，不携带额外的可见性字段。

| 字段 | 类型 | 说明 |
|------|------|------|
| `match.kind` | `"model"` | 当前唯一匹配类型 |
| `match.requestedModelPattern` | string | 模型名、通配符或 `re:` 正则 |
| `match.displayName` | string/null | 显示名 |

一个公开模型名只能解析到一个 entry。分支选择属于 entry 下游的 `dispatcher`，不属于 matcher。

内部复用不要创建 `entry`，应使用 `route_endpoint` 的 `route_product`。

## route_endpoint

`route_endpoint` 是可连接的路由端点。

| `endpointKind` | 说明 |
|----------------|------|
| `supply` | 实际可调用的上游模型端点 |
| `route_product` | 可被其他 graph path 复用的路由结果 |

| 字段 | 类型 | 说明 |
|------|------|------|
| `routeEndpointId` | string | 稳定端点引用 |
| `endpointKind` | `supply`/`route_product` | 端点语义 |
| `exposure` | `none`/`public`/`internal` | route product 的暴露状态 |
| `resolutionStatus` | `resolved`/`degraded`/`unresolved` | 是否已解析为可执行路径 |
| `ownerKind` | `manual`/`macro` | source graph 内的所有者 |
| `sourceKind` | `upstream_model`/`route_product`/`synthetic`/`inline` | 通用来源类型 |
| `backend` | `{kind:"supply"}` 或 `{kind:"route_endpoints",endpointIds:string[]}` | 后端语义 |
| `config.targets` | `RouteExecutableTarget[]` | supply 的可执行 target |
| `config.targetSelection` | native policy 或 `defer_to_router` | target 的选择规则 |

Supply endpoint 示例：

```json
{
  "id": "route-endpoint:supply:site-a-gpt-4o",
  "type": "route_endpoint",
  "enabled": true,
  "ownership": "manual",
  "routeEndpointId": "route-endpoint:supply:site-a-gpt-4o",
  "endpointKind": "supply",
  "exposure": "none",
  "resolutionStatus": "resolved",
  "ownerKind": "manual",
  "sourceKind": "inline",
  "backend": { "kind": "supply" },
  "config": {
    "targets": [
      {
        "targetId": "site-a-gpt-4o",
        "model": "gpt-4o",
        "weight": 10,
        "metadata": { "provider": "openai", "siteName": "site-a" }
      }
    ],
    "targetSelection": { "kind": "inherit_default" }
  }
}
```

Route product 示例：

```json
{
  "id": "route-endpoint:product:premium-chat",
  "type": "route_endpoint",
  "enabled": true,
  "ownership": "manual",
  "routeEndpointId": "route-endpoint:product:premium-chat",
  "endpointKind": "route_product",
  "exposure": "internal",
  "resolutionStatus": "resolved",
  "ownerKind": "manual",
  "sourceKind": "route_product",
  "backend": {
    "kind": "route_endpoints",
    "endpointIds": ["route-endpoint:supply:site-a-gpt-4o"]
  },
  "match": {
    "kind": "model",
    "requestedModelPattern": "premium-chat",
    "displayName": "premium-chat"
  }
}
```

## filter

`filter` 在 dispatch 或上游请求构建前修改模型名、payload、header 或 endpoint preference。

```json
{
  "id": "filter:force-reasoning",
  "type": "filter",
  "enabled": true,
  "ownership": "manual",
  "operations": [
    {
      "type": "set_payload",
      "path": "reasoning_effort",
      "value": "high",
      "mode": "default"
    }
  ]
}
```

完整操作见[Filter 参考](./route-graph-filters-reference.md)。

## dispatcher

`dispatcher` 是 primitive selector。候选宏在 lowering 时会生成第一个 dispatcher 和后续 fallback dispatcher，并用前一个节点的 `fallback.out` 连接到下一个节点；日常配置不必手动创建它们。

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | `route`/`flow` | 选择 route candidate 或 bidirect flow |
| `ordering` | `explicit` | 基础候选顺序 |
| `policy` | `DispatcherPolicy` | native dispatcher policy 引用 |

```json
{
  "id": "dispatcher:weighted",
  "type": "dispatcher",
  "enabled": true,
  "ownership": "manual",
  "mode": "route",
  "ordering": "explicit",
  "policy": { "kind": "builtin", "builtin": "weighted" }
}
```

## synthetic_endpoint

`synthetic_endpoint` 返回固定终端响应，可作为 macro 或 dispatcher 的 route candidate。

| 字段 | 类型 | 说明 |
|------|------|------|
| `statusCode` | `400`/`401`/`403`/`404`/`409`/`429`/`500`/`502`/`503` | 响应状态 |
| `message` | string | 错误信息 |
| `headers` | object | 可选响应 header |
| `body` | unknown | 可选响应 body |

## candidate_selector macro

`candidate_selector` 是语义 selector，保存在 `macros[]`，不是 `nodes[]`。

| 字段 | 说明 |
|------|------|
| `config.surface` | `external`、`embedded` 或 `none` 入口，以及 `route`/`bidirect` 输出 |
| `config.policy` | stage 未覆盖时继承的 native dispatcher policy |
| `config.groups` | 按数组顺序排列的 fallback stages |
| `groups[].policy` | 可选的 stage-local policy |
| `groups[].input` | stage 的候选来源 |
| `groups[].members` | 显式成员及 stage-local weight/metadata |
| `groups[].defaults` | 成员默认 enabled/weight/metadata |
| `candidateOverrides` | 对已物化 endpoint 的 enabled、weight、excluded 或 stage 归属覆盖 |

支持的 `groups[].input.kind`：

| kind | 状态 | 说明 |
|------|------|------|
| `route_endpoints` | 已实现 | 显式引用 supply 或 route product endpoint |
| `model_pattern` | 已实现 | 按模型 pattern 物化 endpoint |
| `inline_endpoints` | 已实现 | 在 macro 中声明 inline supply target |
| `synthetic` | 已实现 | 声明 synthetic fallback |
| `metadata_query` | 预留 | 编译返回 `macro.resolver_unsupported` |
| `endpoint_query` | 预留 | 编译返回 `macro.resolver_unsupported` |

## Native Dispatcher Policy

任何 `policy` 或 `targetSelection` 使用以下引用之一：

```json
{ "kind": "inherit_default" }
```

```json
{ "kind": "registry", "policyId": "platform-default" }
```

```json
{ "kind": "builtin", "builtin": "weighted" }
```

```json
{
  "kind": "inline",
  "policy": {
    "id": "regional-weighted",
    "name": "Regional weighted",
    "kind": "cel",
    "selectionMode": "weighted",
    "contributionExpression": "max(0.0, runtime.routingSignals.normalizedCostScore)"
  }
}
```

Built-in policy 为 `weighted`、`round_robin` 和 `stable_first`。CEL definition 使用 `weighted`、`ordered`、`round_robin` 或 `direct` selection mode。`priority`、`priority_order`、`routingStrategy` 和 `{ "strategy": ... }` 不属于当前 source graph contract。
