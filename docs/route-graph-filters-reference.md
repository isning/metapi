# Route Graph Filter 参考

Filter 用于在路由组或独立 `filter` 节点中修改请求。它替代旧的 Payload 规则，成为 Graph Routing 原生的一部分。

## 执行阶段

| 操作 | 阶段 | 说明 |
|------|------|------|
| `rewrite_model` | `pre_selection` | 在选择候选前改写模型名 |
| 其它操作 | `post_build` | 选路后、构建上游请求前应用 |

同一个 filter 里的操作按数组顺序执行。

## JSON Path

`set_payload` 和 `remove_payload` 使用点分路径。

```text
reasoning_effort
metadata.route
messages.0.content
tools.0.function.name
```

数字段表示数组下标。空路径会被忽略。

## rewrite_model

改写当前模型名或上游模型名。

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"rewrite_model"` | 固定值 |
| `source` | `current_model`/`upstream_model` | 改写目标 |
| `operation` | `strip_suffix`/`set` | 操作 |
| `suffix` | string | `strip_suffix` 使用 |
| `value` | string | `set` 使用 |

去掉下游 debug 后缀：

```json
{
  "type": "rewrite_model",
  "source": "current_model",
  "operation": "strip_suffix",
  "suffix": "-debug"
}
```

强制上游模型：

```json
{
  "type": "rewrite_model",
  "source": "upstream_model",
  "operation": "set",
  "value": "gpt-4o"
}
```

## set_payload

设置 payload 字段。

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"set_payload"` | 固定值 |
| `path` | string | 点分路径 |
| `value` | unknown | 写入值 |
| `mode` | `default`/`override` | 默认 `default` |

`default` 只在字段不存在时写入，`override` 总是覆盖。

```json
{
  "type": "set_payload",
  "path": "reasoning_effort",
  "value": "medium",
  "mode": "default"
}
```

```json
{
  "type": "set_payload",
  "path": "thinking",
  "value": { "type": "enabled" },
  "mode": "override"
}
```

## remove_payload

删除 payload 字段。

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"remove_payload"` | 固定值 |
| `path` | string | 点分路径 |

```json
{
  "type": "remove_payload",
  "path": "metadata.debug"
}
```

## set_header

设置 header。header 名会规范化为小写。

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"set_header"` | 固定值 |
| `name` | string | header 名 |
| `value` | string | header 值 |
| `mode` | `default`/`override` | 默认 `default` |

```json
{
  "type": "set_header",
  "name": "X-Route-Policy",
  "value": "premium",
  "mode": "override"
}
```

## remove_header

删除 header。

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"remove_header"` | 固定值 |
| `name` | string | header 名 |

```json
{
  "type": "remove_header",
  "name": "X-Debug"
}
```

## set_endpoint_preference

指定上游 API endpoint preference。它用于选择 site/key 支持的 endpoint 变体。

字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `"set_endpoint_preference"` | 固定值 |
| `endpoint` | `chat`/`messages`/`responses` | 期望 API endpoint |

```json
{
  "type": "set_endpoint_preference",
  "endpoint": "responses"
}
```

## 放在哪里

| 位置 | 适合场景 |
|------|----------|
| macro `config.filters.operations` | 某个路由组专用改写 |
| 独立 `filter` node | 多个节点共享同一段改写 |

推荐优先放在 macro 里。只有确实需要多个路由共享同一段 filter，才创建独立 `filter` node。

常见组合示例见 [Route Graph Recipes](./route-graph-recipes.md)，包括 DeepSeek `-max` 入口注入 `thinking` 和 `reasoning_effort` 的写法。

## 完整片段

```json
{
  "filters": {
    "operations": [
      {
        "type": "rewrite_model",
        "source": "current_model",
        "operation": "strip_suffix",
        "suffix": "-debug"
      },
      {
        "type": "set_payload",
        "path": "reasoning_effort",
        "value": "high",
        "mode": "default"
      },
      {
        "type": "set_header",
        "name": "X-Metapi-Route",
        "value": "premium",
        "mode": "override"
      },
      {
        "type": "set_endpoint_preference",
        "endpoint": "responses"
      }
    ]
  }
}
```
