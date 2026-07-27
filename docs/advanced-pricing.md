# 高级计价方案

高级计价方案用于描述不能只用“输入 / 输出 / 缓存 / 请求费”表达的价格规则，例如分段计价、批量折扣、缓存命中、上下文窗口分段、合约折扣、税费、最低消费和少量自定义公式。

在后台的 **成本目录 -> 参考价格数据库 -> 新增/编辑条目** 中，打开 **高级计价方案** 后可以直接填写 `PricingPlan` JSON。图形化价格表和高级 JSON 最终都会保存为同一种 `PricingPlan`。

## 最小结构

```json
{
  "schemaVersion": 1,
  "planKind": "rate_card",
  "unitPrecision": "mixed",
  "billingMode": "mixed",
  "aggregation": {
    "mode": "sum_components",
    "period": "request"
  },
  "rounding": {
    "mode": "total",
    "precision": 12
  },
  "tiers": [],
  "components": [
    {
      "id": "input_tokens",
      "label": "Input tokens",
      "role": "charge",
      "kind": "input_tokens",
      "meter": {
        "unit": "token",
        "quantityPath": "usage.inputTokens",
        "scale": 1000000,
        "missingQuantity": "zero"
      },
      "price": {
        "currency": "USD",
        "amount": 2,
        "unitLabel": "1M tokens"
      }
    }
  ]
}
```

关键字段：

- `schemaVersion`: 当前固定为 `1`。
- `planKind`: 通常使用 `rate_card`；合约、促销、私有折扣可以用 `overlays` 表达。
- `unitPrecision`: 价格单位，常用 `per_1m` 或 `mixed`。
- `billingMode`: `token`、`request`、`time`、`asset` 或 `mixed`。
- `aggregation.mode`: 当前使用 `sum_components`。
- `rounding`: `none`、`component` 或 `total`，`precision` 是小数位。
- `components`: 每个可计费部分，例如输入 token、输出 token、缓存读取、请求费。
- `tiers`: 可复用的条件分层，例如上下文大小、批量、服务档位、地区。

## 可计费组件

`component.kind` 支持：

```text
input_tokens
output_tokens
reasoning_tokens
cache_read_tokens
cache_write_tokens
request
tool_call
image_input
image_output
audio_input
audio_output
video_input
embedding_tokens
storage
custom
```

`role` 支持：

- `charge`: 正常收费。
- `discount`: 折扣，计算为负数。
- `credit`: 额度抵扣，计算为负数。
- `minimum`: 将总价抬到至少该组件金额。
- `maximum`: 将总价压到最多该组件金额。

`meter.scale` 决定单价单位。例如 `scale: 1000000` 表示价格是每 100 万 token。

## 分段计价

### Volume tier

总量落在哪个区间，全部数量按该区间价格计算。

```json
{
  "id": "input",
  "label": "Input",
  "role": "charge",
  "kind": "input_tokens",
  "meter": { "unit": "token", "quantityPath": "usage.inputTokens", "scale": 1000000 },
  "price": { "currency": "USD", "amount": 10, "unitLabel": "1M tokens" },
  "quantityPricing": {
    "mode": "volume_tier",
    "tiers": [
      { "id": "low", "from": 0, "to": 1000000, "price": { "currency": "USD", "amount": 10, "unitLabel": "1M tokens" } },
      { "id": "high", "from": 1000000, "price": { "currency": "USD", "amount": 6, "unitLabel": "1M tokens" } }
    ]
  }
}
```

如果输入是 200 万 token，总价是 `2 * 6 = 12`。

### Graduated tier

每个区间分别计价后相加。

```json
"quantityPricing": {
  "mode": "graduated_tier",
  "tiers": [
    { "id": "low", "from": 0, "to": 1000000, "price": { "currency": "USD", "amount": 10, "unitLabel": "1M tokens" } },
    { "id": "high", "from": 1000000, "price": { "currency": "USD", "amount": 6, "unitLabel": "1M tokens" } }
  ]
}
```

如果输入是 200 万 token，总价是 `1 * 10 + 1 * 6 = 16`。

### Stairstep

数量落入某个区间后收一个固定价。

```json
"quantityPricing": {
  "mode": "stairstep",
  "steps": [
    { "id": "small", "from": 0, "to": 1000000, "flatPrice": { "currency": "USD", "amount": 1, "unitLabel": "request" } },
    { "id": "large", "from": 1000000, "flatPrice": { "currency": "USD", "amount": 3, "unitLabel": "request" } }
  ]
}
```

## 条件计价

条件可以放在 `component.appliesWhen`、`allowance.appliesWhen`、`overlay.appliesWhen` 和 `postProcessor.appliesWhen`。

结构化条件示例：

```json
{
  "predicate": {
    "kind": "batch",
    "value": true
  }
}
```

组合条件示例：

```json
{
  "all": [
    { "predicate": { "kind": "service_tier", "value": "priority" } },
    { "predicate": { "kind": "context_tokens", "min": 1000000 } }
  ]
}
```

支持的 predicate：

- `context_tokens`
- `input_tokens`
- `output_tokens`
- `service_tier`
- `batch`
- `modality`
- `region`
- `custom`

## CEL 条件和公式

CEL 是高级逃生口，适合少量规则无法用结构化字段表达时使用。优先使用结构化字段，只有必要时再用 CEL。

CEL 条件必须返回 boolean：

```json
"appliesWhen": {
  "cel": "metadata.billing_mode == \"batch\" && usage.inputTokens > 0"
}
```

CEL 价格公式写在 `price.expression` 中，必须返回非负数字。返回值表示当前组件的单价，仍会按 `quantity / scale` 计算总价。

