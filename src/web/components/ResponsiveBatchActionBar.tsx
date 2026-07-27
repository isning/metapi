import React from 'react';
import MobileBatchBar from './MobileBatchBar.js';
import { Card } from './ui/card/index.js';

type ResponsiveBatchActionBarProps = {
  isMobile: boolean;
  info: React.ReactNode;
  children: React.ReactNode;
};

export default function ResponsiveBatchActionBar({
  isMobile,
  info,
  children,
}: ResponsiveBatchActionBarProps) {
  if (isMobile) {
    return <MobileBatchBar info={info}>{children}</MobileBatchBar>;
  }

  return (
    <Card className="mb-3 flex flex-wrap items-center gap-2 p-3">
      <span className="text-sm font-semibold">{info}</span>
      {children}
    </Card>
  );
}
