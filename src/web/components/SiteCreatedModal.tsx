import { getSiteInitializationPreset } from '../../shared/siteInitializationPresets.js';
import { Alert, AlertDescription, AlertTitle } from './ui/alert/index.js';
import { Button } from './ui/button/index.js';
import * as Dialog from './ui/dialog/index.js';

type NextStepChoice = 'session' | 'apikey' | 'later';

type Props = {
  siteName: string;
  initializationPresetId?: string | null;
  initialSegment?: 'session' | 'apikey';
  sessionLabel?: string;
  onChoice: (choice: NextStepChoice) => void;
  onClose: () => void;
};

export default function SiteCreatedModal({
  siteName,
  initializationPresetId,
  initialSegment = 'session',
  sessionLabel = '添加账号（用户名密码登录）',
  onChoice,
  onClose,
}: Props) {
  const preset = getSiteInitializationPreset(initializationPresetId);
  const apiKeyFirst = initialSegment === 'apikey';
  const helperText = preset?.description
    || (apiKeyFirst
      ? '该平台更适合直接通过 Base URL + API Key 接入，后续再补模型初始化。'
      : '接下来您可以继续补充登录连接或 API Key。');
  const primaryAction = apiKeyFirst
    ? {
      choice: 'apikey' as const,
      label: '添加 API Key（推荐）',
    }
    : {
      choice: 'session' as const,
      label: sessionLabel,
    };
  const secondaryAction = apiKeyFirst
    ? {
      choice: 'session' as const,
      label: sessionLabel,
    }
    : {
      choice: 'apikey' as const,
      label: '添加 API Key',
    };

  return (
    <Dialog.Root open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Content className="w-[min(92vw,520px)]">
        <Dialog.Header>
          <Dialog.Title>站点创建成功</Dialog.Title>
          <Dialog.Description>继续补充连接信息，或稍后回到站点管理配置。</Dialog.Description>
        </Dialog.Header>
        <div className="grid gap-3">
          <Alert>
            <AlertTitle>站点已添加成功</AlertTitle>
            <AlertDescription>
          站点 <strong>"{siteName}"</strong> 已加入列表，您现在可以继续补充连接信息。
            </AlertDescription>
          </Alert>

          {preset ? (
            <Alert>
              <AlertTitle>{preset.label}</AlertTitle>
              <AlertDescription>{helperText}</AlertDescription>
            </Alert>
          ) : (
            <p className="text-sm text-muted-foreground">
              {helperText}
            </p>
          )}

          <p className="text-xs text-muted-foreground">
            提示：您可以随时在“站点管理”页面补充账号或 API Key。
          </p>
        </div>
        <Dialog.Footer>
          <Button type="button" variant="ghost" onClick={() => onChoice('later')}>
            稍后配置
          </Button>
          <Button type="button" variant="outline" onClick={() => onChoice(secondaryAction.choice)}>
            {secondaryAction.label}
          </Button>
          <Button type="button" onClick={() => onChoice(primaryAction.choice)}>
            {primaryAction.label}
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>
  );
}
