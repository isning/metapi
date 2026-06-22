import { getSiteInitializationPreset } from '../../shared/siteInitializationPresets.js';
import { Alert, AlertDescription, AlertTitle } from './ui/alert/index.js';
import { Button } from './ui/button/index.js';
import * as Dialog from './ui/dialog/index.js';

import { tr } from '../i18n.js';
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
  sessionLabel = tr('components.siteCreatedModal.addAccountUsernamepasswordsign'),
  onChoice,
  onClose,
}: Props) {
  const preset = getSiteInitializationPreset(initializationPresetId);
  const apiKeyFirst = initialSegment === 'apikey';
  const helperText = preset?.description
    || (apiKeyFirst
      ? tr('components.siteCreatedModal.platformBaseUrlApiKeyModel')
      : tr('components.siteCreatedModal.signApiKey'));
  const primaryAction = apiKeyFirst
    ? {
      choice: 'apikey' as const,
      label: tr('components.siteCreatedModal.addApiKeyRecommended'),
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
      label: tr('components.siteCreatedModal.addApiKey'),
    };

  return (
    <Dialog.Root open onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }}>
      <Dialog.Content className="w-[min(92vw,520px)]">
        <Dialog.Header>
          <Dialog.Title>{tr('components.siteCreatedModal.sitesSuccess')}</Dialog.Title>
          <Dialog.Description>{tr('components.siteCreatedModal.infoSiteManagementconfiguration')}</Dialog.Description>
        </Dialog.Header>
        <div className="grid gap-3">
          <Alert>
            <AlertTitle>{tr('components.siteCreatedModal.sitesAddsuccess')}</AlertTitle>
            <AlertDescription>
          {tr('components.searchModal.sites2')} <strong>"{siteName}"</strong> {tr('components.siteCreatedModal.nowInfo')}
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
            {tr('components.siteCreatedModal.tipSiteManagementAccountsApiKey')}
          </p>
        </div>
        <Dialog.Footer>
          <Button type="button" variant="ghost" onClick={() => onChoice('later')}>
            {tr('components.siteCreatedModal.configuration')}
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
