import React from 'react';
import { Card } from './ui/card/index.js';

type MobileBatchBarProps = {
  info: React.ReactNode;
  children: React.ReactNode;
};

export default function MobileBatchBar({ info, children }: MobileBatchBarProps) {
  return (
    <Card className="fixed inset-x-3 bottom-3 z-50 flex flex-col gap-2 p-3">
      <span className="text-sm font-semibold">{info}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </Card>
  );
}
