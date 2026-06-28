# 上游 Endpoint、模型目录与兼容性

一个上游站点可能同时提供多种 API 入口：OpenAI Chat、OpenAI Responses、Anthropic Messages、Gemini GenerateContent，或者 New API / One API 风格的兼容转发。Metapi 把这些入口建模为 supply endpoint 下面的执行配置，而不是把每一种协议都画成 graph 节点。

核心原则：

- Graph Routing 选择稳定的上游模型供应，也就是 supply endpoint。
- Endpoint profile 描述一次请求真正要调用的完整 URL。
- WebSocket transport profile 描述 endpoint profile 的可选实时传输方式。
- Model catalog source 描述模型列表从哪里来。
- Credential binding 描述某个账号或 API Key 是否能使用某个 endpoint profile。
- Runtime observation 记录真实请求或手动测试得到的证据。

## 分层模型

```text
Site
  -> Model Catalog Source[]
  -> API Endpoint Profile[]
      -> API Transport Profile[]
  -> Credential / Account / Token
      -> Credential Endpoint Binding[]
          -> Credential Transport Binding[]
      -> Supply Endpoint
          -> API Attempt Plan
```

| 层级 | 说明 |
|------|------|
| Site | 上游站点 |
| Model Catalog Source | 模型目录来源，例如 `GET /models` 或手动维护的模型列表 |
| API Endpoint Profile | 可执行 API 入口，保存完整请求地址、API 类型、认证和默认能力 |
| API Transport Profile | endpoint profile 的可选传输配置，例如 Responses WebSocket |
| Credential Endpoint Binding | 某个账号或 API Key 是否能使用某个 endpoint profile |
| Credential Transport Binding | 某个账号或 API Key 是否能使用某个 transport profile |
| Supply Endpoint | Graph Routing 选择的稳定上游模型端点 |
| API Attempt Plan | 本次请求在选中 supply 后实际尝试的 endpoint profile 顺序 |

Graph Routing 不直接选择 Chat、Responses、Messages 这些协议细节。它只选择 supply endpoint；选中之后，运行时再根据 endpoint profile、credential binding、兼容性策略和历史观测生成调用计划。

## API Endpoint Profile

Endpoint profile 是站点级的可执行入口。它回答“如果要用这个 API 类型调用上游，请求应该发到哪里”。

主要字段：

| 字段 | 说明 |
|------|------|
| API 类型 | 例如 OpenAI Chat Completions、OpenAI Responses、Anthropic Messages |
| 请求地址 | 完整的可执行请求 URL，例如 `https://api.example.com/v1/chat/completions` |
| 认证方式 | Bearer Token、Header API Key、Query API Key 或自定义 |
| 默认请求头 | 例如 Anthropic 版本头、网关需要的额外 header |
| 默认能力 | 是否支持 tools、stream、JSON schema、reasoning、usage 等 |
| 兼容性策略 | 字段保留、消息历史适配、reasoning/thinking 处理等 |
| 模型目录来源 | 关联一个 model catalog source，用于模型发现 |

请求地址是完整 URL，不是 base URL。Metapi 在运行时应该使用保存的请求地址，而不是用站点 URL 再拼接硬编码路径。

示例：

```text
OpenAI Chat:
  https://api.example.com/v1/chat/completions

OpenAI Responses:
  https://api.example.com/v1/responses

Anthropic Messages:
  https://api.example.com/anthropic/v1/messages
```

这样设计可以避免 `/v1/v1`、`/anthropic/v1/v1` 这类路径拼接问题，也允许兼容网关按自己的实际路径配置。

## WebSocket Transport Profile

WebSocket 是 endpoint profile 的可选 transport，不是新的路由节点。它用于 Codex Responses 这类下游以 WebSocket 接入、上游也支持实时传输的场景。

WebSocket transport profile 主要包含：

