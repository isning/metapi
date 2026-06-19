import { Check, ChevronsUpDown } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { Button } from './ui/button/index.js';
import { Input } from './ui/input/index.js';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command/index.js';
import * as Popover from './ui/popover/index.js';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select/index.js';
import { cn } from '../lib/utils.js';

const EMPTY_VALUE_SENTINEL = '__metapi_empty_select_value__';

type ModernSelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  iconNode?: ReactNode;
  iconUrl?: string;
  iconText?: string;
};

type ModernSelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: ModernSelectOption[];
  'data-testid'?: string;
  placeholder?: string;
  disabled?: boolean;
  emptyLabel?: string;
  menuMaxHeight?: number;
  className?: string;
  size?: 'md' | 'sm';
  searchable?: boolean;
  searchPlaceholder?: string;
};

export default function ModernSelect({
  value,
  onChange,
  options,
  'data-testid': dataTestId,
  placeholder = 'Select',
  disabled = false,
  emptyLabel = 'No options',
  menuMaxHeight = 280,
  className = '',
  size = 'md',
  searchable = false,
  searchPlaceholder = 'Search...',
}: ModernSelectProps) {
  if (shouldRenderInlineSelectFallback()) {
    return (
      <FallbackSelect
        value={value}
        onChange={onChange}
        options={options}
        dataTestId={dataTestId}
        placeholder={placeholder}
        disabled={disabled}
        emptyLabel={emptyLabel}
        className={className}
        size={size}
        searchable={searchable}
        searchPlaceholder={searchPlaceholder}
      />
    );
  }

  const selected = useMemo(
    () => options.find((item) => item.value === value),
    [options, value],
  );

  if (searchable) {
    return (
      <SearchableSelect
        value={value}
        selected={selected}
        onChange={onChange}
        options={options}
        dataTestId={dataTestId}
        placeholder={placeholder}
        disabled={disabled}
        emptyLabel={emptyLabel}
        menuMaxHeight={menuMaxHeight}
        className={className}
        size={size}
        searchPlaceholder={searchPlaceholder}
      />
    );
  }

  return (
    <Select value={encodeSelectValue(value)} onValueChange={(nextValue) => onChange(decodeSelectValue(nextValue))} disabled={disabled}>
      <SelectTrigger data-testid={dataTestId} className={cn(size === 'sm' && 'h-8 text-xs', className)}>
        <SelectValue placeholder={placeholder}>
          {selected ? <SelectOptionContent item={selected} /> : null}
        </SelectValue>
      </SelectTrigger>
      <SelectContent style={{ maxHeight: menuMaxHeight }}>
        {options.length === 0 ? (
          <div className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
        ) : options.map((item) => (
          <SelectItem key={item.value} value={encodeSelectValue(item.value)} disabled={item.disabled}>
            <SelectOptionContent item={item} />
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function shouldRenderInlineSelectFallback() {
  return typeof document === 'undefined'
    || !document.body
    || typeof document.body.querySelector !== 'function';
}

function FallbackSelect({
  value,
  onChange,
  options,
  dataTestId,
  placeholder,
  disabled,
  emptyLabel,
  className,
  size,
  searchable,
  searchPlaceholder,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ModernSelectOption[];
  dataTestId?: string;
  placeholder: string;
  disabled: boolean;
  emptyLabel: string;
  className: string;
  size: 'md' | 'sm';
  searchable: boolean;
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = useMemo(
    () => options.find((item) => item.value === value),
    [options, value],
  );
  const visibleOptions = useMemo(() => {
    if (!searchable) return options;
    const query = search.trim().toLowerCase();
    if (!query) return options;
    return options.filter((item) => (
      `${item.label} ${item.value} ${item.description || ''}`.toLowerCase().includes(query)
    ));
  }, [options, search, searchable]);

  return (
    <div className={cn('grid gap-1', className)} data-testid={dataTestId}>
      <Button
        type="button"
        variant="outline"
        size={size === 'sm' ? 'sm' : 'default'}
        role="combobox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className="w-full justify-between font-normal"
      >
        <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
          {selected ? <SelectOptionContent item={selected} /> : placeholder}
        </span>
        <ChevronsUpDown className="shrink-0 opacity-50" />
      </Button>
      {open ? (
        <div className="rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {searchable ? (
            <Input
              className="h-8"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          ) : null}
          {visibleOptions.length === 0 ? (
            <div className="px-2 py-6 text-center text-sm text-muted-foreground">{emptyLabel}</div>
          ) : visibleOptions.map((item) => (
            <Button
              key={item.value}
              type="button"
              variant="ghost"
              role="option"
              disabled={item.disabled}
              className="w-full justify-start"
              onClick={() => {
                if (item.disabled) return;
                onChange(item.value);
                setOpen(false);
              }}
            >
              <Check className={cn('shrink-0', item.value === value ? 'opacity-100' : 'opacity-0')} />
              <SelectOptionContent item={item} />
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function encodeSelectValue(value: string) {
  return value === '' ? EMPTY_VALUE_SENTINEL : value;
}

function decodeSelectValue(value: string) {
  return value === EMPTY_VALUE_SENTINEL ? '' : value;
}

function SearchableSelect({
  value,
  selected,
  onChange,
  options,
  dataTestId,
  placeholder,
  disabled,
  emptyLabel,
  menuMaxHeight,
  className,
  size,
  searchPlaceholder,
}: {
  value: string;
  selected: ModernSelectOption | undefined;
  onChange: (value: string) => void;
  options: ModernSelectOption[];
  dataTestId?: string;
  placeholder: string;
  disabled: boolean;
  emptyLabel: string;
  menuMaxHeight: number;
  className: string;
  size: 'md' | 'sm';
  searchPlaceholder: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          data-testid={dataTestId}
          className={cn('w-full justify-between font-normal', size === 'sm' && 'h-8 text-xs', className)}
        >
          <span className={cn('min-w-0 truncate', !selected && 'text-muted-foreground')}>
            {selected ? <SelectOptionContent item={selected} /> : placeholder}
          </span>
          <ChevronsUpDown className="shrink-0 opacity-50" />
        </Button>
      </Popover.Trigger>
      <Popover.Content className="w-[var(--radix-popover-trigger-width)] p-0" align="start" style={{ maxHeight: menuMaxHeight }}>
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyLabel}</CommandEmpty>
            <CommandGroup>
              {options.map((item) => (
                <CommandItem
                  key={item.value}
                  value={`${item.label} ${item.value} ${item.description || ''}`}
                  disabled={item.disabled}
                  onSelect={() => {
                    if (item.disabled) return;
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  <Check className={cn('shrink-0', item.value === value ? 'opacity-100' : 'opacity-0')} />
                  <SelectOptionContent item={item} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </Popover.Content>
    </Popover.Root>
  );
}

function SelectOptionContent({ item }: { item: ModernSelectOption }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      {item.iconNode ? item.iconNode : null}
      {!item.iconNode && item.iconUrl ? <img className="size-4 shrink-0 rounded-sm" src={item.iconUrl} alt="" loading="lazy" /> : null}
      {!item.iconNode && !item.iconUrl && item.iconText ? (
        <span className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm border text-[10px]">
          {item.iconText}
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">
        <span className="block truncate">{item.label}</span>
        {item.description ? <span className="block truncate text-xs text-muted-foreground">{item.description}</span> : null}
      </span>
    </span>
  );
}
