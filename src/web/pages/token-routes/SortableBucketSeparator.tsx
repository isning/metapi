import { type CSSProperties } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { DragHandleButton } from './DragHandleButton.js';
import { tr } from '../../i18n.js';

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
  const label = tr('pages.tokenRoutes.sortableBucketSeparator.dragBoundary')
    .replace('{before}', String(beforePriority))
    .replace('{after}', String(afterPriority));

  return (
    <div ref={setNodeRef} style={style} className="flex items-center gap-2.5 px-0.5 py-1 text-muted-foreground">
      <div className="h-px flex-1 bg-border" />
      <DragHandleButton
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={isSavingPriority}
        aria-label={label}
        data-tooltip={label}
      >
        <span>{`P${beforePriority}`}</span>
        <span className="text-[10px]">||</span>
        <span>{`P${afterPriority}`}</span>
      </DragHandleButton>
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}
