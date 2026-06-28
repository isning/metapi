# 图编辑指南

图编辑视图是 Graph Routing 的高级编辑和调试界面。它展示语义图，不是低层运行时计划编辑器。

## 默认视图

默认画布只展示语义对象：

- public entry；
- candidate selector macro；
- 手动 filter；
- route product；
- synthetic endpoint；
- 用户创建的 route endpoint。

自动 supply 默认折叠。折叠状态下，macro 的 `candidates.in` 附近会显示候选提示；需要检查时再展开 supply。

## 只读对象

自动生成的数据只读：

- 自动 macro；
- 自动 supply endpoint；
- 自动 candidate edge；
- derived dispatcher；
- generated primitive node/edge。

原因是自动数据会随模型发现和重建刷新。如果允许用户直接删边或改自动节点，下一次重建会覆盖用户操作。

要修改自动候选，应在路由组列表或 inspector 中写 override，例如禁用、排除、改权重、改优先级。

## 可以手动创建的对象

| 对象 | 什么时候创建 |
|------|--------------|
| `entry` | 需要一个裸下游模型入口 |
| `filter` | 多个路由共享同一段请求改写 |
| `dispatcher` | 需要 primitive 级高级调试或特殊 flow |
| `route_endpoint` `supply` | 手动定义一个 inline 上游端点 |
| `route_endpoint` `route_product` | 手动创建可复用 route product |
| `synthetic_endpoint` | 返回固定错误或 fallback 响应 |
| `candidate_selector macro` | 推荐通过路由组视图创建 |

日常创建路由组时，优先用路由组视图。图编辑中创建裸节点适合高级场景。

## Port 类型

Graph Routing 使用 typed ports。只有兼容的 port 才能连接。

| Port kind | 用途 | 常见 edge kind |
|-----------|------|----------------|
| `request` | 单向请求改写 | `request_flow` |
| `bidirect` | 请求和响应都可能经过的流程 | `bidirect_flow` |
| `route` | 路由候选和 route product | `route_flow` |

连接规则：

- source port 必须是 `output`；
- target port 必须是 `input`；
- source port 和 target port 的 kind 必须相同；
- 非 multiple input 只能有一条入边；
- dispatcher 在不同 mode 下会禁用部分 port。

## 常见节点连接

### Entry 到 Filter 到 Macro

```text
entry.bidirect.out
  -> filter.bidirect.in
filter.bidirect.out
  -> macro.bidirect.in
```

### Supply 到 Macro Candidates

```text
route_endpoint.route.out
  -> macro.candidates.in
```

### Macro 到 Route Product

macro 会生成或关联 route product。通常不需要手动连这条边。

### Synthetic fallback

```text
synthetic_endpoint.route.out
  -> macro.candidates.in
```

也可以在 macro group 中用 `input.kind = "synthetic"` 直接声明。

## 展开生成视图

Inspector 和右键菜单可以展开 macro 的生成视图。

展开后你会看到：

- entry primitive；
- filter primitive；
- dispatcher；
- route endpoint candidates；
- synthetic endpoint；
- derived edges。

展开只是调试视图。自动 primitive 仍然只读。

## Show compiled graph

Show compiled graph 是全量调试视图。它更接近运行时计划，但不适合作日常编辑。

适合：

- 检查编译结果；
- 对照模型广场路由解释；
- 查 sourceRef；
- 排查 graph validation diagnostics。

不适合：

- 调整普通路由组；
- 批量管理候选；
- 修改自动边。

## Inspector

Inspector 应优先展示当前选中对象的实用信息：

- 类型、ownership、enabled；
- ports；
- 入边/出边；
- candidates；
- filter operations；
- generated preview；
- compile diagnostics；
- 定位按钮。

定位按钮应使用 sourceRef 或 node id 定位语义节点。如果选择的是 generated primitive，应优先定位到它的 source macro，再允许展开查看 primitive。

## 常见错误

### Edge missing port

连接到不存在的 port。检查 `sourcePortId` 和 `targetPortId` 是否拼错。

### Edge incompatible ports

source kind 和 target kind 不一致。例如把 `bidirect` 输出连到 `route` 输入。

### Duplicate input

目标 input port 不支持 multiple，但接入了多条边。

### Entry internal unsupported

`entry` 只能用于下游 public ingress。内部复用请用 `route_endpoint endpointKind=route_product`。
