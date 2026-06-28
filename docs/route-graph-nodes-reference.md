# Route Graph 节点参考

这篇按节点类型说明字段、port 和最小 JSON。先读 [JSON 结构](./route-graph-json-overview.md)，再查本页会更容易。

## 通用字段

所有 node 共享这些基础字段：

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 图内唯一稳定 ID |
| `type` | string | 是 | 节点类型 |
| `name` | string/null | 否 | UI 显示名 |
| `enabled` | boolean | 是 | 是否参与编译/运行 |
| `visibility` | `public`/`internal` | 是 | 对下游或内部可见性 |
| `ownership` | `manual`/`auto_generated`/`system`/`derived` | 是 | 所有权 |
| `position` | `{x,y}` | 否 | 画布坐标 |
| `provenance` | object | 否 | 来源信息 |
| `dynamicPorts` | `RouteGraphPort[]` | 否 | 额外 port |

`dynamicPorts` 会覆盖或追加默认 port。一般只在高级图编辑场景使用。

## Port 模型

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | port ID，例如 `bidirect.out` |
| `label` | string | UI 显示名 |
| `direction` | `input`/`output` | 输入或输出 |
| `kind` | `request`/`bidirect`/`route` | 连接类型 |
| `required` | boolean | 是否必需 |
| `multiple` | boolean | 是否允许多条连接 |
| `collection` | object | `single`、`arr` 或 `set` |
| `readonly` | boolean | 是否只读 |
| `enabled` | boolean | 是否启用 |
| `description` | string | 说明 |

edge 必须从 output port 连到 input port，且 source port 和 target port 的 `kind` 必须相同。

## 默认 Port

| 节点 | 默认 port |
|------|-----------|
| `entry` | `bidirect.out` |
| `route_endpoint` | `route.out`, `bidirect.in` |
| `filter` | `request.in`, `request.out`, `bidirect.in`, `bidirect.out` |
| `dispatcher` | `bidirect.in`, `bidirect[1...].out`, `route.in` |
| `synthetic_endpoint` | `route.out`, `bidirect.in` |
| `auto_node` | `route.in`, `bidirect.in`, `bidirect.out` |

`dispatcher.mode = "route"` 时使用 `route.in`；`mode = "flow"` 时使用 `bidirect[1...].out`。

## entry

`entry` 是下游可请求模型的入口。它只能是 `visibility: "public"`。

重要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `match.kind` | `"model"` | 当前只支持模型匹配 |
| `match.requestedModelPattern` | string | 下游请求模型名、通配符或 `re:` 正则 |
| `match.displayName` | string/null | 显示名 |
| `selectionStrategy` | `priority_order`/`weighted`/`round_robin`/`stable_first` | 入口选择策略 |

最小 JSON：

```json
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
}
```

常见错误：

- internal 复用不要创建 `entry`，应使用 `route_endpoint endpointKind=route_product`。
- 同一个 public model 不能被多个 public entry 或 public macro 同时声明。

## route_endpoint

`route_endpoint` 表达可连接的路由端点。

| `endpointKind` | 说明 |
|----------------|------|
| `supply` | 实际可调用的上游模型端点 |
| `route_product` | 路由组或手动路由产物，可被其他 macro 复用 |

重要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `routeEndpointId` | string | 稳定端点 ID |
| `endpointKind` | `supply`/`route_product` | 端点语义 |
| `exposure` | `none`/`public`/`internal` | route product 暴露状态 |
| `resolutionStatus` | `resolved`/`degraded`/`unresolved` | 是否可解析 |
| `ownerKind` | `automatic_route`/`manual_route`/`macro` | 归属来源 |
| `sourceKind` | `upstream_model`/`automatic_model_group`/`manual_group`/`synthetic`/`inline` | 来源类型 |
| `backend` | `{kind:"supply"}` 或 `{kind:"routes",routeIds:number[]}` | 后端语义 |
| `match` | `RouteGraphMatchSpec` | 暴露模型匹配信息 |
| `config.targets` | `RouteExecutableTarget[]` | supply 可执行目标 |
| `metadata` | object | 选择策略和 UI 可用元数据 |

手动 supply 示例：

```json
{
  "id": "route-endpoint:supply:manual:site-a:gpt-4o",
  "type": "route_endpoint",
  "enabled": true,
  "visibility": "internal",
  "ownership": "manual",
  "routeEndpointId": "route-endpoint:supply:manual:site-a:gpt-4o",
  "endpointKind": "supply",
  "exposure": "none",
  "resolutionStatus": "resolved",
  "ownerKind": "manual_route",
  "sourceKind": "inline",
  "backend": { "kind": "supply" },
  "config": {
    "targets": [
      {
        "targetId": "site-a:gpt-4o",
        "model": "gpt-4o",
        "weight": 10,
        "priority": 0,
        "metadata": {
          "provider": "openai",
          "siteName": "site-a"
        }
      }
    ],
    "targetSelection": { "strategy": "weighted" }
  }
}
```

route product 示例：

```json
{
  "id": "route-endpoint:product:manual:premium-chat",
  "type": "route_endpoint",
  "enabled": true,
  "visibility": "internal",
  "ownership": "manual",
  "routeEndpointId": "route-endpoint:product:manual:premium-chat",
  "endpointKind": "route_product",
  "exposure": "internal",
  "resolutionStatus": "resolved",
  "ownerKind": "manual_route",
  "sourceKind": "manual_group",
  "backend": { "kind": "routes", "routeIds": [] },
  "match": {
    "kind": "model",
    "requestedModelPattern": "premium-chat",
    "displayName": "premium-chat"
  }
}
```

