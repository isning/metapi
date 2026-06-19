import type { ReactNode } from 'react';
import { Alert, AlertDescription } from './ui/alert/index.js';

type InfoNoteProps = {
  children: ReactNode;
  className?: string;
};

export default function InfoNote({ children, className }: InfoNoteProps) {
  return (
    <Alert className={className}>
      <AlertDescription>{children}</AlertDescription>
    </Alert>
  );
}
