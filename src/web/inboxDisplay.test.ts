import { describe, expect, it } from 'vitest';

import type { InboxItem } from '../shared/inbox.js';
import { translateText } from './i18n.js';
import { translateInboxItem } from './inboxDisplay.js';

const baseEvent: InboxItem = {
  id: 1,
  scope: 'notification',
  category: 'system',
  severity: 'info',
  type: 'status',
  level: 'info',
  title: '刷新模型并重建路由 已完成',
  summary: '刷新模型并重建路由 已完成',
  message: '刷新模型并重建路由 已完成',
  subject: { type: 'task', id: 'task-1', label: '刷新模型并重建路由 已完成' },
  details: [
    {
      type: 'i18n',
      titleKey: 'backgroundTask.lifecycle.completedTitle',
      messageKey: 'backgroundTask.message.refreshModelsAndRebuildRoutes.completedWithRebuild',
      params: {
        createdRoutes: 117,
        removedRoutes: 0,
        createdCandidates: 174,
        removedCandidates: 0,
      },
      paramKeys: {
        title: 'backgroundTask.task.refreshModelsAndRebuildRoutes',
      },
    },
    {
      type: 'kv',
      title: 'backgroundTask.details.taskInfo',
      rows: [{ label: 'backgroundTask.details.status', value: 'succeeded' }],
    },
  ],
  actions: [],
  state: 'open',
  read: false,
  occurrenceCount: 1,
};

describe('translateInboxItem', () => {
  it('renders persisted event i18n metadata with the current frontend language', () => {
    const zh = translateInboxItem(baseEvent, (key) => translateText(key, 'zh'));
    expect(zh.title).toBe('刷新模型并重建路由 已完成');
    expect(zh.summary).toBe('刷新模型并重建路由完成：新增路由 117，移除旧路由 0，新增候选 174，移除候选 0');

    const en = translateInboxItem(baseEvent, (key) => translateText(key, 'en'));
    expect(en.title).toBe('Refresh models and rebuild routes completed');
    expect(en.summary).toBe('Refresh models and rebuild routes completed: 117 routes added, 0 stale routes removed, 174 candidates added, 0 candidates removed');
  });

  it('renders backup import event i18n metadata with structured counts', () => {
    const event: InboxItem = {
      ...baseEvent,
      type: 'backup_import',
      title: '备份导入已完成',
      summary: '备份导入已完成',
      message: '备份导入已完成',
      details: [
        {
          type: 'i18n',
          titleKey: 'backupImport.notification.completedWithWarningsTitle',
          messageKey: 'backupImport.notification.completedWithWarningsMessage',
          params: {
            sites: 2,
            accounts: 3,
            apiKeyConnections: 4,
            settings: 5,
            warnings: 1,
          },
          paramKeys: {
            source: 'backupImport.source.manual',
          },
        },
      ],
    };

    const zh = translateInboxItem(event, (key) => translateText(key, 'zh'));
    expect(zh.title).toBe('手动备份导入已完成，存在提示');
    expect(zh.summary).toBe('手动备份导入完成：站点 2，账号 3，API Key 连接 4，设置 5，提示 1');

    const en = translateInboxItem(event, (key) => translateText(key, 'en'));
    expect(en.title).toBe('Manual backup import completed with notices');
    expect(en.summary).toBe('Manual backup import completed: 2 sites, 3 accounts, 4 API key connections, 5 settings, 1 notices');
  });
});
