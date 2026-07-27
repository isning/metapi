# 模型广场与模型测试

模型广场现在是模型智能工作区。它不只是展示模型列表，而是把模型身份、可用性、成本、API 能力、兼容性和编译后的路由流放在同一个工作区里。

模型测试使用同一套路由展示组件。两处看到的路由流程、候选端点、概率和成本应该来自同一个编译结果。

## 工作区职责

模型工作区围绕 public model entry 汇总以下信息：

- 可用性和健康状态；
- 编译后的 Graph Routing 路径；
- 候选上游端点；
- selector 选择结果和候选概率；
- 理论成本和参考倍率；
- 上游兼容性策略来源；
- 延迟、成功率、TTFT、TPS、错误和诊断。

## 工作区结构

模型详情通常分为几个区域：

| 区域 | 说明 |
|------|------|
| Overview | 模型身份、健康状态、价格和候选摘要 |
| Routing | 编译后的运行时路由流 |
| Performance | 请求量、成功率、延迟、TTFT、TPS、成本等运行证据 |
| API | 下游 API 能力和上游兼容性策略 |
| Diagnostics | 缺失配置、不可用候选、编译诊断和价格诊断 |

这些区域都围绕同一个 public model entry 展开。运行时路由流的详细模型见 [运行时路由流](./model-route-flow.md)。

## 运行时路由流

路由流程不是直接渲染编辑画布，而是从编译后的 Graph Routing 结果生成。

概念路径：

```text
public model
  -> matcher
  -> filters
  -> dispatcher / selector
  -> candidate endpoint
  -> supply target
  -> API variant attempt plan
```

视图通常包含：

- public entry；
- route group 或 candidate selector；
- 候选 supply endpoints；
- selected path；
- synthetic fallback；
- 诊断标记；
- 概率与成本标注。

如果当前模型没有可用编译结果，页面应显示空状态或诊断，而不是从旧路由表或运行时中间表拼接近似流程。

## 候选端点状态

候选端点有几种常见状态：

| 状态 | 含义 |
|------|------|
| selected | 当前请求或当前解释中被选中的路径 |
| available | 当前可参与选择 |
| disabled | 配置禁用 |
| avoided | 因最近失败、冷却或策略暂时规避 |
| degraded | 可用但健康状态较差 |
| unavailable | 当前不可用或没有可执行目标 |

多个候选可能同时显示为“可用”。“selected”只表示本次解释或当前样本路径的选择结果，不表示其它候选不可用。

## 概率与成本估算

概率应基于编译后的选择计划和统一 selector runtime 计算。

静态可计算：

- 固定权重；
- 固定优先级桶；
- 无请求上下文依赖；
- 无动态 CEL 选择。

动态估算：

- 成本因子；
- 健康因子；
- 余额因子；
- 使用率因子；
- 最近失败和冷却；
- 成功率加权。

无法静态计算时显示 `N/A`，例如：

- 依赖 request metadata；
- CEL 根据请求内容选择；
- 候选是否 eligible 取决于运行时状态；
- 过滤器会根据请求改写候选输入。

### 理论价格和参考倍率

理论 entry 价格按候选概率聚合：

```text
entry theoretical cost
  = sum(candidateProbability * candidateCost)
```

候选成本来源顺序：

```text
模型级手动上游成本
  -> 上游平台目录价格
  -> 上游默认计价
```

参考倍率使用参考价格数据库：

```text
倍率 = 理论 entry 价格 / 参考价格
```

如果没有匹配参考价格，不显示参考倍率。不要把上游默认计价当参考价。

完整估算规则见 [概率与成本估算](./route-probability-cost.md)。更复杂的计价方式见 [高级计价方案](./advanced-pricing.md) 和 [成本目录](./cost-catalog.md)。

## API 能力和兼容性

API 区域展示模型可用的下游表面和上游兼容性：

- Chat Completions；
- Responses；
- Anthropic Messages；
- Gemini GenerateContent；
- tool calls；
- reasoning/thinking 传输；
- 文件、图片、视频等能力；
- endpoint preference；
- 继承来的兼容性策略。

兼容性策略应该说明来源，例如：

```text
Token override
  -> Account setting
  -> Site default
  -> Platform default
```

如果是继承值，页面应优先显示“继承自哪里”，而不是展开所有底层字段让用户误以为当前层级已经覆盖。

## 模型测试请求上下文

模型测试页面用于发送实际测试请求。它的路由流程区域应更紧凑，但解释来源仍然相同：

- 搜索并选择 entry；
- 读取对应编译 route flow；
- 展示候选、概率、成本和诊断；
- 发送请求后展示实际选路、响应、错误和耗时。

如果测试请求指定了强制目标或特殊上下文，页面应标记这是“本次请求上下文下的结果”，避免和默认静态概率混淆。

## 排查建议

### 模型没有路由流程

检查：

1. 模型是否存在 public entry；
2. 路由图是否发布；
3. 编译是否有错误诊断；
4. 自动路由组是否被禁用；
5. supply endpoint 是否存在可执行目标。

### 只有一个候选端点

检查：

1. 上游模型发现是否完整；
2. 账号或 Token 是否启用；
3. endpoint binding 是否支持对应 API 类型；
4. 候选是否被路由组排除；
5. 是否正在查看 selected path 而不是 candidates 视图。

### 成本为 0

检查：

1. 是否配置了模型级手动上游成本；
2. 上游平台目录价格是否可用；
3. 上游默认计价是否为 0；
4. 钱包估值和单位换算是否完整；
5. 用量样本是否为空。
