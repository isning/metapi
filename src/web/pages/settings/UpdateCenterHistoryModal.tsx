import CenteredModal from '../../components/CenteredModal.js';
import UpdateCenterHistoryEntryCard, { type UpdateCenterHistoryEntry } from './UpdateCenterHistoryEntryCard.js';
import { Button } from '../../components/ui/button/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';

import { tr } from '../../i18n.js';
type UpdateCenterHistoryModalProps = {
  open: boolean;
  helperHealthy: boolean;
  deploying: boolean;
  currentRevision: string;
  history: UpdateCenterHistoryEntry[];
  formatTaskTime: (value?: string | null) => string;
  formatImageTarget: (tag?: string | null, digest?: string | null) => string;
  onClose: () => void;
  onRollback: (revision: string) => void;
};

export default function UpdateCenterHistoryModal({
  open,
  helperHealthy,
  deploying,
  currentRevision,
  history,
  formatTaskTime,
  formatImageTarget,
  onClose,
  onRollback,
}: UpdateCenterHistoryModalProps) {
  return (
    <CenteredModal
      open={open}
      onClose={onClose}
      title={tr('pages.settings.updateCenterHistoryModal.allRevision')}
      maxWidth={880}
      closeOnBackdrop
      closeOnEscape
      footer={(
        <Button variant="outline" type="button" onClick={onClose}>
          {tr('pages.accounts.close')}
        </Button>
      )}
    >
      <div className="grid gap-3">
        <div className="text-xs leading-relaxed text-muted-foreground">
          {tr('pages.settings.updateCenterHistoryModal.helperAllHelmRevisionDefaultItemsExpandall')}
        </div>
        <ScrollArea className="max-h-[520px] pr-1">
          <div className="grid gap-3">
          {history.map((entry) => {
            const revision = String(entry?.revision || '').trim();
            return (
              <UpdateCenterHistoryEntryCard
                key={revision || 'unknown-revision-modal'}
                entry={entry}
                currentRevision={currentRevision}
                helperHealthy={helperHealthy}
                deploying={deploying}
                formatTaskTime={formatTaskTime}
                formatImageTarget={formatImageTarget}
                onRollback={onRollback}
              />
            );
          })}
          </div>
        </ScrollArea>
      </div>
    </CenteredModal>
  );
}
