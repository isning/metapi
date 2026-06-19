import { type CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '../../components/ui/button/index.js';

type SortableBucketSeparatorProps = {
  id: string;
  beforePriority: number;
  afterPriority: number;
  isSavingPriority: boolean;
};

export function SortableBucketSeparator({
  id,
  beforePriority,
  afterPriority,
  isSavingPriority,
}: SortableBucketSeparatorProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: isSavingPriority,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.8 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2.5 px-0.5 py-1 text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <Button
        variant="outline"
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={isSavingPriority}
        aria-label={`拖拽调整 P${beforePriority} / P${afterPriority} 分界线`}
        data-tooltip={`拖拽调整 P${beforePriority} / P${afterPriority} 分界线`}
      >
        <span>{`P${beforePriority}`}</span>
        <span className="text-[10px]">||</span>
        <span>{`P${afterPriority}`}</span>
      </Button>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