| 字段 | 说明 |
|------|------|
| URL 模式 | 从 HTTP endpoint profile 派生，或使用自定义 WebSocket URL |
| 请求地址 | 自定义模式下保存完整 `ws://` 或 `wss://` URL |
| 握手 header | 只用于 WebSocket handshake 的额外 header |
| 会话策略 | 是否按 conversation 复用连接、空闲 TTL、终态错误是否关闭 |
| HTTP fallback | WebSocket upgrade 或终态失败时是否回退到 HTTP |

派生 URL 只替换 scheme：

```text
https://api.example.com/v1/responses
  -> wss://api.example.com/v1/responses
```

如果上游 WebSocket 使用不同路径，就使用自定义 URL。运行时不应该重新从站点 URL 拼接 `/responses`。

更多说明见 [WebSocket Transport](./realtime-websocket-transport.md)。

## Model Catalog Source

Model catalog source 描述模型列表从哪里来。它和请求地址是两件事。

主要字段：

| 字段 | 说明 |
|------|------|
| 发现地址 | 例如 `https://api.example.com/v1/models` 或 `https://api.example.com/models` |
| 解析器 | OpenAI models、NewAPI models、Gemini models 或自定义 JSON |
| 凭证范围 | 站点级、账号/API Key 级，或无需凭证 |
| 刷新策略 | 手动刷新、定时刷新、凭证变化后刷新 |
| 最近结果 | 最近刷新时间、模型数量、错误信息 |

多个 endpoint profile 可以共用同一个 model catalog source。比如一个站点同时支持 OpenAI Chat 和 Anthropic Messages，但模型列表来自同一个 `/models` 接口，就只需要一个目录来源。

Metapi 默认不应该对“每个 endpoint profile × 每个模型”都做探测。正常流程是先刷新模型目录，再通过真实请求和少量手动测试积累运行时观测。

## Credential Endpoint Binding

同一个站点的不同账号或 API Key 可能支持不同 API 入口。Credential endpoint binding 描述“这个凭证能不能使用这个 endpoint profile”。

常见状态：

| 状态 | 含义 |
|------|------|
| supported | 可用于生产请求 |
| unknown | 未验证，需要测试或人工确认 |
| unsupported | 已知不支持 |
| blocked | 被策略或人工阻止 |

只有启用且 `supported` 的 binding 会进入正常 API attempt plan。`unknown` 可以显示为需要验证，但不应该静默加入生产请求。

适合放在 binding 上的配置：

- 某个 API Key 对 endpoint profile 的启用状态；
- 优先级；
- key 级兼容性覆盖；
- key 级成本覆盖；
- 最近一次手动测试结果；
- 最近运行时观测。

## Supply Endpoint

Supply endpoint 是 Graph Routing 可见的稳定候选。它代表一个具体上游模型供应，例如：

```text
站点 A + 账号 1 + API Key X + upstream model deepseek-v4-pro
```

Supply endpoint 的稳定性很重要：

- 自动路由组引用它；
- 手动路由组可以搜索并选择它；
- 运行时健康、冷却、成功率和成本观测记录在它身上；
- 模型广场和模型测试可以解释“为什么选中了这个上游模型”。

同一个 supply endpoint 下面可以有多个 endpoint profile 尝试方式，但 graph 不因此复制多个 supply 节点。

## Runtime Observation

Runtime observation 是真实请求或手动测试留下的证据。

示例：

```text
模型 deepseek-v4-pro
  通过 DeepSeek / OpenAI Chat endpoint 请求成功

模型 deepseek-v4-pro
  通过 DeepSeek / Anthropic Messages endpoint 被协议拒绝
```

这些证据可以在一段时间内影响 attempt plan，例如优先选择已确认可用的 endpoint profile，或暂时跳过明确被协议拒绝的组合。它不会直接创建、删除或修改 graph 节点。

## Fallback 边界

Fallback 分成不同层级：

| 层级 | 作用范围 |
|------|----------|
| API variant fallback | 在同一个 supply endpoint 内切换 endpoint profile |
| Supply fallback | 在当前 route candidate 集合内选择另一个 supply endpoint |
| Terminal fallback | 没有可用候选时返回错误或合成响应 |

