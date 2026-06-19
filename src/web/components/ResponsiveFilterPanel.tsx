import React from 'react';
import MobileFilterSheet from './MobileFilterSheet.js';
import { Button } from './ui/button/index.js';

type ResponsiveFilterPanelProps = {
  isMobile: boolean;
  mobileOpen: boolean;
  onMobileOpen?: () => void;
  onMobileClose: () => void;
  mobileTitle: string;
  mobileContent: React.ReactNode;
  desktopContent?: React.ReactNode;
  mobileTrigger?: React.ReactNode;
  mobileTriggerLabel?: string;
  mobileTriggerWrapperClassName?: string;
  mobileTriggerWrapperStyle?: React.CSSProperties;
};

export default function ResponsiveFilterPanel({
  isMobile,
  mobileOpen,
  onMobileOpen,
  onMobileClose,
  mobileTitle,
  mobileContent,
  desktopContent = null,
  mobileTrigger,
  mobileTriggerLabel = '筛选',
  mobileTriggerWrapperClassName = 'mb-3 flex justify-end',
  mobileTriggerWrapperStyle,
}: ResponsiveFilterPanelProps) {
  if (!isMobile) {
    return <>{desktopContent}</>;
  }

  return (
    <>
      {mobileTrigger ?? (onMobileOpen ? (
        <div className={mobileTriggerWrapperClassName} style={mobileTriggerWrapperStyle}>
          <Button
            type="button"
            variant="outline"
            onClick={onMobileOpen}
          >
            {mobileTriggerLabel}
          </Button>
        </div>
      ) : null)}
      <MobileFilterSheet open={mobileOpen} onClose={onMobileClose} title={mobileTitle}>
        {mobileContent}
      </MobileFilterSheet>
    </>
  );
}
