# Inbox 与活跃问题

Inbox 是 Metapi 的统一操作事件模型。通知、仪表盘活跃问题、系统日志、站点公告、价格漂移和路由诊断都应尽量使用同一套结构化事件，而不是各自维护一套页面私有数据。

## 为什么需要 Inbox

早期事件通常只有 `title`、`message`、`type` 和 `level`。这种结构无法清楚表达：

- 问题是否仍然活跃；
- 重复出现了多少次；
- 应该跳转到哪里处理；
- 有哪些结构化诊断；
- 是否已读、已确认、已暂缓或已解决；
- 同一个问题是否应该去重。

Inbox 的目标是记录可处理的问题、动作和诊断，而不是只保存一条无法定位的日志文本。

## Scope

一个 inbox item 有不同 scope：

| Scope | 用途 |
|-------|------|
| notification | 顶栏通知和轻量提醒 |
| attention | 仪表盘活跃问题，需要优先处理 |
| activity | 系统日志和审计历史 |
| announcement | 上游站点公告 |

同一事件可以按不同密度出现在不同页面中，但不应该重复造数据模型。

## Category 和 Severity

Category 表示问题域：

- routing；
- cost；
- balance；
- health；
- auth；
- settings；
- site；
- system。

Severity 表示严重程度：

- critical；
- warning；
- info；
- success。

仪表盘优先展示 open attention items，并按严重程度、时间和重复次数排序。

## 生命周期

Inbox item 的状态：

| 状态 | 含义 |
|------|------|
| open | 仍需处理 |
| read | 已读，但不代表已处理 |
| acknowledged | 已确认，知道这个问题存在 |
| snoozed | 暂时隐藏，到期后可重新出现 |
| resolved | 已解决，保留历史 |

注意：`read` 只是展示状态。对于活跃问题，读过不等于解决。

## 结构化详情

Inbox item 可以包含结构化 details：

| 类型 | 用途 |
|------|------|
| text | 普通说明 |
| kv | 键值字段 |
| metrics | 指标摘要 |
| list | 列表 |
| code | JSON、错误或诊断片段 |
| table | 多行表格 |

这让系统日志、通知弹层和仪表盘可以用不同密度渲染同一份数据。

## 操作按钮

Inbox actions 是声明式的：

| Action kind | 作用 |
|-------------|------|
| navigate | 跳转到应用内页面 |
| invoke | 调用后端动作，例如确认或解决 |
| copy | 复制诊断信息 |
| external | 打开外部链接 |

常见按钮：

- 查看路由；
- 打开成本设置；
- 查看站点；
- 复制诊断；
- 标记已确认；
- 暂缓；
- 解决。

## 去重和重复出现

活跃问题应该带稳定 `dedupeKey`。同一个问题重复发生时：

- 不刷屏创建多条相同记录；
- 更新 `lastSeenAt`；
- 增加 `occurrenceCount`；
- 保留首次出现时间；
- 问题解决后可进入 resolved 状态。

适合去重的问题：

- 某个路由组编译失败；
- 某个上游价格持续漂移；
- 某个站点余额过低；
- 某个账号授权过期；
- 某个 endpoint 长期不可用。

## 仪表盘活跃问题

仪表盘读取 `scope=attention` 且状态为 open 的项目。它应该只展示真正需要处理的问题，不应该硬凑普通信息卡。

适合出现在活跃问题里的内容：

- 路由编译失败；
- 没有可用候选端点；
- 价格漂移；
- 余额不足或估值缺失；
- OAuth 授权过期；
- 批量测活大量失败；
- 数据库或后台任务异常。

不适合出现在活跃问题里的内容：

- 普通刷新成功；
- 用户打开页面；
- 没有行动价值的说明文本；
- 可以在系统日志里查看的普通历史。

## 通知弹层

顶栏通知更适合展示 compact 版本：

- 标题；
- 一行摘要；
- 时间；
- 状态；
- 一个主操作。

通知可以自动标记为已读，但不能自动解决 attention。

## 系统日志

系统日志是历史视图。它可以显示所有 scope，并展开 details、actions 和 subject。

使用场景：

- 查某个事件发生过几次；
- 看任务历史；
- 查看结构化错误详情；
- 追踪设置变更或系统活动。

系统日志不是主要的故障处理入口。需要处理的问题应在仪表盘活跃问题或对应业务页面中暴露。

## 生产者规则

新功能产生用户可见事件时，应优先写 Inbox item：

```text
emitInboxItem(...)
raiseAttention(...)
resolveAttention(...)
```

建议：

- attention 必须有稳定 dedupeKey；
- attention 至少要有一个明确 subject 或 action；
- 错误详情放 details，不要拼成长 message；
- 需要跳转的页面用 navigate action；
- 可自动恢复的问题要在恢复时 resolve；
- 不要让页面自己临时拼 dashboard-only 结构。

## 和价格漂移、路由诊断的关系

价格漂移检查、路由编译失败、候选端点不可用都应该产生 Inbox attention，而不是只在某个页面显示一次 toast。

这样用户可以从：

- 仪表盘看到需要处理的问题；
- 通知弹层看到提醒；
- 系统日志查看历史；
- 业务页面跳转到具体配置位置。
