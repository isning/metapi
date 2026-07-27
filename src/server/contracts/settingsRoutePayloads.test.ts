import { describe, expect, it } from 'vitest';
import {
  parseBackupImportPayload,
  parseBackupWebdavConfigPayload,
  parseBackupWebdavExportPayload,
  parseDatabaseMigrationPayload,
  parseRuntimeSettingsPayload,
  parseSystemProxyTestPayload,
} from './settingsRoutePayloads.js';

describe('settings route payload contracts', () => {
  it('accepts runtime, proxy, database, and backup payloads', () => {
    expect(parseRuntimeSettingsPayload({
      modelAvailabilityProbeEnabled: true,
      webhookEnabled: false,
      barkEnabled: true,
      serverChanEnabled: false,
      telegramEnabled: true,
      telegramUseSystemProxy: false,
      smtpEnabled: true,
      smtpSecure: false,
      logCleanupUsageLogsEnabled: true,
      logCleanupProgramLogsEnabled: false,
      extra: 'kept',
    })).toMatchObject({ success: true });
    expect(parseSystemProxyTestPayload(undefined)).toEqual({ success: true, data: {} });
    expect(parseSystemProxyTestPayload({ proxyUrl: 'http://127.0.0.1:7890' })).toEqual({
      success: true,
      data: { proxyUrl: 'http://127.0.0.1:7890' },
    });
    expect(parseDatabaseMigrationPayload({
      dialect: 'postgres',
      connectionString: 'postgres://localhost/db',
      overwrite: true,
      ssl: false,
    })).toMatchObject({ success: true });
    expect(parseBackupWebdavConfigPayload({ enabled: true, exportType: 'accounts' })).toEqual({
      success: true,
      data: { enabled: true, exportType: 'accounts' },
    });
    expect(parseBackupWebdavExportPayload({ type: 'preferences' })).toEqual({
      success: true,
      data: { type: 'preferences' },
    });
    expect(parseBackupImportPayload({ data: { version: 1 } })).toEqual({
      success: true,
      data: { data: { version: 1 } },
    });
  });

  it('returns field-specific validation messages', () => {
    const cases: Array<[string, () => unknown, string]> = [
      ['webhookEnabled', () => parseRuntimeSettingsPayload({ webhookEnabled: 'yes' }), 'Webhook 开关格式无效：需要 boolean'],
      ['modelAvailabilityProbeEnabled', () => parseRuntimeSettingsPayload({ modelAvailabilityProbeEnabled: 'yes' }), '批量测活开关格式无效：需要 boolean'],
      ['barkEnabled', () => parseRuntimeSettingsPayload({ barkEnabled: 'yes' }), 'Bark 开关格式无效：需要 boolean'],
      ['serverChanEnabled', () => parseRuntimeSettingsPayload({ serverChanEnabled: 'yes' }), 'Server 酱开关格式无效：需要 boolean'],
      ['telegramEnabled', () => parseRuntimeSettingsPayload({ telegramEnabled: 'yes' }), 'Telegram 开关格式无效：需要 boolean'],
      ['telegramUseSystemProxy', () => parseRuntimeSettingsPayload({ telegramUseSystemProxy: 'yes' }), 'Telegram 使用系统代理格式无效：需要 boolean'],
      ['smtpEnabled', () => parseRuntimeSettingsPayload({ smtpEnabled: 'yes' }), 'SMTP 开关格式无效：需要 boolean'],
      ['smtpSecure', () => parseRuntimeSettingsPayload({ smtpSecure: 'yes' }), 'SMTP 安全连接格式无效：需要 boolean'],
      ['logCleanupUsageLogsEnabled', () => parseRuntimeSettingsPayload({ logCleanupUsageLogsEnabled: 'yes' }), '自动清理使用日志格式无效：需要 boolean'],
      ['logCleanupProgramLogsEnabled', () => parseRuntimeSettingsPayload({ logCleanupProgramLogsEnabled: 'yes' }), '自动清理程序日志格式无效：需要 boolean'],
      ['proxyUrl', () => parseSystemProxyTestPayload({ proxyUrl: 1 }), '系统代理地址格式无效：需要 string'],
      ['dialect', () => parseDatabaseMigrationPayload({ dialect: 'mssql', connectionString: 'x' }), 'Invalid dialect. Expected sqlite/mysql/postgres.'],
      ['connectionString', () => parseDatabaseMigrationPayload({ dialect: 'sqlite', connectionString: '   ' }), 'Invalid connectionString. Expected non-empty string.'],
      ['overwrite', () => parseDatabaseMigrationPayload({ dialect: 'sqlite', connectionString: 'x', overwrite: 'yes' }), 'Invalid overwrite. Expected boolean.'],
      ['ssl', () => parseDatabaseMigrationPayload({ dialect: 'sqlite', connectionString: 'x', ssl: 'yes' }), 'Invalid ssl. Expected boolean.'],
      ['exportType', () => parseBackupWebdavConfigPayload({ exportType: 'logs' }), 'Invalid exportType. Expected all/accounts/preferences.'],
      ['type', () => parseBackupWebdavExportPayload({ type: 'logs' }), 'Invalid type. Expected all/accounts/preferences.'],
      ['data', () => parseBackupImportPayload({ data: null }), '导入数据格式错误：需要 JSON 对象'],
    ];

    for (const [name, parse, error] of cases) {
      expect(parse(), name).toEqual({ success: false, error });
    }
  });
});
