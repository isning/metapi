# 图编辑指南

图编辑视图是 Graph Routing 的高级 source-graph 编辑和诊断界面。它展示语义图与生成视图，不是 compiled runtime plan 的手工编辑器。

## 默认视图

默认画布展示语义对象：

- public entry；
- `candidate_selector` macro；
- filter；
- route product；
- synthetic endpoint；
- 可展开的 supply endpoint。

supply 默认折叠，避免候选较多时遮蔽拓扑。展开只影响编辑器呈现，不改变 source graph 或 runtime 行为。

## 所有权和只读对象

| ownership | 含义 | 编辑方式 |
|-----------|------|----------|
| `manual` | 直接由 source graph 拥有 | 可在图编辑器中修改 |
| `system` | 由管理投影拥有的语义对象 | 回到路由组管理界面修改 |
| `derived` | macro lowering 生成的 primitive | 只读，用于诊断 |

这是一条通用 source-graph 规则，不对应自动或手动路由组的不同 graph 形状。管理来源只决定管理 UI 的权限和发现生命周期；投影后的 endpoint、macro、fallback stage 和 compiled runtime 结构相同。

修改 management-projected candidate 时，使用路由组的候选和 fallback-stage 操作：启用/禁用、删除、移动到 stage、调整 stage 内顺序或变更 stage policy。不要直接修改 generated edge，也不要用 priority 伪造 fallback。

## 手动创建对象

| 对象 | 适用场景 |
|------|----------|
| `entry` | 新建裸下游模型入口 |
| `filter` | 多条 graph path 共享请求变换 |
| `dispatcher` | primitive 级调试或特殊 flow |
| `route_endpoint` `supply` | 手动定义 inline 上游端点 |
| `synthetic_endpoint` | 返回固定错误或 fallback 响应 |
| `candidate_selector` | 新建带 stage 的语义 selector |

对日常模型与凭证管理，优先使用路由组操作界面；图编辑适合组合、调试和高级 source graph。

## Focus 与草稿事务

图编辑器不加载整张图。它围绕当前 focus 显示一个局部窗口；跨窗口连接显示为
portal，点击 portal 可打开相邻 focus 或一个较大的集合窗口。portal 只是视图边界，
不是 graph node，也不会改变运行时。

一个 focus 内的编辑使用单一的本地 operation overlay：

1. 新 node 先向服务端预留 durable ID，但不会立即写入 source graph。
2. 新 edge 按当前 overlay 在服务端校验并分配 durable ID，也不会立即持久化。
3. 属性修改、删除、移动和连接都先进入本地 operations。
4. **保存草稿**会原子写入这些 operations，并保留为未发布 Source Graph draft。
5. **发布**才会编译并激活新的 runtime artifact。

因此可以先创建 node、再创建连接、最后一次保存；不需要为了通过中间校验而先保存
一个未连接的 node。若 graph revision 发生变化，服务端返回 stale revision，编辑器必须
重新加载后再继续。

## Port 类型

| Port kind | 用途 | 常见 edge kind |
|-----------|------|----------------|
| `request` | 单向请求变换 | `request_flow` |
| `bidirect` | 请求和响应均可能经过的流程 | `bidirect_flow` |
| `route` | route product 与候选连接 | `route_flow` |

连接规则：

- source port 必须是 `output`；
- target port 必须是 `input`；
- 两端的 `kind` 必须一致；
- 非 `multiple` input 只能有一条入边；
- dispatcher 的可用 port 取决于 `mode`。
- 两端 port 的 `manualEdgePolicy` 都必须为 `allow`；`deny` port 仍会显示
  既有拓扑，但不能附着新的手工 edge。

元素所有权和端口人工边策略是独立概念。自动生成的 endpoint 或 macro
可以保持配置、删除和移动只读，同时让其特定 port 允许连接其他图元素。

## 常见连接

### Entry 到 Filter 到 Macro

```text
entry.bidirect.out
  -> filter.bidirect.in
filter.bidirect.out
  -> macro.bidirect.in
```

### Endpoint 到 Macro Stage

```text
route_endpoint.route.out
  -> macro.candidates.in
```

stage 的成员与 fallback 顺序仍以 macro config 为准；连接边用于表达拓扑和定位。

### Synthetic Fallback

```text
synthetic_endpoint.route.out
  -> macro.candidates.in
```

也可以直接在一个 fallback stage 中使用 `input.kind = "synthetic"`。

## Fallback Stage 编辑

`candidate_selector.config.groups` 是宏的编辑期输入；发布后会降级为显式的
`dispatcher.fallback.out` 链：

```text
Primary
  -> stage-local weighted or CEL policy
Backup
  -> stage-local stable-first policy
Unavailable
  -> synthetic response
```

拖动 stage 改变 fallback 顺序；拖动成员改变 stage 或其 stage-local order。权重只在当前 stage 内起作用。不要在 JSON 或 UI 中写 `priority`、`priority_order` 或旧 policy `strategy`。

## 展开生成视图

Inspector 和右键菜单可展开 macro 的 generated primitive：

- external entry primitive；
- filter primitive；
- 第一个 dispatcher 和后续 fallback dispatcher；
- 每个 fallback stage 的 dispatcher；
- materialized endpoint 或 synthetic terminal；
- derived edges。

这些对象是 source graph 的可解释投影，不是独立可编辑的第二套路由模型。

## Compiled Runtime 视图

Compiled runtime 视图展示真实执行结构：plan、fallback stage、execution alternative、endpoint、execution attempt 和 API attempt。它适合：

- 对照模型广场和模型测试；
- 检查 policy 与 fallback；
- 查看 source reference；
- 排查 validation 和 compile diagnostics。

它不适合直接编辑。应回到 source graph 或路由组操作面完成修改，再重新编译和发布。

## 常见错误

### Edge missing port

连接引用了不存在的 `sourcePortId` 或 `targetPortId`。

### Edge incompatible ports

两侧 port kind 不一致，例如把 `bidirect` 输出连接到 `route` 输入。

### Duplicate input

目标 input 不支持 `multiple`，却接入了多条边。

### Duplicate public model

多个 public entry 或 external macro surface 声明了同一个归一化模型名。发布前需要先解决公开模型冲突。

### Native policy validation

source graph 仍包含 `{ "strategy": ... }`、`routingStrategy`、`priority_order` 或 candidate/stage priority。将选择规则改为 native dispatcher policy，并用 stage 数组顺序表达 fallback。
