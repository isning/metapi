import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Sites centered modal adoption', () => {
  it('uses CenteredModal for add/edit site flows instead of inline form panels', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Sites.tsx'), 'utf8');

    expect(source).toContain("import CenteredModal from '../components/CenteredModal.js'");
    expect(source).toContain('<CenteredModal');
    expect(source).not.toContain('editorPresence.shouldRender && activeEditor && (');
  });

  it('uses API request wording for dedicated site endpoint copy', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Sites.tsx'), 'utf8');

    expect(source).toContain("tr('pages.sites.apiRequest2')");
    expect(source).toContain("tr('pages.sites.addApi')");
    expect(source).toContain("tr('pages.sites.sitesUrlSignSignHttpsNihCc')");
    expect(source).toContain("tr('pages.sites.apiRequestHttpsApiNihCc')");
    expect(source).toContain("label={tr('pages.sites.apiRequest3')}");
    expect(source).toContain('function SiteApiEndpointSummaryBadge');
    expect(source).toContain('<SiteApiEndpointSummaryBadge site={site} />');
    expect(source).toContain('<span className="shrink-0">{tr(\'pages.sites.api\')}</span>');
    expect(source).toContain('<span className="min-w-0 truncate">{summary}</span>');
    expect(source).not.toContain('站点 URL（面板/登录/签到地址，如 https://console.example.com）');
    expect(source).not.toContain('API 请求地址（如 https://api.example.com）');
    expect(source).not.toContain('AI 请求地址池');
    expect(source).not.toContain('+ 添加 AI 地址');
    expect(source).not.toContain('label="AI 请求地址"');
    expect(source).not.toContain('AI 地址: {buildSiteApiEndpointSummary(site)}');
  });

  it('uses the shared configuration section wrapper for site editor settings', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/web/pages/Sites.tsx'), 'utf8');

    expect(source).toContain("import { ConfigSection, ConfigSectionItem } from '../components/ConfigSection.js'");
    for (const titleKey of [
      'pages.sites.apiRequest2',
      'pages.sites.sitescustomRequest',
      'pages.sites.disabledmodelManagement',
      'pages.sites.refreshAutomaticRequest',
    ]) {
      expect(source).toContain(`title={tr('${titleKey}')}`);
    }
    expect(source).not.toContain('flex flex-col gap-2.5 rounded-lg border bg-muted p-3');
  });
});
