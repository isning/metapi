import CenteredModal from '../../components/CenteredModal.js';
import UpdateCenterHistoryEntryCard, { type UpdateCenterHistoryEntry } from './UpdateCenterHistoryEntryCard.js';
import { Button } from '../../components/ui/button/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';

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
      title="全部 revision"
      maxWidth={880}
      closeOnBackdrop
      closeOnEscape
      footer={(
        <Button variant="outline" type="button" onClick={onClose}>
          关闭
        </Button>
      )}
    >
      <div className="grid gap-3">
        <div className="text-xs leading-relaxed text-muted-foreground">
          这里保留 helper 读到的全部 Helm revision。默认列表只显示最近几条，弹窗里再展开全部回退记录，避免设置页被历史卡片拉得过长。
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
