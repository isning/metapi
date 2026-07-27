import { Search } from 'lucide-react';
import { Input, type InputProps } from './ui/input/index.js';
import { cn } from '../lib/utils.js';

type SearchInputProps = Omit<InputProps, 'type'>;

export default function SearchInput({ className, ...props }: SearchInputProps) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" className="pl-9" {...props} />
    </div>
  );
}
