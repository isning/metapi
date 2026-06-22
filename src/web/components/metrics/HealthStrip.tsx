import * as Tooltip from '../ui/tooltip/index.js';

export type HealthBucket = {
  id?: string;
  label: string;
  value: number | null;
  status?: 'success' | 'warning' | 'error' | 'unknown';
};

function resolveStatus(value: number | null, status?: HealthBucket['status']) {
  if (status) return status;
  if (value == null || !Number.isFinite(value)) return 'unknown';
  if (value >= 99) return 'success';
  if (value >= 90) return 'warning';
  return 'error';
}

const bucketClassName: Record<NonNullable<HealthBucket['status']>, string> = {
  success: 'bg-primary',
  warning: 'bg-warning',
  error: 'bg-destructive',
  unknown: 'bg-muted',
};

function resolveHeightClassName(value: number | null) {
  if (value == null || !Number.isFinite(value)) return 'h-2';
  if (value >= 99) return 'h-4';
  if (value >= 95) return 'h-3.5';
  if (value >= 90) return 'h-3';
  if (value >= 75) return 'h-2.5';
  return 'h-1.5';
}

type HealthStripProps = {
  buckets: HealthBucket[];
  ariaLabel: string;
};

export default function HealthStrip({ buckets, ariaLabel }: HealthStripProps) {
  if (buckets.length === 0) {
    return <div className="text-xs text-muted-foreground">No history</div>;
  }

  return (
    <Tooltip.Provider>
      <div className="flex items-end gap-px" role="img" aria-label={ariaLabel}>
        {buckets.map((bucket, index) => {
          const status = resolveStatus(bucket.value, bucket.status);
          return (
            <Tooltip.Root key={bucket.id ?? `${bucket.label}-${index}`}>
              <Tooltip.Trigger asChild>
                <span className="flex h-4 w-1 items-end rounded-sm">
                  <span
                    className={`block w-full rounded-sm ${bucketClassName[status]} ${resolveHeightClassName(bucket.value)}`}
                  />
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content>
                {bucket.label}: {bucket.value == null ? 'unknown' : `${bucket.value.toFixed(1)}%`}
              </Tooltip.Content>
            </Tooltip.Root>
          );
        })}
      </div>
    </Tooltip.Provider>
  );
}
