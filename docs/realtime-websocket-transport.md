# WebSocket Transport

Metapi 的路由图选择上游模型供应，也就是 supply endpoint。WebSocket 不参与路由图建模，它是选中 supply endpoint 之后，由 endpoint profile 派生出的传输方式。

这页说明 WebSocket 在 Metapi 中应该怎么配置、运行时怎么选择，以及它和 HTTP endpoint profile、credential binding、Graph Routing 的关系。

## 模型边界

```text
Route graph
  -> supply endpoint
      -> credential endpoint binding
          -> API endpoint profile
              -> HTTP request URL
              -> optional WebSocket transport profile
```

| 概念 | 作用 |
|------|------|
| Supply endpoint | 路由图可见的上游模型候选 |
| API endpoint profile | HTTP 可执行入口，保存完整请求地址 |
| WebSocket transport profile | 某个 endpoint profile 的可选实时传输配置 |
| Credential transport binding | 某个账号或 API Key 对 WebSocket transport 的支持状态 |

WebSocket transport profile 不会显示为 graph 节点，也不会被 macro 直接选择。这样可以保持路由图只表达“请求应该去哪个上游模型供应”，而不是把协议传输细节混到图里。

## 请求 URL

HTTP endpoint profile 保存完整请求 URL，例如：

```text
https://chatgpt.com/backend-api/codex/responses
```

WebSocket transport profile 有两种 URL 模式。

### 从 endpoint profile 派生

适用于 WebSocket 路径和 HTTP 路径相同，只需要替换 scheme 的上游：

```text
https://chatgpt.com/backend-api/codex/responses
  -> wss://chatgpt.com/backend-api/codex/responses
```

```text
http://localhost:3000/v1/responses
  -> ws://localhost:3000/v1/responses
```

派生模式只改 `http/https` 到 `ws/wss`，不改 path，不自动拼接 `/responses`。

### 自定义 WebSocket URL

如果上游使用独立 WebSocket 路径，直接保存完整 WebSocket URL：

```text
wss://api.example.com/realtime/responses
```

运行时应该使用保存的 URL，不再从站点 base URL 或 endpoint 名称重新拼接。

## 运行时选择流程

下游客户端通过 `GET /v1/responses` 建立 WebSocket 后，Metapi 的流程是：

1. 校验下游 key。
2. 将 WebSocket frame 归一化为 Responses 请求。
3. 通过 Graph Routing 选中 supply endpoint。
4. 为选中的 supply endpoint 解析 API endpoint profile。
5. 解析 WebSocket transport profile 和 credential transport binding。
6. 如果 WebSocket 可用，用 WebSocket runtime 执行。
7. 如果 WebSocket 不可用或命中配置的 fallback status，用同一个已选 supply endpoint 执行 HTTP fallback。

HTTP fallback 不应该重新选路。只有 route retry policy 明确要求切换 supply endpoint 时，才允许从候选集合里重新选择。

## 支持状态

Credential transport binding 表示某个凭证对某个 WebSocket transport 的支持状态。

| 状态 | 含义 |
|------|------|
| supported | 可用于 WebSocket 请求 |
| unknown | 未确认，通常不进入生产 WebSocket 执行 |
| unsupported | 已知不支持 WebSocket，但 HTTP 仍可用 |
| blocked | 被策略或人工阻止 |

如果没有手动 binding，运行时使用 provider default、账号 metadata 和全局设置计算有效状态。

Codex OAuth 的现有 `websockets: false` metadata 表示默认不使用 WebSocket。用户确认某个 credential 实际支持后，可以用手动 binding 覆盖。

## Session 与 Fallback

WebSocket transport profile 应保存 session policy：

| 字段 | 说明 |
|------|------|
| reuse | 按 conversation 复用、按 request 新建，或禁用复用 |
| closeOnTerminalError | 终态错误后是否关闭上游 socket |
| idleTtlMs | 空闲连接保留时间 |

Fallback policy 控制哪些 WebSocket 失败可以退回 HTTP：

```json
{
  "httpFallback": true,
  "fallbackStatuses": [401, 403, 404, 409, 426, 429, 500, 502, 503, 504]
}
```

Fallback 使用同一个 endpoint profile 的 HTTP request URL。它不应该把 WebSocket upgrade 失败误记录成 HTTP endpoint 不可用。

## 观测与排查

Trace 里应显示三层信息：

```text
selected supply endpoint
  -> selected API endpoint profile
      -> selected transport
```

需要记录的信息：

- endpoint profile id；
- transport 类型：HTTP 或 WebSocket；
- transport profile id；
- WebSocket URL 标签，不包含密钥；
- session 是否复用；
- fallback 原因；
- fallback 后的最终 transport；
- 上游终态 frame 或 upgrade status。

健康分类使用和 HTTP endpoint attempt 相同的失败词汇，但写入 transport observation。WebSocket-only 失败不应该直接降低 HTTP endpoint profile 的可用性。

## UI 组织

推荐把 WebSocket 配置放在 endpoint profile 详情里的 `Transports` 区域：

- HTTP 作为基础 transport，只显示 endpoint profile 的 request URL；
- WebSocket 作为可选 transport；
- 支持派生 URL / 自定义 URL；
- 支持 handshake headers；
- 支持 session policy；
- 支持 HTTP fallback policy。

账号或 API Key 详情中展示 credential endpoint binding 时，可以在展开详情里显示 transport 支持状态。默认表格保持紧凑，不把 WebSocket 作为独立 endpoint 展示。

模型广场、模型测试和 trace 中，WebSocket 只作为执行结果的一部分展示，不作为图节点展示。

## 和 Graph Routing 的关系

Graph Routing 中仍然只有：

```text
supply endpoint -> candidate selector macro
```

不要添加：

- WebSocket 节点；
- WebSocket port；
- WebSocket edge；
- WebSocket macro。

路由组决定候选上游模型；endpoint profile 和 transport profile 决定选中之后如何调用。

## 相关文档

- [上游 Endpoint、模型目录与兼容性](./upstream-endpoint-compatibility.md)
- [Graph Routing](./graph-routing.md)
- [ADR-0017: Executable Endpoint Profiles And Model Catalog Sources](./adr/0017-executable-endpoint-profiles-and-model-catalogs.md)
- [ADR-0018: WebSocket Transport Profiles For Realtime Upstream Dispatch](./adr/0018-websocket-transport-profiles.md)
