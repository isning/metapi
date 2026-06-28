# 路由组使用指南

路由组是 Graph Routing 的日常编辑对象。你通常不需要手写 graph JSON；在路由组视图里调整策略、候选端点和过滤器即可。

## 路由组是什么

一个路由组本质上是：

```text
candidate_selector macro
  + route_endpoint endpointKind=route_product
  + candidate route_endpoint[]
```

自动路由组由上游模型发现生成。手动路由组由用户创建。两者最终都会映射为语义图对象。

## 自动路由组

自动发现模型后，系统会按 canonical upstream model 生成自动路由组。

例如多个站点都提供 `gpt-5.5`：

```text
site A / account 1 / gpt-5.5 -> supply endpoint A
site B / account 2 / gpt-5.5 -> supply endpoint B
site C / token X   / gpt-5.5 -> supply endpoint C
```

系统生成：

```text
auto-model:gpt-5.5
  candidates:
    supply endpoint A
    supply endpoint B
    supply endpoint C
```

自动组默认 public。你可以改成 internal，让它不直接暴露给下游，只供手动组引用。

## 手动路由组

手动组适合表达运营意图：

- 把多个不同模型名的 supply 聚合成一个下游模型；
- 把多个 internal 自动组重新暴露成一个 public 模型；
- 给候选设置主备优先级；
- 加入 synthetic fallback；
- 对某个路由组设置专用 filter；
- 用 CEL 做请求相关选择。

手动组可以选择三类候选：

| 候选 | 说明 |
|------|------|
| `route_endpoint endpointKind=supply` | 具体上游模型端点 |
| `route_endpoint endpointKind=route_product` | 另一个路由组产物 |
| `synthetic_endpoint` 或 macro synthetic group | 合成 fallback |

允许把 route product 和 supply 混合使用，但要注意重复路径：如果一个 route product 已经包含某个 supply，再直接加入同一个 supply，会形成两条候选路径。

## Public 和 Internal

| 状态 | 下游能否直接请求 | 是否可被手动组引用 |
|------|------------------|--------------------|
| Public | 可以 | 可以 |
| Internal | 不可以 | 可以 |

推荐做法：

- 自动发现的常规模型保持 public；
- 只作为中间层使用的自动组改为 internal；
- 用户面向下游提供的组合模型用手动 public 组表达。

## 优先级桶

优先级桶用于主备或分层 fallback。

示例：

```text
priority 100: 付费高质量端点
priority 50:  普通端点
priority 0:   synthetic 503 fallback
```

`priority_order` 会先使用最高优先级桶。只有高优先级桶不可用时，才进入下一层。

`weighted` 会按候选权重选择。优先级仍会参与编译和解释，但核心行为是按权重。

## 权重

权重决定同一层候选的选择比例。

例子：

```text
A weight 70
B weight 30
```

静态情况下，A 约 70%，B 约 30%。如果启用了健康、成本、余额、使用率等动态因子，显示的概率可能是动态估算。

## 启用、禁用、排除

| 操作 | 语义 |
|------|------|
| 禁用路由组 | 整个 macro 不参与匹配 |
| 禁用候选 | 候选保留但不参与选择 |
| 排除候选 | 对自动生成候选写 override，把它从当前组中排除 |
| 删除手动候选 | 从手动组配置里移除引用 |

自动候选边是生成数据，不应该直接在画布上删除。要在候选表或 inspector 中修改。

## 给路由组添加 Filter

路由组 filter 用于当前组内的请求改写。常见场景：

- 改写模型名；
- 给 payload 添加默认字段；
- 删除某个上游不支持的字段；
- 设置 header；
- 指定 endpoint preference。

如果 filter 只属于一个路由组，放在路由组里。只有多个路由共享同一段改写逻辑时，才考虑在图编辑视图中创建独立 `filter` 节点。

Filter 详细参数见 [Filter 参考](./route-graph-filters-reference.md)。

## 常见配置

### 主备

```text
policy: priority_order
priority 100: primary supply
priority 50: backup supply
priority 0: synthetic 503
```

### 灰度分流

```text
policy: weighted
priority 0:
  supply A weight 90
  supply B weight 10
```

### 内部自动组重映射

```text
internal auto group: claude-sonnet-4-6
internal auto group: claude-opus-4-6

manual public group: claude-premium
  candidates:
    claude-sonnet-4-6 route_product
    claude-opus-4-6 route_product
```

### 为某个组强制 Responses

添加 filter：

```json
{
  "type": "set_endpoint_preference",
  "endpoint": "responses"
}
```

## 图编辑视图适用场景

路由组视图适合维护公开状态、候选端点、权重、优先级桶和组内 filter。图编辑视图用于处理路由组之间的连接关系、共享节点和编译诊断。

适合切换到图编辑视图的场景：

- 检查 macro、supply endpoint、route product 和 filter 之间的实际连接；
- 组合多个 macro 或 route product，形成跨路由组的复用流程；
- 创建可被多个路由组共享的独立 `filter` 或 `synthetic_endpoint`；
- 查看 generated primitives，确认 macro lower 后的 entry、dispatcher 和 candidate 边；
- 调试编译诊断或 compiled graph。
