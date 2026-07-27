import type { InboxDetailBlock, InboxItem } from '../shared/inbox.js';

type TranslateFn = (key: string) => string;

type InboxI18nBlock = Extract<InboxDetailBlock, { type: 'i18n' }>;

function isI18nBlock(block: InboxDetailBlock): block is InboxI18nBlock {
  return block.type === 'i18n';
}

function interpolate(template: string, params: Record<string, string | number | boolean | null | undefined>): string {
  return template.replace(/\{([a-zA-Z0-9_.-]+)\}/g, (match, key) => {
    const value = params[key];
    return value == null ? match : String(value);
  });
}

function buildTranslatedParams(block: InboxI18nBlock, t: TranslateFn) {
  const params: Record<string, string | number | boolean | null | undefined> = { ...(block.params || {}) };
  for (const [paramName, key] of Object.entries(block.paramKeys || {})) {
    params[paramName] = t(key);
  }
  return params;
}

function translateTemplate(key: string | undefined, block: InboxI18nBlock | null, t: TranslateFn): string | null {
  if (!key || !block) return null;
  return interpolate(t(key), buildTranslatedParams(block, t));
}

export function getInboxI18nBlock(item: Pick<InboxItem, 'details'>): InboxI18nBlock | null {
  return Array.isArray(item.details) ? item.details.find(isI18nBlock) || null : null;
}

export function getVisibleInboxDetails(item: Pick<InboxItem, 'details'>): InboxDetailBlock[] {
  return Array.isArray(item.details) ? item.details.filter((block) => !isI18nBlock(block)) : [];
}

export function translateInboxItem(item: InboxItem, t: TranslateFn) {
  const block = getInboxI18nBlock(item);
  const title = translateTemplate(block?.titleKey, block, t) || item.title;
  const summary = translateTemplate(block?.summaryKey || block?.messageKey, block, t) || item.summary;
  const message = translateTemplate(block?.messageKey, block, t) || item.message || summary;
  return {
    ...item,
    title,
    summary,
    message,
    details: getVisibleInboxDetails(item),
  };
}

export function translateDetailLabel(value: string | undefined, t: TranslateFn): string | undefined {
  return value ? t(value) : value;
}
