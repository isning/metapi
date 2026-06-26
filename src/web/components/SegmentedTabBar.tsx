import { useRef, type ReactNode } from 'react';
import { Button } from './ui/button/index.js';
import { ButtonGroup } from './ui/button-group/index.js';
import ToneBadge from './ToneBadge.js';
import { cn } from '../lib/utils.js';

export type SegmentedTabItem<TValue extends string> = {
  value: TValue;
  label: ReactNode;
  icon?: ReactNode;
  count?: number;
  disabled?: boolean;
};

type SegmentedTabBarProps<TValue extends string> = {
  value: TValue;
  items: Array<SegmentedTabItem<TValue>>;
  onValueChange: (value: TValue) => void;
  className?: string;
  buttonClassName?: string;
  ariaLabel?: string;
  mouseDownActivation?: boolean;
};

export default function SegmentedTabBar<TValue extends string>({
  value,
  items,
  onValueChange,
  className,
  buttonClassName,
  ariaLabel,
  mouseDownActivation = false,
}: SegmentedTabBarProps<TValue>) {
  const lastActivationRef = useRef<{ value: TValue; at: number } | null>(null);
  const activate = (nextValue: TValue) => {
    lastActivationRef.current = { value: nextValue, at: Date.now() };
    onValueChange(nextValue);
  };
  return (
    <ButtonGroup className={cn('max-w-full overflow-x-auto', className)} role="tablist" aria-label={ariaLabel}>
      {items.map((item) => {
        const active = item.value === value;
        return (
          <Button
            key={item.value}
            type="button"
            role="tab"
            value={item.value}
            variant={active ? 'secondary' : 'outline'}
            className={cn('shrink-0', buttonClassName)}
            onClick={() => {
              const last = lastActivationRef.current;
              if (last?.value === item.value && Date.now() - last.at < 250) return;
              activate(item.value);
            }}
            onMouseDown={(event) => {
              if (!mouseDownActivation) return;
              if (event.button !== 0 || event.ctrlKey || event.defaultPrevented) return;
              const last = lastActivationRef.current;
              if (last?.value === item.value && Date.now() - last.at < 250) return;
              activate(item.value);
            }}
            disabled={item.disabled}
            aria-pressed={active}
            aria-selected={active}
          >
            {item.icon}
            {item.label}
            {typeof item.count === 'number' ? (
              <>
                {' '}
                <ToneBadge tone="-muted" className="ml-1 h-5 px-1.5 tabular-nums">
                  {item.count}
                </ToneBadge>
              </>
            ) : null}
          </Button>
        );
      })}
    </ButtonGroup>
  );
}
