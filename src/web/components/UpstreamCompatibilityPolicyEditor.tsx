import { Button } from './ui/button/index.js';
import { Badge } from './ui/badge/index.js';
import { ConfigSection, ConfigSectionItem } from './ConfigSection.js';
import { Input } from './ui/input/index.js';
import { Label } from './ui/label/index.js';
import { RadioGroup, RadioGroupItem } from './ui/radio-group/index.js';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select/index.js';
import JsonCodeEditor from './JsonCodeEditor.js';
import { tr } from '../i18n.js';
import { emptyUpstreamCompatibilityPolicyForm, isCompatibilityPolicyFormInherited, type UpstreamCompatibilityPolicyForm } from '../lib/upstreamCompatibilityPolicyEditor.js';

type Option<T extends string> = {
  value: T;
  label: string;
  description?: string;
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
  const selectedOption = options.find((option) => option.value === value);
  return (
    <Select disabled={disabled} value={value} onValueChange={(next) => onChange(next as T)}>
      <SelectTrigger>
        <SelectValue>{selectedOption ? tr(selectedOption.label) : undefined}</SelectValue>
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
  { value: 'inherit', label: 'common.inherit', description: 'upstreamCompatibility.boolean.inheritDescription' },
  { value: 'true', label: 'common.enabled', description: 'upstreamCompatibility.boolean.enabledDescription' },
  { value: 'false', label: 'common.disabled', description: 'upstreamCompatibility.boolean.disabledDescription' },
] satisfies Array<Option<UpstreamCompatibilityPolicyForm['assistantHistory']>>;

const transportModeOptions = [
  { value: 'native', label: 'upstreamCompatibility.transport.native', description: 'upstreamCompatibility.transport.nativeDescription' },
  { value: 'content_think_tag', label: 'upstreamCompatibility.transport.contentThinkTag', description: 'upstreamCompatibility.transport.contentThinkTagDescription' },
  { value: 'drop', label: 'upstreamCompatibility.transport.drop', description: 'upstreamCompatibility.transport.dropDescription' },
] satisfies Array<Option<UpstreamCompatibilityPolicyForm['mode']>>;

function Field({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
      <span className="flex flex-col gap-0.5">
        <span>{tr(label)}</span>
        {description ? <span className="font-normal leading-relaxed text-muted-foreground/80">{tr(description)}</span> : null}
      </span>
      {children}
    </label>
  );
}

function PolicyModeButton({
  active,
  disabled,
  label,
  description,
  onClick,
}: {
  active: boolean;
  disabled?: boolean;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      variant={active ? 'secondary' : 'outline'}
      disabled={disabled}
      onClick={onClick}
      className="h-auto min-h-11 flex-1 justify-start px-3 py-2 text-left"
    >
      <span className="grid gap-0.5">
        <span className="text-sm font-medium">{tr(label)}</span>
        <span className="text-xs font-normal text-muted-foreground">{tr(description)}</span>
      </span>
    </Button>
  );
}

function TransportModeCard({
  option,
  selected,
}: {
  option: Option<UpstreamCompatibilityPolicyForm['mode']>;
  selected: boolean;
}) {
  return (
    <Label
      className={`flex min-h-20 items-start gap-2 rounded-md border bg-card px-3 py-2.5 text-sm font-medium text-foreground transition-colors ${selected ? 'border-primary bg-primary/5' : ''}`.trim()}
    >
      <RadioGroupItem value={option.value} className="mt-0.5" />
      <span className="grid gap-1">
        <span>{tr(option.label)}</span>
        {option.description ? <span className="text-xs font-normal leading-relaxed text-muted-foreground">{tr(option.description)}</span> : null}
      </span>
    </Label>
  );
}

export function UpstreamCompatibilityPolicyEditor({
  value,
  disabled,
  compact = false,
  inheritFrom,
  onChange,
}: {
  value: UpstreamCompatibilityPolicyForm;
  disabled?: boolean;
  compact?: boolean;
  inheritFrom?: string;
  onChange: (value: UpstreamCompatibilityPolicyForm) => void;
}) {
  const inherited = isCompatibilityPolicyFormInherited(value);
  const sourceLabel = inheritFrom || tr('upstreamCompatibility.inheritSource.defaultChain');
  const editorMode = value.advancedEnabled ? 'json' : inherited ? 'inherit' : 'override';
  return (
    <ConfigSection
      compact={compact}
      title={tr('upstreamCompatibility.title')}
      description={tr('upstreamCompatibility.description')}
    >
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={editorMode === 'inherit' ? 'secondary' : editorMode === 'json' ? 'warning' : 'info'}>
            {editorMode === 'inherit'
              ? tr('upstreamCompatibility.mode.inherit')
              : editorMode === 'json'
                ? tr('upstreamCompatibility.mode.json')
                : tr('upstreamCompatibility.mode.override')}
          </Badge>
          <span className="text-xs leading-relaxed text-muted-foreground">
            {editorMode === 'inherit'
              ? tr('upstreamCompatibility.inheritedDescription').replace('{source}', sourceLabel)
              : editorMode === 'json'
                ? tr('upstreamCompatibility.jsonModeDescription')
                : tr('upstreamCompatibility.overrideModeDescription')}
          </span>
        </div>
        <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
          <PolicyModeButton
            active={editorMode === 'inherit'}
            disabled={disabled}
            label="upstreamCompatibility.mode.inherit"
            description="upstreamCompatibility.mode.inheritHint"
            onClick={() => onChange(emptyUpstreamCompatibilityPolicyForm())}
          />
          <PolicyModeButton
            active={editorMode === 'override'}
            disabled={disabled}
            label="upstreamCompatibility.mode.override"
            description="upstreamCompatibility.mode.overrideHint"
            onClick={() => onChange(updateForm(value, { advancedEnabled: false, mode: inherited ? 'native' : value.mode }))}
          />
          <PolicyModeButton
            active={editorMode === 'json'}
            disabled={disabled}
            label="upstreamCompatibility.mode.json"
            description="upstreamCompatibility.mode.jsonHint"
            onClick={() => onChange(updateForm(value, { advancedEnabled: true }))}
          />
        </div>
      </div>
      {value.advancedEnabled ? (
        <ConfigSectionItem className="grid gap-2.5">
          <div className="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-xs leading-relaxed text-warning">
            {tr('upstreamCompatibility.jsonWarning')}
          </div>
          <Field label="upstreamCompatibility.tabs.policyJson" description="upstreamCompatibility.policyJsonDescription">
            <JsonCodeEditor
              disabled={disabled}
              value={value.advancedJson}
              onChange={(nextValue) => onChange(updateForm(value, { advancedJson: nextValue }))}
              minHeight={220}
              placeholder='{"reasoningHistory":{"transport":{"mode":"content_think_tag"}}}'
            />
          </Field>
        </ConfigSectionItem>
      ) : inherited ? (
        <ConfigSectionItem className="grid gap-3 border-dashed bg-muted/30">
          <div className="grid gap-1.5">
            <div className="text-sm font-semibold text-foreground">{tr('upstreamCompatibility.inheritedTitle')}</div>
            <div className="text-xs leading-relaxed text-muted-foreground">
              {tr('upstreamCompatibility.inheritedLongDescription').replace('{source}', sourceLabel)}
            </div>
          </div>
          <div className="grid gap-2 rounded-md border bg-background px-3 py-2 text-xs text-muted-foreground">
            <div className="font-medium text-foreground">{tr('upstreamCompatibility.inheritOrderTitle')}</div>
            <div>{sourceLabel}</div>
          </div>
        </ConfigSectionItem>
      ) : (
        <div className="grid gap-2.5">
          <ConfigSectionItem className="grid gap-2.5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="grid gap-1">
                <div className="text-sm font-semibold text-foreground">{tr('upstreamCompatibility.section.transport')}</div>
                <div className="text-xs leading-relaxed text-muted-foreground">{tr('upstreamCompatibility.section.transportDescription')}</div>
              </div>
              <Button
                type="button"
                variant="ghostMuted"
                size="sm"
                disabled={disabled}
                onClick={() => onChange(emptyUpstreamCompatibilityPolicyForm())}
              >
                {tr('upstreamCompatibility.restoreInheritance')}
              </Button>
            </div>
            <div className="grid min-w-0 gap-1.5 text-xs font-medium text-muted-foreground">
              <RadioGroup
                disabled={disabled}
                value={value.mode}
                onValueChange={(mode) => onChange(updateForm(value, { mode: mode as UpstreamCompatibilityPolicyForm['mode'] }))}
                className="grid grid-cols-1 gap-2 sm:grid-cols-3"
              >
                {transportModeOptions.map((option) => (
                  <TransportModeCard
                    key={option.value}
                    option={option}
                    selected={value.mode === option.value}
                  />
                ))}
              </RadioGroup>
            </div>
          </ConfigSectionItem>
          <ConfigSectionItem className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            <div className="grid gap-1 md:col-span-2">
              <div className="text-sm font-semibold text-foreground">{tr('upstreamCompatibility.section.limits')}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">{tr('upstreamCompatibility.section.limitsDescription')}</div>
            </div>
            <Field label="upstreamCompatibility.maxReasoningBytes" description="upstreamCompatibility.maxReasoningBytesDescription">
              <Input
                disabled={disabled}
                value={value.maxReasoningBytes}
                inputMode="numeric"
                onChange={(event) => onChange(updateForm(value, { maxReasoningBytes: event.target.value.replace(/[^\d]/g, '') }))}
                placeholder={tr('common.inherit')}
              />
            </Field>
            <Field label="upstreamCompatibility.overflow" description="upstreamCompatibility.overflowDescription">
              <SelectField
                disabled={disabled}
                value={value.overflow}
                options={[
                  { value: 'inherit', label: 'common.inherit', description: 'upstreamCompatibility.overflow.inheritDescription' },
                  { value: 'truncate', label: 'upstreamCompatibility.overflow.truncate', description: 'upstreamCompatibility.overflow.truncateDescription' },
                  { value: 'drop', label: 'upstreamCompatibility.overflow.drop', description: 'upstreamCompatibility.overflow.dropDescription' },
                ]}
                onChange={(overflow) => onChange(updateForm(value, { overflow }))}
              />
            </Field>
            <Field label="upstreamCompatibility.toolCallMessages" description="upstreamCompatibility.toolCallMessagesDescription">
              <SelectField
                disabled={disabled}
                value={value.toolCallMessageBehavior}
                options={[
                  { value: 'inherit', label: 'common.inherit', description: 'upstreamCompatibility.toolCall.inheritDescription' },
                  { value: 'same_as_assistant', label: 'upstreamCompatibility.toolCall.sameAsAssistant', description: 'upstreamCompatibility.toolCall.sameAsAssistantDescription' },
                  { value: 'native', label: 'upstreamCompatibility.toolCall.forceNative', description: 'upstreamCompatibility.toolCall.forceNativeDescription' },
                  { value: 'drop', label: 'upstreamCompatibility.toolCall.dropReasoning', description: 'upstreamCompatibility.toolCall.dropReasoningDescription' },
                ]}
                onChange={(toolCallMessageBehavior) => onChange(updateForm(value, { toolCallMessageBehavior }))}
              />
            </Field>
          </ConfigSectionItem>
          <ConfigSectionItem className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
            <div className="grid gap-1 sm:col-span-3">
              <div className="text-sm font-semibold text-foreground">{tr('upstreamCompatibility.section.applyTo')}</div>
              <div className="text-xs leading-relaxed text-muted-foreground">{tr('upstreamCompatibility.section.applyToDescription')}</div>
            </div>
            <Field label="upstreamCompatibility.assistantHistory" description="upstreamCompatibility.assistantHistoryDescription">
              <SelectField
                disabled={disabled}
                value={value.assistantHistory}
                options={booleanOptions}
                onChange={(assistantHistory) => onChange(updateForm(value, { assistantHistory }))}
              />
            </Field>
            <Field label="upstreamCompatibility.assistantToolCalls" description="upstreamCompatibility.assistantToolCallsDescription">
              <SelectField
                disabled={disabled}
                value={value.assistantToolCalls}
                options={booleanOptions}
                onChange={(assistantToolCalls) => onChange(updateForm(value, { assistantToolCalls }))}
              />
            </Field>
            <Field label="upstreamCompatibility.responseContinuation" description="upstreamCompatibility.responseContinuationDescription">
              <SelectField
                disabled={disabled}
                value={value.responseContinuation}
                options={booleanOptions}
                onChange={(responseContinuation) => onChange(updateForm(value, { responseContinuation }))}
              />
            </Field>
          </ConfigSectionItem>
          {value.mode === 'content_think_tag' ? (
            <ConfigSectionItem className="grid grid-cols-1 gap-2.5 md:grid-cols-3">
              <div className="grid gap-1 md:col-span-3">
                <div className="text-sm font-semibold text-foreground">{tr('upstreamCompatibility.section.thinkTag')}</div>
                <div className="text-xs leading-relaxed text-muted-foreground">{tr('upstreamCompatibility.section.thinkTagDescription')}</div>
              </div>
              <Field label="upstreamCompatibility.openTag" description="upstreamCompatibility.openTagDescription">
                <Input disabled={disabled} value={value.openTag} onChange={(event) => onChange(updateForm(value, { openTag: event.target.value }))} />
              </Field>
              <Field label="upstreamCompatibility.closeTag" description="upstreamCompatibility.closeTagDescription">
                <Input disabled={disabled} value={value.closeTag} onChange={(event) => onChange(updateForm(value, { closeTag: event.target.value }))} />
              </Field>
              <Field label="upstreamCompatibility.separator" description="upstreamCompatibility.separatorDescription">
                <Input disabled={disabled} value={value.separator} onChange={(event) => onChange(updateForm(value, { separator: event.target.value }))} />
              </Field>
            </ConfigSectionItem>
          ) : null}
        </div>
      )}
    </ConfigSection>
  );
}
