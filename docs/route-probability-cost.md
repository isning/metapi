# 概率与成本估算

Graph Routing 使用统一的 selector runtime 计算候选概率和理论成本。模型广场、模型测试、路由详情和仪表盘摘要都应使用同一套计算结果。

## 价格概念

Metapi 区分几类价格和成本。

| 概念 | 定义 | 用途 |
|------|------|------|
| 参考价格 | 参考价格数据库中的基线价格 | 参考倍率 |
| 上游成本 | 调用上游模型的预估成本 | 理论路由成本、成本加权选择 |
| 钱包成本 | 钱包单位、credit、点数或免费额度折算后的基准成本 | 仪表盘估值、实际成本估算 |
| 实际扣费 | 从日志、上游计费字段或余额变化观测到的扣费 | 审计、价格漂移检查 |
| 下游价格 | 向下游用户收取的价格 | 下游计费，不属于上游成本目录 |

这些概念不能互相替代。参考价格缺失时，不应使用上游默认成本补齐参考倍率。

## 入口理论成本

一个 public entry 可以选择多个候选。入口理论成本等于候选成本按候选概率加权后的结果。

```text
entry cost = sum(candidate probability * candidate cost)
```

候选概率来自编译后的 selector。候选成本按以下顺序解析：

```text
manual upstream model cost
  -> upstream platform catalog price
  -> upstream default price
```

如果某个候选无法解析成本，估算结果应标记为 incomplete，而不是把未知成本当作 0。

## 参考倍率

参考倍率用于比较入口理论成本和参考价格。

```text
reference multiplier = theoretical entry cost / reference price
```

计算规则：

- 仅在参考价格数据库命中模型时计算；
- 不使用平台目录价格作为参考价格；
- 不使用上游默认价格作为参考价格；
- 未命中参考价格时显示参考缺失。

## 概率类型

概率估算分为三类。

| 类型 | 展示方式 | 示例 |
|------|----------|------|
| Static | 明确百分比 | fixed weighted、round-robin、priority-order |
| Dynamic | 带运行时状态依赖的估算 | health、cooldown、balance、cost、load |
| Request-scoped | 没有请求上下文时显示 `N/A` | 读取 request payload 或 metadata 的 CEL |

只有在不依赖运行时状态和请求数据时，才应展示固定静态百分比。

## 成本加权

路由选择可以把成本作为一个因素。成本加权使用上游成本，不使用参考价格。

计算链路：

```text
supply endpoint
  -> manual cost / platform catalog price / default price
  -> wallet valuation and currency conversion when applicable
  -> selector score combined with health, load, balance, and usage signals
```

未知成本应明确标记为 incomplete，不应静默变成 0。

## 实际成本

实际成本来自请求时证据：

- proxy logs；
- upstream billing fields；
- balance deltas；
- request-time pricing snapshots；
- wallet valuation 和 conversion rates。

历史日志应保留请求发生时的成本输入。用当前汇率或当前折扣重算历史日志会改变历史结果，应避免作为审计依据。

## 仪表盘估值

仪表盘图表应按归一化价值聚合钱包余额和用量。不同站点使用不同单位时，原始余额不能直接相加。

估值链路：

```text
wallet unit
  -> wallet unit cost
  -> acquisition discount
  -> unit/currency conversion
  -> base cost unit
```

当估值覆盖不完整时，仪表盘应展示覆盖率或缺失项，而不是聚合不可比较的原始单位。

## 不完整估算

当必要输入不完整时，估算结果应标记为 incomplete：

- 没有 candidate endpoint；
- candidate probability 依赖请求上下文；
- candidate cost 无法解析；
- wallet valuation 或 conversion 缺失；
- 只有部分 candidate 有实际扣费样本。

用户界面应展示缺失输入，不应把不完整估算呈现为确定值。
