import React from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import { Button } from '../../components/ui/button/index.js';
import { Input } from '../../components/ui/input/index.js';

import { tr } from '../../i18n.js';
type ModalPresence = {
  shouldRender: boolean;
  isVisible: boolean;
};

type DownstreamCreateForm = {
  name: string;
  key: string;
  description: string;
  maxCost: string;
  maxRequests: string;
  expiresAt: string;
  selectedModels: string[];
  selectedGroupRouteIds: number[];
};

type DownstreamApiKeyModalProps = {
  presence: ModalPresence;
  editingDownstreamId: number | null;
  downstreamCreate: DownstreamCreateForm;
  downstreamSaving: boolean;
  onChange: (updater: (prev: DownstreamCreateForm) => DownstreamCreateForm) => void;
  onOpenSelector: () => Promise<void> | void;
  onClose: () => void;
  onSave: () => Promise<void> | void;
};

export default function DownstreamApiKeyModal({
  presence,
  editingDownstreamId,
  downstreamCreate,
  downstreamSaving,
  onChange,
  onOpenSelector,
  onClose,
  onSave,
}: DownstreamApiKeyModalProps) {
  if (!presence.shouldRender) return null;

  return (
    <CenteredModal
      open={presence.shouldRender}
      onClose={onClose}
      title={editingDownstreamId ? tr('pages.settings.downstreamApiKeyModal.editApiKey') : tr('pages.settings.downstreamApiKeyModal.apiKey')}
      maxWidth={860}
      closeOnBackdrop
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose}>{tr('app.cancel')}</Button>
          <Button type="button" onClick={() => void onSave()} disabled={downstreamSaving}>
            {downstreamSaving ? tr('pages.accounts.saving') : (editingDownstreamId ? tr('pages.settings.downstreamApiKeyModal.apiKey2') : tr('pages.settings.downstreamApiKeyModal.apiKey3'))}
          </Button>
        </>
      )}
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <Input
          value={downstreamCreate.name}
          onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value }))}
          placeholder="Name (e.g. cc-project)"
        />
        <Input
          value={downstreamCreate.key}
          onChange={(e) => onChange((prev) => ({ ...prev, key: e.target.value.trim() }))}
          placeholder="sk-xxxx"
          className="font-mono"
        />
        <Input
          value={downstreamCreate.maxCost}
          onChange={(e) => onChange((prev) => ({ ...prev, maxCost: e.target.value }))}
          placeholder={tr('pages.settings.downstreamApiKeyModal.maxCostOptional')}
          type="number"
          min={0}
          step={0.000001}
        />
        <Input
          value={downstreamCreate.maxRequests}
          onChange={(e) => onChange((prev) => ({ ...prev, maxRequests: e.target.value }))}
          placeholder={tr('pages.settings.downstreamApiKeyModal.maxRequestsOptional')}
          type="number"
          min={0}
          step={1}
        />
        <Input
          value={downstreamCreate.expiresAt}
          onChange={(e) => onChange((prev) => ({ ...prev, expiresAt: e.target.value }))}
          type="datetime-local"
          placeholder={tr('pages.tokens.expiredtime')}
        />
        <Input
          value={downstreamCreate.description}
          onChange={(e) => onChange((prev) => ({ ...prev, description: e.target.value }))}
          placeholder={tr('pages.settings.downstreamApiKeyModal.notes')}
        />
      </div>

      <div className="grid gap-2">
        <div className="text-xs text-muted-foreground">
          {tr('pages.settings.downstreamApiKeyModal.selectedmodel')} {downstreamCreate.selectedModels.length} {tr('pages.settings.downstreamApiKeyModal.selectedgroups')} {downstreamCreate.selectedGroupRouteIds.length} {tr('pages.accounts.model')}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void onOpenSelector()}>
            {tr('pages.settings.downstreamApiKeyModal.modelGroups')}
          </Button>
          {(downstreamCreate.selectedModels.length > 0 || downstreamCreate.selectedGroupRouteIds.length > 0) ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onChange((prev) => ({ ...prev, selectedModels: [], selectedGroupRouteIds: [] }))}
            >
              {tr('pages.settings.downstreamApiKeyModal.clearselect')}
            </Button>
          ) : null}
        </div>
      </div>
    </CenteredModal>
  );
}