典型流程：

```text
选中 supply endpoint
  -> 尝试 Responses endpoint
  -> 上游明确不支持 Responses
  -> 在同一个 supply endpoint 内尝试 Chat endpoint
  -> 仍失败时才回到路由候选集合选择另一个 supply
```

这样可以避免“协议入口错了”直接导致整个上游模型被跳过，也能避免一次重试跳出 graph 已经选定的候选范围。

## DeepSeek 配置示例

DeepSeek 适合建模为一个站点、一个共享模型目录、多个 endpoint profile。

```text
站点：DeepSeek

模型目录：
  DeepSeek Models
  GET https://api.deepseek.com/models
  parser: OpenAI models

Endpoint profiles:
  OpenAI Chat
    API 类型：OpenAI Chat Completions
    请求地址：https://api.deepseek.com/chat/completions
    模型目录：DeepSeek Models

  Anthropic Messages
    API 类型：Anthropic Messages
    请求地址：https://api.deepseek.com/anthropic/v1/messages
    模型目录：DeepSeek Models
```

如果某个兼容网关要求 `/v1/chat/completions`，就把 endpoint profile 的请求地址保存为它实际要求的完整 URL，例如：

```text
https://api.example.com/v1/chat/completions
```

不要把这个值拆成 base URL 和 path，也不要让运行时重新拼接路径。

## 在哪里配置

推荐 UI 组织方式：

1. 在站点管理中配置 endpoint profile：API 类型、请求地址、认证方式、默认 header、默认能力和关联模型目录。
2. 在 endpoint profile 详情中配置 WebSocket transport：派生或自定义 URL、握手 header、会话策略和 HTTP fallback。
3. 在站点管理中配置 model catalog source：发现地址、解析器、刷新策略和最近刷新结果。
4. 在账号或 API Key 详情里配置 credential endpoint binding：支持状态、启用状态、优先级和 key 级覆盖。
5. 在账号或 API Key 的 endpoint 详情里查看或覆盖 credential transport binding。
6. 在模型广场或模型测试中查看实际 API attempt plan：选中的 supply endpoint、候选 endpoint profile、transport、请求地址和观测依据。

## 和 Graph Routing 的关系

Graph Routing 的边仍然是：

```text
supply endpoint -> candidate selector macro
```

Endpoint profile、model catalog source 和 credential binding 不应该显示为普通 graph 节点。它们只影响 supply endpoint 被选中之后怎样调用上游。

这样可以保持：

- 图上候选稳定；
- 手动 macro 引用稳定；
- API fallback 不污染路由图；
- 模型广场能解释“选中了哪个 supply”和“实际会尝试哪些 endpoint profile”。

## 排查建议

### 模型列表正常，但请求走错 URL

检查 endpoint profile 的请求地址。运行时应该使用完整请求地址，不应该从站点 URL 重新拼接协议路径。

### 上游有多个 API 类型，但只调用了一个

检查：

1. 站点是否有多个 endpoint profile；
2. 当前账号或 API Key 是否有对应 credential binding；
3. binding 是否启用且状态为 supported；
4. 请求本身是否需要该 API 类型；
5. 兼容性策略或 endpoint preference 是否限制了尝试顺序；
6. 最近 runtime observation 是否临时跳过了某个 endpoint profile。

### 刷新模型很慢

检查 model catalog source 的数量和刷新策略。正常情况下应该按目录来源刷新，而不是对每个 endpoint profile 和每个模型都做探测。

### Fallback 跑到意外上游

检查：

1. Graph Routing 候选集合是否正确；
2. 请求 scope 是否保持在同一候选集合内；
3. API endpoint fallback 和 supply fallback 是否被混淆；
4. debug trace 是否记录了 selected supply、endpoint profile 和 request URL。

### 兼容性继承看起来不对

检查当前层级是继承还是覆盖。继承状态下 UI 应显示继承来源；只有改为覆盖时才展开具体字段。
