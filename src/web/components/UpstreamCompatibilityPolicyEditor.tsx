import { Button } from './ui/button/index.js';
import { ButtonGroup } from './ui/button-group/index.js';
import { ConfigSection, ConfigSectionItem } from './ConfigSection.js';
import { Input } from './ui/input/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select/index.js';
import { Switch } from './ui/switch/index.js';
import { Textarea } from './ui/textarea/index.js';
import { tr } from '../i18n.js';
import type { UpstreamCompatibilityPolicyForm } from '../lib/upstreamCompatibilityPolicyEditor.js';

type Option<T extends string> = {
  value: T;
  label: string;
};

function SelectField<T extends string>({
  value,
  disabled,
  options,
  onChange,
}: {
  value: T;
  disabled?: boolean;
  options: Array<Option<T>>;
  onChange: (value: T) => void;
}) {
  return (
    <Select disabled={disabled} value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {tr(option.label)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function updateForm(
  value: UpstreamCompatibilityPolicyForm,
  patch: Partial<UpstreamCompatibilityPolicyForm>,
): UpstreamCompatibilityPolicyForm {
  return { ...value, ...patch };
}

const booleanOptions = [
  { value: 'inherit', label: '继承' },
  { value: 'true', label: '启用' },
  { value: 'false', label: '禁用' },
] satisfies Array<Option<UpstreamCompatibilityPolicyForm['assistantHistory']>>;

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
      {tr(label)}
      {children}
    </label>
  );
}

export function UpstreamCompatibilityPolicyEditor({
  value,
  disabled,
  compact = false,
  onChange,
}: {
  value: UpstreamCompatibilityPolicyForm;
  disabled?: boolean;
  compact?: boolean;
  onChange: (value: UpstreamCompatibilityPolicyForm) => void;
}) {
  return (
    <ConfigSection
      compact={compact}
      title={tr('上游兼容性')}
      description={tr('推理历史传输和上游回放行为。')}
      actions={(
        <ButtonGroup>
          <Button
            type="button"
            variant={value.advancedEnabled ? 'outline' : 'secondary'}
            size="sm"
            disabled={disabled}
            onClick={() => onChange(updateForm(value, { advancedEnabled: false }))}
          >
            {tr('表单')}
          </Button>
          <Button
            type="button"
            variant={value.advancedEnabled ? 'secondary' : 'outline'}
            size="sm"
            disabled={disabled}
            onClick={() => onChange(updateForm(value, { advancedEnabled: true }))}
          >
            JSON
          </Button>
        </ButtonGroup>
      )}
    >

      {value.advancedEnabled ? (
        <ConfigSectionItem>
          <Field label="策略 JSON">
            <Textarea
              disabled={disabled}
              value={value.advancedJson}
              onChange={(event) => onChange(updateForm(value, { advancedJson: event.target.value }))}
              className="min-h-[180px] font-mono"
              placeholder='{"reasoningHistory":{"transport":{"mode":"content_think_tag"}}}'
            />
          </Field>
        </ConfigSectionItem>
      ) : (
        <div className="grid gap-2.5">
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            <Field label="传输方式">
              <SelectField
                disabled={disabled}
                value={value.mode}
                options={[
                  { value: 'inherit', label: '继承' },
                  { value: 'native', label: '原生字段' },
                  { value: 'content_think_tag', label: '正文 <think> 标签' },
                  { value: 'drop', label: '丢弃推理历史' },
                ]}
                onChange={(mode) => onChange(updateForm(value, { mode }))}
              />
            </Field>
            <Field label="最大推理字节数">
              <Input
                disabled={disabled}
                value={value.maxReasoningBytes}
                inputMode="numeric"
                onChange={(event) => onChange(updateForm(value, { maxReasoningBytes: event.target.value.replace(/[^\d]/g, '') }))}
                placeholder={tr('继承')}
              />
            </Field>
            <Field label="溢出处理">
              <SelectField
                disabled={disabled}
                value={value.overflow}
                options={[
                  { value: 'inherit', label: '继承' },
                  { value: 'truncate', label: '截断' },
                  { value: 'drop', label: '丢弃' },
                ]}
                onChange={(overflow) => onChange(updateForm(value, { overflow }))}
              />
            </Field>
            <Field label="工具调用消息">
              <SelectField
                disabled={disabled}
                value={value.toolCallMessageBehavior}
                options={[
                  { value: 'inherit', label: '继承' },
                  { value: 'same_as_assistant', label: '跟随 assistant' },
                  { value: 'native', label: '强制原生字段' },
                  { value: 'drop', label: '丢弃推理' },
                ]}
                onChange={(toolCallMessageBehavior) => onChange(updateForm(value, { toolCallMessageBehavior }))}
              />
            </Field>
            <Field label="Assistant 历史">
              <SelectField
                disabled={disabled}
                value={value.assistantHistory}
                options={booleanOptions}
                onChange={(assistantHistory) => onChange(updateForm(value, { assistantHistory }))}
              />
            </Field>
            <Field label="Assistant 工具调用">
              <SelectField
                disabled={disabled}
                value={value.assistantToolCalls}
                options={booleanOptions}
                onChange={(assistantToolCalls) => onChange(updateForm(value, { assistantToolCalls }))}
              />
            </Field>
            <Field label="响应续写">
              <SelectField
                disabled={disabled}
                value={value.responseContinuation}
                options={booleanOptions}
                onChange={(responseContinuation) => onChange(updateForm(value, { responseContinuation }))}
              />
            </Field>
            <label className="flex min-h-9 items-center justify-between gap-2 rounded-lg border bg-card px-2.5 text-xs text-muted-foreground">
              <span className="font-medium">{tr('高级 JSON')}</span>
              <Switch
                disabled={disabled}
                checked={value.advancedEnabled}
                onCheckedChange={(advancedEnabled) => onChange(updateForm(value, { advancedEnabled }))}
                aria-label={tr('高级 JSON')}
              />
            </label>
          </div>
          {value.mode === 'content_think_tag' ? (
            <ConfigSectionItem className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
              <Field label="开始标签">
                <Input disabled={disabled} value={value.openTag} onChange={(event) => onChange(updateForm(value, { openTag: event.target.value }))} />
              </Field>
              <Field label="结束标签">
                <Input disabled={disabled} value={value.closeTag} onChange={(event) => onChange(updateForm(value, { closeTag: event.target.value }))} />
              </Field>
              <Field label="分隔符">
                <Input disabled={disabled} value={value.separator} onChange={(event) => onChange(updateForm(value, { separator: event.target.value }))} />
              </Field>
            </ConfigSectionItem>
          ) : null}
        </div>
      )}
    </ConfigSection>
  );
}
