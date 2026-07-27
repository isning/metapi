import { Button } from '../../components/ui/button/index.js';
import ToneBadge from '../../components/ToneBadge.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import { cn } from '../../lib/utils.js';
import { tr } from '../../i18n.js';
export type UpdateCenterHistoryEntry = {
  revision?: string;
  updatedAt?: string | null;
  status?: string | null;
  description?: string | null;
  imageTag?: string | null;
  imageDigest?: string | null;
};

type UpdateCenterHistoryEntryCardProps = {
  entry: UpdateCenterHistoryEntry;
  currentRevision: string;
  helperHealthy: boolean;
  deploying: boolean;
  compact?: boolean;
  formatTaskTime: (value?: string | null) => string;
  formatImageTarget: (tag?: string | null, digest?: string | null) => string;
  onRollback: (revision: string) => void;
};

export default function UpdateCenterHistoryEntryCard({
  entry,
  currentRevision,
  helperHealthy,
  deploying,
  compact = false,
  formatTaskTime,
  formatImageTarget,
  onRollback,
}: UpdateCenterHistoryEntryCardProps) {
  const revision = String(entry?.revision || '').trim();
  const isCurrentRevision = revision && revision === currentRevision;

  return (
    <Card className={cn(isCurrentRevision && 'bg-muted')}>
      <CardContent className={cn('grid gap-1.5', compact ? 'p-2' : 'p-3')}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-sm font-semibold text-foreground">
          revision {revision || '-'}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {entry?.status ? <ToneBadge tone="-muted">{entry.status}</ToneBadge> : null}
            {isCurrentRevision ? <ToneBadge tone="-info">{tr('pages.helpers.updateCenterPresentation.currentlyRunning')}</ToneBadge> : null}
          </div>
        </div>
        <div className="font-mono text-sm font-semibold text-foreground">
          {formatImageTarget(entry?.imageTag, entry?.imageDigest) || tr('pages.settings.updateCenterHistoryEntryCard.notRecordedInfo')}
        </div>
        {entry?.description ? (
          <div className="text-xs leading-relaxed text-muted-foreground">
            {entry.description}
          </div>
        ) : null}
        <div className="text-xs leading-relaxed text-muted-foreground">
          {tr('pages.settings.updateCenterHistoryEntryCard.time')}{formatTaskTime(entry?.updatedAt)}
        </div>
        <div>
          <Button
            variant="outline"
            type="button"
            onClick={() => {
              if (isCurrentRevision) return;
              onRollback(revision);
            }}
            disabled={!helperHealthy || deploying || isCurrentRevision || !revision}
          >
            {tr('pages.settings.updateCenterHistoryEntryCard.revision')} {revision}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