```json
{
  "price": {
    "currency": "USD",
    "amount": 10,
    "unitLabel": "1M tokens",
    "expression": {
      "kind": "formula",
      "cel": "unitPriceUsd * metadata.contract_multiplier"
    }
  }
}
```

可访问变量：

```text
model
provider
usage
quantity
scale
unitPriceUsd
component
request
response
upstreamSupply
metadata
```

示例：

```text
usage.inputTokens > 1000000
metadata.contract_multiplier == 0.5
unitPriceUsd * metadata.contract_multiplier
metadata.region == "us-east" ? unitPriceUsd : unitPriceUsd * 1.1
```

限制：

- CEL 不能访问文件、网络、时间、随机数、环境变量或密钥。
- 条件 CEL 返回非 boolean 时，该条件视为不匹配并产生诊断。
- 公式 CEL 返回非数字、负数或无法执行时，该组件不计入结果，评估等级变为 `incomplete`。
- `transforms.kind = "custom"` 必须返回非负数字，通常用于写入 `usage.custom.*` 或 `metadata.*`。

## 免费额度

请求内免费额度：

```json
"allowances": [
  {
    "id": "free-input",
    "label": "Free input per request",
    "meter": { "unit": "token", "quantityPath": "usage.inputTokens", "scale": 1000000 },
    "quantity": 100000,
    "period": "request"
  }
]
```

日/月/账期额度需要 period state。没有 period state 时，评估会给出 `period_estimate`。

## 用 transforms 派生计费用量

Transforms 会在选择 tier 和计算组件前执行，适合把供应商返回的字段转换成计价需要的标准字段。

从输入 token 中扣除缓存读取 token：

```json
"transforms": [
  {
    "id": "billable-input",
    "kind": "subtract_usage_fields",
    "inputPaths": ["usage.inputTokens", "usage.cacheReadTokens"],
    "outputPath": "usage.custom.billableInputTokens"
  }
]
```

然后组件可以读取派生字段：

```json
{
  "id": "billable-input",
  "label": "Billable input",
  "role": "charge",
  "kind": "custom",
  "meter": {
    "unit": "token",
    "quantityPath": "usage.custom.billableInputTokens",
    "scale": 1000000
  },
  "price": {
    "currency": "USD",
    "amount": 10,
    "unitLabel": "1M billable input tokens"
  }
}
```

自定义 CEL transform 示例：

```json
"transforms": [
  {
    "id": "contract-multiplier",
    "kind": "custom",
    "inputPaths": ["usage.inputTokens"],
    "outputPath": "metadata.contract_multiplier",
    "cel": "usage.inputTokens > 1000000 ? 0.5 : 1.0"
  }
]
```

## 合约价、折扣和税费

组件折扣：

```json
"overlays": [
  {
    "id": "contract-half-price",
    "label": "Contract half price",
    "source": "user_contract",
    "operation": {
      "kind": "multiply_component",
      "componentId": "input_tokens",
      "factor": 0.5
    }
  }
]
```

总价 markup：

```json
"overlays": [
  {
    "id": "reseller-markup",
    "label": "Reseller markup",
    "source": "reseller_markup",
    "operation": {
      "kind": "multiply_total",
      "factor": 1.2
    }
  }
]
```

税费后处理：

```json
"postProcessors": [
  {
    "id": "tax",
    "label": "Tax",
    "kind": "tax",
    "factor": 0.1
  }
]
```

## 完整示例

```json
{
  "schemaVersion": 1,
  "planKind": "rate_card",
  "unitPrecision": "mixed",
  "billingMode": "mixed",
  "aggregation": { "mode": "sum_components", "period": "request" },
  "rounding": { "mode": "total", "precision": 12 },
  "tiers": [
    {
      "id": "large-context",
      "label": "Large context",
      "dimensions": [
        { "kind": "context_tokens", "min": 1000000 }
      ]
    }
  ],
  "components": [
    {
      "id": "input",
      "label": "Input",
      "role": "charge",
      "kind": "input_tokens",
      "meter": { "unit": "token", "quantityPath": "usage.inputTokens", "scale": 1000000, "missingQuantity": "zero" },
      "price": { "currency": "USD", "amount": 2, "unitLabel": "1M tokens" }
    },
    {
      "id": "output",
      "label": "Output",
      "role": "charge",
      "kind": "output_tokens",
      "meter": { "unit": "token", "quantityPath": "usage.outputTokens", "scale": 1000000, "missingQuantity": "zero" },
      "price": {
        "currency": "USD",
        "amount": 8,
        "unitLabel": "1M tokens",
        "expression": { "kind": "formula", "cel": "unitPriceUsd * (metadata.contract_multiplier == 0 ? 1 : metadata.contract_multiplier)" }
      }
    },
    {
      "id": "cache-read",
      "label": "Cache read",
      "role": "charge",
      "kind": "cache_read_tokens",
      "meter": { "unit": "token", "quantityPath": "usage.cacheReadTokens", "scale": 1000000, "missingQuantity": "zero" },
      "price": { "currency": "USD", "amount": 0.2, "unitLabel": "1M tokens" }
    },
    {
      "id": "large-context-fee",
      "label": "Large context surcharge",
      "role": "charge",
      "kind": "request",
      "meter": { "unit": "request", "quantityPath": "usage.requestCount", "scale": 1, "missingQuantity": "zero" },
      "price": { "currency": "USD", "amount": 0.01, "unitLabel": "request" },
      "tierRef": "large-context"
    }
  ],
  "allowances": [
    {
      "id": "free-cache-read",
      "label": "Free cache read",
      "meter": { "unit": "token", "quantityPath": "usage.cacheReadTokens", "scale": 1000000 },
      "quantity": 100000,
      "period": "request"
    }
  ]
}
```
