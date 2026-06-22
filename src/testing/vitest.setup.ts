import { afterEach, beforeEach, vi } from 'vitest';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('react-dom', async () => {
  const actual = await vi.importActual<typeof import('react-dom')>('react-dom');
  return {
    ...actual,
    createPortal: (node: unknown) => node,
  };
});

vi.mock('@radix-ui/react-checkbox', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  type CheckboxRootProps = {
    checked?: boolean | 'indeterminate';
    defaultChecked?: boolean;
    disabled?: boolean;
    onCheckedChange?: (checked: boolean | 'indeterminate') => void;
    onChange?: (event: React.ChangeEvent<HTMLInputElement>) => void;
    children?: React.ReactNode;
  } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'checked' | 'defaultChecked' | 'onChange' | 'children'>;

  const Root = React.forwardRef<HTMLInputElement, CheckboxRootProps>(({
    checked,
    defaultChecked,
    disabled,
    onCheckedChange,
    onChange,
    children: _children,
    ...props
  }, ref) => {
    const normalizedChecked = checked === 'indeterminate'
      ? false
      : Boolean(checked ?? defaultChecked ?? false);
    const state = checked === 'indeterminate' ? 'indeterminate' : (normalizedChecked ? 'checked' : 'unchecked');
    return React.createElement('input', {
      ...props,
      ref,
      type: 'checkbox',
      checked: normalizedChecked,
      disabled,
      'data-state': state,
      onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
        onChange?.(event);
        onCheckedChange?.(event.target.checked);
      },
    });
  });
  Root.displayName = 'Checkbox';

  const Indicator = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
    React.createElement('span', { ...props, ref })
  ));
  Indicator.displayName = 'CheckboxIndicator';

  return {
    Root,
    Indicator,
  };
});

vi.mock('@radix-ui/react-radio-group', async () => {
  const React = await vi.importActual<typeof import('react')>('react');

  type RadioGroupContextValue = {
    value?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
  };

  const RadioGroupContext = React.createContext<RadioGroupContextValue>({});

  type RootProps = {
    value?: string;
    defaultValue?: string;
    disabled?: boolean;
    onValueChange?: (value: string) => void;
    children?: React.ReactNode;
  } & React.HTMLAttributes<HTMLDivElement>;

  const Root = React.forwardRef<HTMLDivElement, RootProps>(({
    value,
    defaultValue,
    disabled,
    onValueChange,
    children,
    ...props
  }, ref) => {
    const selectedValue = value ?? defaultValue;
    return React.createElement(
      RadioGroupContext.Provider,
      { value: { value: selectedValue, disabled, onValueChange } },
      React.createElement('div', {
        ...props,
        ref,
        role: props.role ?? 'radiogroup',
        'data-disabled': disabled ? '' : undefined,
      }, children),
    );
  });
  Root.displayName = 'RadioGroup';

  type ItemProps = {
    value: string;
    disabled?: boolean;
    children?: React.ReactNode;
    onClick?: React.MouseEventHandler<HTMLButtonElement>;
  } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'value' | 'onClick' | 'children'>;

  const Item = React.forwardRef<HTMLButtonElement, ItemProps>(({
    value,
    disabled,
    children,
    onClick,
    ...props
  }, ref) => {
    const group = React.useContext(RadioGroupContext);
    const isDisabled = Boolean(disabled || group.disabled);
    const checked = group.value === value;
    return React.createElement('button', {
      ...props,
      ref,
      type: 'button',
      role: props.role ?? 'radio',
      value,
      disabled: isDisabled,
      'aria-checked': checked,
      'data-state': checked ? 'checked' : 'unchecked',
      'data-disabled': isDisabled ? '' : undefined,
      onClick: (event: React.MouseEvent<HTMLButtonElement>) => {
        onClick?.(event);
        if (!event.defaultPrevented && !isDisabled) {
          group.onValueChange?.(value);
        }
      },
    }, children);
  });
  Item.displayName = 'RadioGroupItem';

  const Indicator = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>((props, ref) => (
    React.createElement('span', { ...props, ref })
  ));
  Indicator.displayName = 'RadioGroupIndicator';

  return {
    Root,
    Item,
    Indicator,
  };
});

function mergeGlobalObject(name: 'document' | 'window', patch: Record<string, unknown>) {
  const current = (globalThis as Record<string, unknown>)[name] as Record<string, unknown> | undefined;
  const next = current ? Object.assign(current, patch) : patch;
  vi.stubGlobal(name, next);
}

