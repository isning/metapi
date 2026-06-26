import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Label } from '../../components/ui/label/index.js';
import { Switch } from '../../components/ui/switch/index.js';
import { cn } from '../../lib/utils.js';

export function SettingsCard({
  title,
  description,
  actions,
  dataSettingsCard,
  children,
  footer,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  dataSettingsCard?: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <Card className="overflow-hidden" data-settings-card={dataSettingsCard}>
      <CardHeader className="border-b bg-muted/20 px-4 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid min-w-0 gap-1">
            <CardTitle className="text-base">{title}</CardTitle>
            {description ? <CardDescription className="text-xs leading-relaxed">{description}</CardDescription> : null}
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
      </CardHeader>
      {children ? <CardContent className="grid gap-4 p-4">{children}</CardContent> : null}
      {footer ? <CardContent className="flex flex-wrap gap-2 px-4 pb-4 pt-0">{footer}</CardContent> : null}
    </Card>
  );
}

export function SettingsSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: ReactNode;
  description: ReactNode;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24">
      <div className="mb-3 flex min-w-0 flex-col gap-1">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-4">
        {children}
      </div>
    </section>
  );
}

export function SettingsQuickLink({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: ReactNode;
  title: ReactNode;
  description: ReactNode;
}) {
  return (
    <a
      href={href}
      className="group grid gap-2 rounded-md border bg-card p-3 text-card-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
    >
      <div className="flex items-center gap-2 text-sm font-semibold">
        <span className="grid size-8 place-items-center rounded-md border bg-background text-muted-foreground group-hover:bg-background/70">
          {icon}
        </span>
        {title}
      </div>
      <div className="text-xs leading-relaxed text-muted-foreground">
        {description}
      </div>
    </a>
  );
}

export function SettingsField({
  label,
  hint,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-2">
      <Label>{label}</Label>
      {children}
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function SettingsSubsection({
  title,
  description,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="grid gap-3 rounded-md border p-4">
      <div className="grid gap-1">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description ? (
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export function SettingsToggleRow({
  title,
  description,
  checked,
  onCheckedChange,
  control = 'checkbox',
  tone = 'default',
  disabled,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  control?: 'checkbox' | 'switch';
  tone?: 'default' | 'destructive';
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex items-start justify-between gap-3 rounded-md border p-4',
        tone === 'destructive' && 'border-destructive/30 bg-destructive/5',
        className,
      )}
    >
      <div className="grid min-w-0 gap-1">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        {description ? (
          <div className="text-xs leading-relaxed text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {control === 'switch' ? (
        <Switch
          className="mt-0.5 shrink-0"
          checked={checked}
          onCheckedChange={onCheckedChange}
          disabled={disabled}
          aria-label={typeof title === 'string' ? title : undefined}
        />
      ) : (
        <Checkbox
          className="mt-0.5 shrink-0"
          checked={checked}
          onCheckedChange={(nextChecked) => onCheckedChange(nextChecked === true)}
          disabled={disabled}
          aria-label={typeof title === 'string' ? title : undefined}
        />
      )}
    </div>
  );
}

export function SettingsCode({ children }: { children: ReactNode }) {
  return (
    <code className="block overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-sm text-muted-foreground">
      {children}
    </code>
  );
}
