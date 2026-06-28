# Route Graph Metadata 与 CEL

Metadata 给候选、组、边和目标补充可选择的信息。CEL 用于高级选择策略，例如按地区、成本、质量分、请求 metadata 或运行时状态选择候选。

## Metadata 层级

运行时候选 metadata 会从多个位置汇总。越靠近候选的字段越适合放选择相关信息。

| 位置 | 用途 |
|------|------|
| `route_endpoint.metadata` | endpoint 级稳定属性 |
| `config.targets[].metadata` | 具体上游目标属性 |
| `macro.config.groups[].metadata` | priority group 属性 |
| `macro.config.groups[].defaults.metadata` | 组内候选默认 metadata |
| `edge.metadata` | 某条候选连接的补充属性 |
| generated `macroCandidate` | 编译器生成的 macro/group/priority/weight 信息 |

推荐稳定字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `provider` | string | 上游 provider |
| `siteId` | number/string | 站点 ID |
| `siteName` | string | 站点名 |
| `accountId` | number/string | 账号 ID |
| `tokenId` | number/string | token ID |
| `upstreamModel` | string | 上游模型名 |
| `normalizedModel` | string | 规范化模型名 |
| `region` | string | 地区 |
| `tier` | string | 层级 |
| `qualityScore` | number | 质量分 |
| `costRank` | number | 成本排序 |
| `supportsReasoning` | boolean | 是否支持 reasoning |

只有写入 route graph JSON 或编译候选中的字段，才适合在用户 CEL 中长期依赖。诊断面板里的临时运行时字段可能只用于展示。

## Selector CEL Context

selector CEL 可访问这些变量：

| 变量 | 类型 | 说明 |
|------|------|------|
| `payload` | object | 请求状态或调用方传入 payload |
| `metadata` | object | 当前候选 metadata |
| `stateStore` | object | 运行时状态 |
| `idx` | number | 当前候选 index |
| `candidate` | object | 当前候选摘要 |
| `candidates` | object[] | 所有候选摘要 |

默认 `payload` 包含：

```json
{
  "requestedModel": "public-model",
  "currentModel": "public-model",
  "upstreamModel": "upstream-model",
  "endpointPreference": "responses"
}
```

`candidate` 结构：

```json
{
  "idx": 0,
  "kind": "route",
  "nodeId": "route-endpoint:supply:site-a:gpt-4o",
  "edgeId": "edge:site-a:to:macro",
  "metadata": {},
  "weight": 10,
  "priority": 0,
  "enabled": true,
  "runtime": {}
}
```

## cel_select

`cel_select` 直接返回候选 index，或返回包含 `idx` 的对象。

```json
{
  "policy": {
    "strategy": "cel_select",
    "cel": "payload.user_tier == \"premium\" ? 1 : 0"
  }
}
```

如果返回的 index 越界，运行时会使用第一个候选。

适合：

- 请求携带 tenant、tier、region；
- 按 payload 字段选择固定候选；
- 明确的 A/B 分支。

## cel_score

`cel_score` 对每个候选计算分数，选择最高分。

```json
{
  "policy": {
    "strategy": "cel_score",
    "cel": "metadata.qualityScore * 100 - metadata.costRank"
  }
}
```

适合：

- 按质量和成本排序；
- 按 region、tier、capability 做静态偏好；
- 需要按候选属性生成可解释排序的场景。

## Dispatcher score

底层 dispatcher 也支持 `policy.score`：

```json
{
  "policy": {
    "strategy": "weighted",
    "score": "metadata.qualityScore - metadata.costRank"
  }
}
```

`score` 也可以是 score terms：

```json
{
  "policy": {
    "strategy": "weighted",
    "score": [
      { "source": "metadata.qualityScore", "weight": 1 },
      { "source": "metadata.costRank", "weight": -1 }
    ]
  }
}
```

`source` 可以是路径，也可以是表达式。路径形式更容易被编译器静态分析，适合用于概率和成本预估。

## rank/evaluate/expression

运行时会把 `rank`、`evaluate` 或 `expression` 作为候选评价表达式。表达式返回 object 时，可覆盖候选属性：

```json
{
  "policy": {
    "strategy": "weighted",
    "rank": "{\"enabled\": metadata.region == \"sg\", \"weight\": metadata.qualityScore, \"priority\": 10}"
  }
}
```

可返回字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | boolean | 是否启用候选 |
| `weight` | number | 候选权重 |
| `priority` | number | 候选优先级 |
| `score` | number | 候选分数 |

如果只需要一个数值分数，优先使用 `cel_score` 或 `score`。

## 静态概率和动态概率

概率估算来自 selector runtime。编译器会尽量分析策略是否只依赖静态候选信息；一旦表达式读取请求或运行时状态，默认展示为动态估算或 `N/A`。

可以静态估算：

- `weighted` 且权重固定；
- `round_robin`；
- `stable_first`；
- `priority_order`；
- 不读取 `payload` 或 `stateStore` 的 score。

显示为动态或 `N/A`：

- CEL 读取 `payload`；
- CEL 读取 `stateStore`；
- endpoint 健康、冷却、余额、成本或负载在请求时变化；
- direct 选择依赖请求上下文；
- 候选 eligibility 只能在请求时确定。

## Macro group input 状态

| input kind | 状态 | CEL 是否参与 |
|------------|------|--------------|
| `route_endpoints` | 已实现 | 不需要 |
| `model_pattern` | 已实现 | pattern 匹配，不是 CEL |
| `inline_endpoints` | 已实现 | 不需要 |
| `synthetic` | 已实现 | 不需要 |
| `metadata_query` | 预留 | 当前不执行，返回 `macro.resolver_unsupported` |
| `endpoint_query` | 预留 | 当前不执行，返回 `macro.resolver_unsupported` |

如果需要按 metadata 选择候选，当前推荐做法是先显式列出候选，再用 `cel_score`、`cel_select` 或 candidate override 控制选择。

## 调试建议

- 在模型测试里查看 selected candidate 和概率计算方式。
- 在图编辑 inspector 查看 candidate metadata。
- 如果概率为 `N/A`，检查 CEL 是否读取了 `payload` 或 `stateStore`。
- 不要在 CEL 中依赖 UI 文案、显示名或临时诊断字段。
