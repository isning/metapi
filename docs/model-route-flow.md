# 运行时路由流

模型广场和模型测试会为选中的 public model 展示运行时路由流。该视图来自已发布 Graph Routing 的编译结果，不是图编辑器画布的直接渲染。

## 数据来源

运行时路由流由 flat program bundle 构建：

```text
public model
  -> matcher
  -> filter stages
  -> selector / dispatcher
  -> candidate endpoint
  -> supply target or synthetic response
```

这样可以保证页面展示与真实请求执行一致。画布布局、supply 折叠控制和 generated preview 节点属于编辑器行为，不参与运行时路由流。

## 流程组成

| 组成 | 含义 |
|------|------|
| Entry | 下游请求匹配到的 public model ingress |
| Filter | 上游派发前的请求改写阶段 |
| Selector | 候选集合和选择策略 |
| Candidate | 可被选择的一条候选路径 |
| Supply endpoint | 具体上游模型端点 |
| Route product | 可作为候选复用的路由组产物 |
| Synthetic endpoint | 配置的合成响应终端 |

`Candidate` 是 selector 层面的路径。它可以解析到 supply endpoint、另一个 route product，或 synthetic endpoint。

## 候选状态

| 状态 | 含义 |
|------|------|
| `selected` | 当前样本或请求上下文中被选中的路径 |
| `available` | 当前可参与选择 |
| `disabled` | 被配置禁用 |
| `avoided` | 因失败、冷却或策略状态被临时规避 |
| `degraded` | 可用但质量较低 |
| `unavailable` | 没有可执行目标 |

多个候选可以同时处于 `available` 状态。`selected` 只描述一次评估结果，不表示其它候选不可用。

## 候选概率

候选概率由 selector runtime 计算。

可以静态估算的策略包括：

- 固定权重；
- round-robin；
- stable-first；
- priority-order；
- 不读取请求 payload 或运行时状态的 score policy。

动态策略或请求上下文相关策略可能在没有请求上下文时返回 `N/A`。典型情况包括读取 `payload` 的 CEL、读取 `stateStore` 的 selector，以及受健康、冷却、余额、成本或负载影响的候选。

完整计算规则见 [概率与成本估算](./route-probability-cost.md)。

## 成本标注

当成本信息可解析时，运行时路由流会为 candidate 和 entry 标注理论成本。

成本来源顺序：

```text
manual upstream model cost
  -> upstream platform catalog price
  -> upstream default price
```

参考倍率只在参考价格数据库命中模型时计算。上游默认价格不作为参考价格使用。

## 模型测试请求上下文

模型广场通常展示默认编译结构。模型测试在真实请求后可以补充请求级证据：

- 匹配到的 entry；
- 实际选中的 candidate；
- 实际选中的 upstream endpoint；
- API endpoint variant attempt；
- latency、error 和 response summary；
- request trace。

如果请求包含特殊 payload、metadata、forced target 或 endpoint preference，页面应标记该结果属于当前请求上下文。

## 诊断

诊断信息应挂载到最接近的流程对象上。

| 分类 | 示例 |
|------|------|
| Compile diagnostics | missing port、duplicate public model、unsupported macro resolver |
| Candidate diagnostics | disabled、excluded、unresolved endpoint |
| Cost diagnostics | missing upstream price、missing wallet valuation |
| Capability diagnostics | unsupported API endpoint、incompatible protocol policy |

运行时路由流应保留 source reference，便于定位到图编辑器中的 entry、macro、endpoint 或 generated primitive。
