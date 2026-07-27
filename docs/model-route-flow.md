# 运行时路由流

模型广场、模型测试和日志详情展示的是已发布 source graph 编译出的 runtime projection，不是图编辑器画布的直接渲染，也不是 route-group 管理表的读取结果。

## 数据来源

```text
downstream request
  -> matcher
  -> matched compiled plan
  -> pre-selection filter stages (graph order)
  -> ordered fallback stages
  -> stage-local dispatcher decision
  -> execution alternative
  -> endpoint
  -> execution attempt
  -> post-build filters
  -> API attempt
```

每个层次都有不同职责：

| 层次 | 含义 |
|------|------|
| Matcher | 将请求模型匹配到一个 compiled plan |
| Compiled plan | 该 public model 的静态执行结构 |
| Filter | 请求模型、payload、header 和 API preference 的变换；`pre_selection` 在 dispatcher 选择前按图顺序执行，`post_build` 在 target/request 构建后收集并应用 |
| Fallback stage | 明确的主备顺序；由数组顺序决定 |
| Dispatcher decision | 在当前 stage 的可选项中按 policy 选择 |
| Execution alternative | 一个可继续执行或产生 synthetic response 的完整路径 |
| Endpoint | alternative 归属的 supply 或 route product |
| Execution attempt | 实际 endpoint target、账号和凭证的调用单元 |
| API attempt | 对上游 API variant 的一次协议尝试 |

`candidate` 只是在 dispatcher 内部指一个局部 option，不是全局 runtime DTO。面向用户的流和日志使用 execution alternative、endpoint、execution attempt 和 API attempt。

## Fallback 语义

compiled runtime 从最低序号的 fallback stage 开始。当前 stage 没有 eligible execution alternative 时，或者重试失败覆盖层已排除其所有 alternative 时，才评估下一个 stage。

```text
Primary stage
  -> eligible alternative selected and executed
  -> failure overlay exhausts primary alternatives
Backup stage
  -> selected and executed
Synthetic unavailable stage
  -> returns configured response
```

stage 内使用 native dispatcher policy。权重、round robin、CEL contribution 和 ordered CEL 仅影响当前 stage；不存在跨 stage 的 numeric priority。

## 状态和观测

| 状态 | 含义 |
|------|------|
| `selected` | 当前请求或模拟中被选中的 alternative/attempt |
| `available` | 当前可参与选择 |
| `disabled` | 被配置禁用 |
| `avoided` | 被失败、冷却或运行时策略暂时排除 |
| `degraded` | 仍可执行，但健康或 capability 不完整 |
| `unavailable` | 没有可执行 attempt |

入口成功率描述一次下游调用在 fallback 后的最终结果。Endpoint 和 execution attempt 的成功率则记录各自的尝试结果；它们不应混作入口成功率。

运行历史按最终结果和 execution attempt 两个粒度呈现。最终结果适合判断用户看到的可用性；attempt 数据适合诊断具体上游、账号、凭证、协议 variant、TTFT、吞吐和错误。

## 概率

概率来自 compiled plan 中实际生效的 dispatcher policy。一个 stage 内的静态加权 policy 可以给出成员概率；整个 plan 的概率还取决于前序 stage 是否耗尽。读取请求、健康、冷却、余额、成本、负载或轮询状态的 policy 没有通用固定概率。

模型广场可以展示无请求上下文下的静态结论；模型测试和日志详情应优先展示带当前请求和运行时状态的实际决策。完整规则见[概率与成本估算](./route-probability-cost.md)。

## 成本标注

当 execution attempt 的统一报价可用时，runtime projection 会提供原始报价、归一化有效成本和请求形状下的估计成本。选择 policy 读取的是明确注入的 runtime routing signals；raw price 仍可作为 metadata 供自定义 CEL 使用，但不会被隐式当作默认选路依据。

成本不完整时，页面必须显示缺失或动态状态，而不能把未知值变为零或固定比例。

## 诊断

诊断挂在最接近的 runtime 对象上：

| 分类 | 示例 |
|------|------|
| Compile diagnostics | missing port、duplicate public model、unsupported resolver |
| Alternative diagnostics | disabled、excluded、unresolved endpoint |
| Execution-attempt diagnostics | credential、capability、cooldown、健康状态 |
| API-attempt diagnostics | adapter、协议映射、上游 HTTP 错误 |
| Pricing diagnostics | 缺少上游报价、钱包估值或计费维度 |

runtime projection 保留 source reference 供诊断定位，但 proxy 执行不依赖 route-group provenance、编辑器布局或旧 route table 标识。
