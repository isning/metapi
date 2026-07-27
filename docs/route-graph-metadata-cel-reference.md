# Route Graph Metadata 与 CEL

CEL 只在 dispatcher policy 执行时读取已编译的 runtime scopes。它不读取 route-group 表、候选表、编辑器布局或自动/手动 provenance。这样 source graph、compiled runtime 和 proxy 的选择边界保持一致。

## Metadata 分层

Metadata 不会被无差别合并成一个全局对象。每一层都通过明确 scope 暴露，避免 endpoint、execution attempt、plan 和 graph 的同名字段互相污染。

| Source 位置 | 编译后 CEL scope | 用途 |
|-------------|------------------|------|
| `route_endpoint.metadata` | `endpoint.metadata` | endpoint 的稳定语义属性 |
| `config.targets[].metadata` | `executionAttempt.metadata` | 一个可执行 target 的属性 |
| stage/member metadata | `selection.metadata` | 当前 dispatcher option 的属性 |
| `CompiledRouterPlan.metadata` | `plan.metadata` | 当前 public route plan 的属性 |
| `CompiledRouterBundle.metadata` | `graph.metadata` | 整个 compiled runtime 的属性 |
| 实时健康、成本、余额、负载 | 相应 scope 的 `runtime` | 请求时可变的运行状态 |

`self` 是当前被求值的 option。它包含自身的 `metadata`、`runtime`、`selection`、`endpoint`、`executionAttempt`、`plan` 和 `graph` scope。不要假设 `metadata` 是顶层变量，也不要在 CEL 中依赖 route group、candidate ID、管理来源或 UI 文案。

推荐放入稳定 metadata 的字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | 上游 provider |
| `siteId` | number/string | 站点 ID |
| `siteName` | string | 站点名称 |
| `accountId` | number/string | 账号 ID |
| `tokenId` | number/string | 凭证 ID |
| `upstreamModel` | string | 上游模型名 |
| `normalizedModel` | string | 规范化模型名 |
| `region` | string | 地区 |
| `tier` | string | 服务层级 |
| `supportsReasoning` | boolean | 是否支持 reasoning |

## CEL Context

每次对一个 option 计算 CEL 时可访问：

| 变量 | 类型 | 说明 |
|------|------|------|
| `request` | object | 完整请求 scope，含 `payload` 与 `headers` |
| `payload` | object | 请求 payload |
| `headers` | object | 请求 header |
| `stateStore` | object | selector 的运行状态，例如轮询计数 |
| `idx` | number | 当前 option 的 index |
| `self` | object | 当前 option 的完整 scope |
| `candidates` | object[] | 当前 dispatcher 的所有 option scope |
| `runtime` | object | 当前 option 的运行时数据 |
| `selection` | object/null | 当前 selection term scope |
| `endpoint` | object/null | 当前 endpoint scope |
| `executionAttempt` | object/null | 当前 execution attempt scope |
| `plan` | object/null | 当前 compiled plan scope |
| `graph` | object/null | 当前 compiled bundle scope |

当前 option 的稳定和动态数据可按下列方式读取：

```cel
self.metadata.region == "sg"
```

```cel
runtime.routingSignals.normalizedCostScore
```

```cel
executionAttempt.runtime.routingSignals.normalizedBalanceScore
```

```cel
request.payload.user_tier == "premium"
```

运行时字段可能缺失或随请求变化。CEL 应显式处理这种情况，而不是把未定义值当成固定信号。

## Dispatcher Policy Definition

Graph 中的 policy 是 native reference；它可以引用 Settings 的 policy registry，或者携带一个 inline definition。可用的 definition 字段为：

| 字段 | 适用 selection mode | 说明 |
|------|----------------------|------|
| `eligibilityExpression` | 所有模式 | 返回 boolean，决定 option 是否 eligible |
| `contributionExpression` | `weighted` | 返回非负贡献值，决定加权概率 |
| `orderExpression` | `ordered` | 返回排序值，最小值优先 |
| `selectExpression` | `direct` | 返回当前 eligible option 的非负整数 index，或含 `idx` 的对象 |
| `builtin` | `kind: "builtin"` | `weighted`、`round_robin` 或 `stable_first` |

加权 CEL policy 示例：

```json
{
  "kind": "inline",
  "policy": {
    "id": "regional-weighted",
    "name": "Regional weighted",
    "kind": "cel",
    "selectionMode": "weighted",
    "eligibilityExpression": "self.metadata.region == request.payload.region",
    "contributionExpression": "max(0.0, 0.7 * runtime.routingSignals.normalizedCostScore + 0.3 * runtime.routingSignals.normalizedBalanceScore)"
  }
}
```

有序 CEL policy 示例：

```json
{
  "kind": "inline",
  "policy": {
    "id": "lowest-cost-first",
    "name": "Lowest cost first",
    "kind": "cel",
    "selectionMode": "ordered",
    "orderExpression": "runtime.routingSignals.cost.routingCost"
  }
}
```

Direct policy 示例：

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

Direct expression 返回非整数、负数或超出当前 eligible 列表范围的 index 时，selector 会
fail closed，并抛出 direct-selection policy evaluation error；不会静默改选第一个 option。
对象形式 `{"idx": 1}` 与直接返回 `1` 等价。因此 direct policy 应配合
eligibility expression，且不要用它模拟 fallback stage。

策略注册表发布前会在标准验证 scope 中执行表达式契约检查。验证 scope 的
`request.payload`、`headers`、`query` 和各层 metadata 默认是空对象，因此直接访问可能
不存在的属性可能在验证阶段失败。对可选字段使用存在性/大小判断或条件表达式，并确保
`eligibilityExpression` 返回 boolean、数值表达式返回有限 number、direct 表达式返回非负
整数；运行时仍可能因实际请求和 eligible 列表而产生不同结果。

## Fallback 与 CEL

每个 route-mode dispatcher 的 `fallback.out` 定义下一个 fallback stage。它以普通 `bidirect_flow` 边连接到下一个节点的 `bidirect.in`；链路拓扑就是 fallback 顺序。一个 policy 只评估当前 dispatcher 的 option；当前 dispatcher 耗尽后 runtime 才沿 `fallback.out` 进入下一 stage。CEL 不读取也不返回 `priority`。

```text
stage 1: policy evaluates primary options
  -> no eligible execution alternative
stage 2: policy evaluates backup options
  -> no eligible execution alternative
stage 3: synthetic response
```

把主备语义放在 stage 顺序中，把 stage 内的概率、健康、成本和地区选择放在 dispatcher policy 中。

## 概率与动态输入

只有不读取请求或运行时状态的 policy 才能给出固定静态概率。下列输入会使估算变成动态或不可用：

- `request`、`payload` 或 `headers`；
- `stateStore`；
- `runtime` 中的健康、冷却、余额、成本或负载信号；
- 请求时才可判定的 endpoint compatibility。

这不影响实际执行。它仅表示没有一个与所有请求都相同的理论概率。完整规则见[概率与成本估算](./route-probability-cost.md)。

## 调试建议

- 在 Settings 验证并模拟 policy definition；
- 在模型测试中检查实际请求的 compiled runtime projection；
- 在图 inspector 中查看 source metadata 和 generated primitive；
- 在 CEL 中使用 scope 名称，不依赖显示名、管理 ID 或诊断文本。
