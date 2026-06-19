export const overlayMotionClassName = [
  'shadcn-overlay-motion',
].join(' ');

export const centeredContentMotionClassName = [
  'shadcn-centered-motion',
].join(' ');

export const popoverMotionClassName = [
  'data-[state=open]:animate-in',
  'data-[state=closed]:animate-out',
  'data-[state=open]:fade-in-0',
  'data-[state=closed]:fade-out-0',
  'data-[state=open]:zoom-in-95',
  'data-[state=closed]:zoom-out-95',
].join(' ');

export const sheetSideMotionClassName: Record<'top' | 'right' | 'bottom' | 'left', string> = {
  top: 'shadcn-sheet-motion shadcn-sheet-top',
  right: 'shadcn-sheet-motion shadcn-sheet-right',
  bottom: 'shadcn-sheet-motion shadcn-sheet-bottom',
  left: 'shadcn-sheet-motion shadcn-sheet-left',
};