function installBrowserTestSeams() {
  const HTMLSelectElementShim = class HTMLSelectElementShim {
    private currentValue = '';
    get value() {
      return this.currentValue;
    }
    set value(nextValue: string) {
      this.currentValue = String(nextValue);
    }
  };
  const EventShim = class EventShim {
    type: string;
    bubbles: boolean;
    constructor(type: string, init?: EventInit) {
      this.type = type;
      this.bubbles = Boolean(init?.bubbles);
    }
  };

  if (typeof globalThis.document === 'undefined') {
    vi.stubGlobal('document', {
    body: {
      style: {},
      appendChild: vi.fn(),
      removeChild: vi.fn(),
    },
    documentElement: {
      getAttribute: vi.fn(() => 'light'),
    },
    createEvent: vi.fn(() => ({})),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    } as unknown as Document);
  } else {
    const documentPatch: Record<string, unknown> = {};
    if (typeof document.createEvent !== 'function') {
      documentPatch.createEvent = vi.fn(() => ({}));
    }
    if (Object.keys(documentPatch).length > 0) {
      mergeGlobalObject('document', documentPatch);
    }
  }

  if (typeof globalThis.HTMLSelectElement === 'undefined') {
    vi.stubGlobal('HTMLSelectElement', HTMLSelectElementShim);
  }
  if (typeof globalThis.HTMLElement === 'undefined') {
    vi.stubGlobal('HTMLElement', class HTMLElementShim {});
  }
  if (typeof globalThis.Event === 'undefined') {
    vi.stubGlobal('Event', EventShim);
  }

  if (typeof globalThis.window === 'undefined') {
    vi.stubGlobal('window', {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    scrollTo: vi.fn(),
    setTimeout: globalThis.setTimeout.bind(globalThis),
    clearTimeout: globalThis.clearTimeout.bind(globalThis),
    requestAnimationFrame: (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 0) as unknown as number,
    cancelAnimationFrame: (id: number) => globalThis.clearTimeout(id),
    innerWidth: 1280,
    location: {
      reload: vi.fn(),
      assign: vi.fn(),
      replace: vi.fn(),
      href: 'http://localhost/',
      search: '',
      hash: '',
      pathname: '/',
      origin: 'http://localhost',
    },
    matchMedia: vi.fn(() => ({
      matches: false,
      media: '(min-width: 0px)',
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
    getComputedStyle: vi.fn(() => ({
      getPropertyValue: vi.fn(() => ''),
    })),
    HTMLSelectElement: (globalThis as { HTMLSelectElement?: unknown }).HTMLSelectElement || HTMLSelectElementShim,
    HTMLElement: (globalThis as { HTMLElement?: unknown }).HTMLElement || class HTMLElementShim {},
    Event: (globalThis as { Event?: unknown }).Event || EventShim,
    } as unknown as Window & typeof globalThis);
  } else {
    mergeGlobalObject('window', {
      addEventListener: typeof window.addEventListener === 'function' ? window.addEventListener.bind(window) : vi.fn(),
      removeEventListener: typeof window.removeEventListener === 'function' ? window.removeEventListener.bind(window) : vi.fn(),
      scrollTo: typeof window.scrollTo === 'function' ? window.scrollTo.bind(window) : vi.fn(),
      setTimeout: typeof window.setTimeout === 'function' ? window.setTimeout.bind(window) : globalThis.setTimeout.bind(globalThis),
      clearTimeout: typeof window.clearTimeout === 'function' ? window.clearTimeout.bind(window) : globalThis.clearTimeout.bind(globalThis),
      requestAnimationFrame: typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : ((callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 0) as unknown as number),
      cancelAnimationFrame: typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : ((id: number) => globalThis.clearTimeout(id)),
      matchMedia: typeof window.matchMedia === 'function'
        ? window.matchMedia.bind(window)
        : vi.fn(() => ({
          matches: false,
          media: '(min-width: 0px)',
          onchange: null,
          addListener: vi.fn(),
          removeListener: vi.fn(),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          dispatchEvent: vi.fn(),
        })),
      HTMLSelectElement: (window as unknown as { HTMLSelectElement?: unknown }).HTMLSelectElement
        || (globalThis as { HTMLSelectElement?: unknown }).HTMLSelectElement
        || HTMLSelectElementShim,
      HTMLElement: (window as unknown as { HTMLElement?: unknown }).HTMLElement
        || (globalThis as { HTMLElement?: unknown }).HTMLElement
        || class HTMLElementShim {},
      Event: (window as unknown as { Event?: unknown }).Event
        || (globalThis as { Event?: unknown }).Event
        || EventShim,
    });
  }

  if (typeof globalThis.requestAnimationFrame !== 'function') {
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => globalThis.setTimeout(() => callback(Date.now()), 0) as unknown as number);
  }
  if (typeof globalThis.cancelAnimationFrame !== 'function') {
    vi.stubGlobal('cancelAnimationFrame', (id: number) => globalThis.clearTimeout(id));
  }
  if (typeof globalThis.getComputedStyle !== 'function') {
    vi.stubGlobal('getComputedStyle', vi.fn(() => ({
      animationDuration: '0s',
      transitionDuration: '0s',
      getPropertyValue: vi.fn(() => ''),
    })));
  }
  if (typeof globalThis.ResizeObserver === 'undefined') {
    vi.stubGlobal('ResizeObserver', class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
  }
}

beforeEach(() => {
  installBrowserTestSeams();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  installBrowserTestSeams();
});
