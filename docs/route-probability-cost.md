# 概率与成本估算

Graph Routing 从 compiled runtime 计算选择概率和理论成本。模型广场、模型测试、路由详情和仪表盘必须消费同一份 runtime projection，而不是重新从 route group、候选表或编辑器结构推导。

## 价格概念

| 概念 | 定义 | 用途 |
|------|------|------|
| 原始上游报价 | provider/catalog 或手动配置给出的计费规则 | 展示、审计、自定义 CEL metadata |
| 有效成本 | 按钱包取得成本、折扣、免费额度和货币归一化后的成本 | 默认 routing signal、理论成本 |
| 参考价格 | 参考价格目录中的基线价格 | 参考倍率，不参与默认选路 |
| 实际扣费 | 日志、上游账单字段或余额变化观测到的成本 | 审计和价格漂移检查 |
| 下游价格 | 对下游用户收取的价格 | 下游计费，不属于上游成本目录 |

原始报价和有效成本必须同时保留，但不能互相替代。默认选路使用统一报价 API 计算出的 effective cost score；raw cost 仅通过 metadata 暴露给显式自定义 CEL。

## 请求形状与高级计费

报价按完整计费维度计算，包括输入、输出、缓存读取、缓存写入、图像、音频或 provider 定义的 tiered expression。缓存读取量和缓存写入量来自实际 usage 或请求/上游能力中可证实的数据；缺少该计费概念时应为 `null`，不是伪造为与普通输入相同的价格。

没有实际输出量时，runtime 使用该 route 的历史 usage forecast 估计 expected 与尾部输出量，并为成本结果附带样本量和置信度。请求指定 `max_tokens` 时可作为上界，不应被误认为实际输出量。

## 条件概率

概率是对 compiled plan 在给定输入和运行时状态下的条件结论。

```text
P(execution attempt)
  = P(reach fallback stage)
  * P(select alternative in that stage)
  * P(select target inside the alternative)
```

stage 顺序不是权重。只有前序 stage 没有 eligible alternative 时，才会到达后序 stage。因此不能把所有 endpoint 的 weight 直接放在一个分母中计算全局概率。

| 情况 | 概率表现 |
|------|----------|
| 固定 weighted、round-robin、stable-first，且没有动态输入 | 可给出静态概率 |
| CEL 只读取静态 metadata | 可以静态计算，前提是 policy 可解析 |
| CEL 读取 request/payload/headers | 没有请求时为动态；给定请求后可计算 |
| CEL 读取 runtime 健康、成本、余额、负载或 `stateStore` | 随运行时变化，显示动态 |
| endpoint capability 或 retry overlay 决定 eligibility | 随请求和运行时变化，显示动态 |

动态或不完整不等于零概率。UI 应说明缺少的输入，或展示当前请求的实际 decision。

## 理论入口成本

入口的理论成本基于请求形状与 compiled runtime 中可达的 execution attempt。对于能够得到条件概率和成本的路径：

```text
entry theoretical cost = sum(path probability * path effective cost)
```

当 policy、fallback reachability 或价格缺失使结果无法唯一确定时，估算必须带 `dynamic` 或 `incomplete` 状态。未知成本不能作为 `0` 参与加权。

## 成本信号

默认 policy 的成本输入是统一报价 API 的 effective cost score。该 score 与归一化余额、近期使用量等同属 `runtime.routingSignals`，由 compiled runtime 在请求前注入。

```text
execution attempt
  -> unified pricing quote
  -> effective cost and request-shape forecast
  -> normalized routing signal
  -> dispatcher CEL evaluation
```

这条链路不读取 route group。所有模型页面应从 compiled runtime projection 读取已经解析的信号和报价展示数据。

## 参考倍率

```text
reference multiplier = theoretical effective entry cost / reference price
```

只有参考价格目录命中时才计算。上游默认报价、钱包估值和参考价格分别有不同含义，不能互相补齐。

## 实际成本与历史

实际成本来自请求时证据：proxy log、上游 billing fields、usage、余额变化和当时的报价快照。历史审计应保留请求发生时的计费输入；用当前汇率、折扣或 catalog 重算历史记录会改变其含义。

## 仪表盘估值

不同站点的原始钱包单位不能直接相加。仪表盘聚合归一化价值，同时保留带单位的原始余额明细。

```text
wallet unit
  -> wallet acquisition cost
  -> discount / free-quota treatment
  -> currency and unit conversion
  -> base cost unit
```

覆盖不完整时，UI 应展示覆盖范围或缺失项，不应将不可比较余额混成一个确定数字。