## filter

`filter` 修改请求模型名、payload、header 或 endpoint preference。

重要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `operations` | `RouteFilter[]` | 按顺序执行的操作 |

示例：

```json
{
  "id": "filter:force-reasoning",
  "type": "filter",
  "enabled": true,
  "visibility": "internal",
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

详细操作见 [Filter 参考](./route-graph-filters-reference.md)。

## dispatcher

`dispatcher` 是 primitive 选择器。路由组通常会自动 lower 出 dispatcher，日常不需要手动创建。

重要字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `mode` | `route`/`flow` | 选择 route candidate 或 bidirect flow |
| `ordering` | `explicit` | 按输入边和 candidate 顺序处理 |
| `policy.strategy` | `priority_order`/`weighted`/`round_robin`/`stable_first`/`direct` | 选择策略 |
| `policy.select` | string | `direct` 策略使用的 CEL |
| `policy.score` | string 或 score terms | 排序或打分 |

示例：

```json
{
  "id": "dispatcher:manual:weighted",
  "type": "dispatcher",
  "enabled": true,
  "visibility": "internal",
  "ownership": "manual",
  "mode": "route",
  "ordering": "explicit",
  "policy": { "strategy": "weighted" }
}
```

## synthetic_endpoint

`synthetic_endpoint` 返回固定错误或 fallback 响应。它可以作为 route candidate 接入 macro 或 dispatcher。

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `statusCode` | `400`/`401`/`403`/`404`/`409`/`429`/`500`/`502`/`503` | 响应状态 |
| `message` | string | 错误信息 |
| `headers` | object | 可选响应 header |
| `body` | unknown | 可选响应 body |

示例：

```json
{
  "id": "synthetic:capacity-exceeded",
  "type": "synthetic_endpoint",
  "enabled": true,
  "visibility": "internal",
  "ownership": "manual",
  "statusCode": 429,
  "message": "capacity exceeded"
}
```

## auto_node

`auto_node` 是系统/历史导入使用的节点类型。新手写 JSON 不应创建它。新的路由结构应使用 `candidate_selector` macro、`route_endpoint` 和 `dispatcher`。

## candidate_selector macro

`candidate_selector` 是路由组的语义节点。它不是 `nodes[]`，而是 `macros[]` 中的对象。

基础字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | macro ID |
| `kind` | `"candidate_selector"` | 当前唯一 macro kind |
| `enabled` | boolean | 是否启用 |
| `visibility` | `public`/`internal` | 暴露状态 |
| `ownership` | `manual`/`auto_generated`/`system` | 所有权 |
| `name` | string/null | 显示名 |
| `position` | `{x,y}` | 画布坐标 |
| `metadata` | object | 扩展信息 |

`config.surface`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `entry.kind` | `external`/`embedded` | 是否生成 public entry |
| `entry.visibility` | `public`/`internal` | external entry 可见性 |
| `entry.match` | `RouteGraphMatchSpec` | external entry 匹配 |
| `entry.input` | `request`/`bidirect` | embedded 输入类型 |
| `output` | `route`/`bidirect` | 输出类型 |
| `ports` | `RouteGraphPort[]` | 可省略，系统生成默认 ports |

默认 macro ports：

| surface | 默认 port |
|---------|-----------|
| external route output | `bidirect.in`, `candidates.in`, `route.out` |
| embedded request input | `request.in`, `candidates.in`, `route.out` |
| embedded bidirect input | `bidirect.in`, `candidates.in`, `route.out` |
| bidirect output | 输出变为 `bidirect.out` |

`config.policy`：

| 策略 | 说明 |
|------|------|
| `priority_order` | 先选最高优先级桶，再在桶内按权重 |
| `weighted` | 按权重选择 |
| `round_robin` | 按顺序轮询 |
| `stable_first` | 稳定优先 |
| `cel_select` | CEL 返回候选 index |
| `cel_score` | CEL 给每个候选打分 |

`config.groups[]`：

| 字段 | 类型 | 说明 |
|------|------|------|
| `id` | string | 组 ID |
| `label` | string | 显示名 |
| `enabled` | boolean | 是否启用 |
| `priority` | number | 优先级 |
| `input` | group input | 候选来源 |
| `defaults` | object | 默认 enabled/weight/priority/metadata |
| `materialization` | object | 排序、限制、去重 |
| `metadata` | object | 组级 metadata |

Group input 支持状态：

| kind | 状态 | 说明 |
|------|------|------|
| `route_endpoints` | 已实现 | 显式引用 supply 或 route product endpoint |
| `model_pattern` | 已实现 | 按模型 pattern 物化匹配 endpoint |
| `inline_endpoints` | 已实现 | 在 macro 内声明 inline supply |
| `synthetic` | 已实现 | 在 macro 内声明 synthetic fallback |
| `metadata_query` | 预留 | 当前 lower 会产生 `macro.resolver_unsupported` |
| `endpoint_query` | 预留 | 当前 lower 会产生 `macro.resolver_unsupported` |

完整 macro 示例见 [JSON 结构](./route-graph-json-overview.md) 和 [Recipes](./route-graph-recipes.md)。
