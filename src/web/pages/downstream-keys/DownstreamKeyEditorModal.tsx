import React, { useEffect, useMemo, useState } from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import InfoNote from '../../components/InfoNote.js';
import SearchInput from '../../components/SearchInput.js';
import { generateDownstreamSkKey } from '../helpers/generateDownstreamSkKey.js';
import type { RouteSummaryRow } from '../token-routes/types.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import { Textarea } from '../../components/ui/textarea/index.js';
import { Input } from '../../components/ui/input/index.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { cn } from '../../lib/utils.js';
import {
  getRouteRequestedModelPattern,
  isExactModelPattern,
  isRouteBackendReferences,
  resolveRouteTitle,
} from '../token-routes/utils.js';

const PROXY_TOKEN_PREFIX = 'sk-';

export type DownstreamExcludedCredentialRef =
  | {
    kind: 'account_token';
    siteId: number;
    accountId: number;
    tokenId: number;
  }
  | {
    kind: 'default_api_key';
    siteId: number;
    accountId: number;
  };

export type DownstreamKeyEditorForm = {
  name: string;
  key: string;
  description: string;
  groupName: string;
  tags: string[];
  maxCost: string;
  maxRequests: string;
  expiresAt: string;
  enabled: boolean;
  selectedModels: string[];
  selectedGroupRouteIds: number[];
  siteWeightMultipliersText: string;
  excludedSiteIds: number[];
  excludedCredentialRefs: DownstreamExcludedCredentialRef[];
};

export type DownstreamSiteOption = {
  siteId: number;
  siteName: string;
  accountCount: number;
};

export type DownstreamCredentialOption = {
  key: string;
  ref: DownstreamExcludedCredentialRef;
  siteName: string;
  accountName: string;
  label: string;
  detail: string;
};

type RouteSelectorItem = Pick<RouteSummaryRow, 'id' | 'match' | 'backend' | 'presentation' | 'enabled'>;

function parseTagText(value: string): string[] {
  return value
    .split(/[\r\n,，]+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTags(values: string[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const normalized = value.slice(0, 32);
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    result.push(normalized);
    if (result.length >= 20) break;
  }
  return result;
}

function uniqStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function uniqIds(values: number[]): number[] {
  return [...new Set(values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0).map((value) => Math.trunc(value)))];
}

function isGroupRouteOption(route: RouteSelectorItem): boolean {
  return isRouteBackendReferences(route.backend) || !isExactModelPattern(getRouteRequestedModelPattern(route));
}

function routeTitle(route: RouteSelectorItem): string {
  return resolveRouteTitle(route);
}

function SelectableRow({
  checked,
  children,
  className,
}: {
  checked: boolean;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-sm',
        checked && 'bg-muted',
        className,
      )}
    >
      {children}
    </span>
  );
}

function buildExcludedCredentialRefKey(ref: DownstreamExcludedCredentialRef): string {
  return ref.kind === 'account_token'
    ? `${ref.kind}:${ref.siteId}:${ref.accountId}:${ref.tokenId}`
    : `${ref.kind}:${ref.siteId}:${ref.accountId}`;
}

function normalizeExcludedSiteIds(values: number[]): number[] {
  return uniqIds(values).sort((left, right) => left - right);
}

function normalizeExcludedCredentialRefs(values: DownstreamExcludedCredentialRef[]): DownstreamExcludedCredentialRef[] {
  const deduped = new Map<string, DownstreamExcludedCredentialRef>();
  for (const value of values) {
    if (!value || !Number.isFinite(value.siteId) || !Number.isFinite(value.accountId)) continue;
    if (value.kind === 'account_token') {
      if (!Number.isFinite(value.tokenId)) continue;
      const normalized: DownstreamExcludedCredentialRef = {
        kind: 'account_token',
        siteId: Math.trunc(value.siteId),
        accountId: Math.trunc(value.accountId),
        tokenId: Math.trunc(value.tokenId),
      };
      deduped.set(buildExcludedCredentialRefKey(normalized), normalized);
      continue;
    }
    const normalized: DownstreamExcludedCredentialRef = {
      kind: 'default_api_key',
      siteId: Math.trunc(value.siteId),
      accountId: Math.trunc(value.accountId),
    };
    deduped.set(buildExcludedCredentialRefKey(normalized), normalized);
  }
  return Array.from(deduped.values()).sort((left, right) => buildExcludedCredentialRefKey(left).localeCompare(buildExcludedCredentialRefKey(right)));
}

export function TagInput({
  tags,
  onChange,
  suggestions = [],
  placeholder,
}: {
  tags: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
}) {
  const [draft, setDraft] = useState('');

  useEffect(() => {
    setDraft('');
  }, [tags.length]);

  const commitDraft = () => {
    const nextTags = normalizeTags([...tags, ...parseTagText(draft)]);
    if (nextTags.length !== tags.length) {
      onChange(nextTags);
    }
    setDraft('');
  };

  const removeTag = (target: string) => {
    onChange(tags.filter((tag) => tag !== target));
  };

  const suggestionPool = suggestions.filter((tag) => !tags.some((current) => current.toLowerCase() === tag.toLowerCase())).slice(0, 12);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 rounded-lg border bg-muted p-2.5">
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <Button
              key={tag}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => removeTag(tag)}
              title={`移除 ${tag}`}
            >
              <span>{tag}</span>
              <span aria-hidden="true">×</span>
            </Button>
          ))}
        </div>
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              commitDraft();
            } else if (e.key === 'Backspace' && !draft && tags.length > 0) {
              e.preventDefault();
              onChange(tags.slice(0, -1));
            }
          }}
          placeholder={placeholder || '输入标签后按回车或逗号'}
        />
      </div>
      {suggestionPool.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {suggestionPool.map((tag) => (
            <Button variant="outline"
              key={tag}
              type="button"
             
             
              onClick={() => onChange(normalizeTags([...tags, tag]))}
            >
              {tag}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function DownstreamKeyEditorModal({
  open,
  editingItem,
  form,
  onChange,
  onClose,
  onSave,
  saving,
  routeOptions,
  groupSuggestions,
  tagSuggestions,
  exclusionSourceLoading,
  siteOptions,
  credentialOptions,
}: {
  open: boolean;
  editingItem: { id: number } | null;
  form: DownstreamKeyEditorForm;
  onChange: (updater: (prev: DownstreamKeyEditorForm) => DownstreamKeyEditorForm) => void;
  onClose: () => void;
  onSave: () => void;
  saving: boolean;
  routeOptions: RouteSelectorItem[];
  groupSuggestions: string[];
  tagSuggestions: string[];
  exclusionSourceLoading: boolean;
  siteOptions: DownstreamSiteOption[];
  credentialOptions: DownstreamCredentialOption[];
}) {
  const [modelSearch, setModelSearch] = useState('');
  const [groupSearch, setGroupSearch] = useState('');
  const [siteSearch, setSiteSearch] = useState('');
  const [credentialSearch, setCredentialSearch] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    if (!open) {
      setModelSearch('');
      setGroupSearch('');
      setSiteSearch('');
      setCredentialSearch('');
      setAdvancedOpen(false);
    }
  }, [open]);

  const exactModels = useMemo(
    () => uniqStrings(routeOptions
      .filter((item) => !isRouteBackendReferences(item.backend) && isExactModelPattern(getRouteRequestedModelPattern(item)))
      .map((item) => getRouteRequestedModelPattern(item)))
      .sort((a, b) => a.localeCompare(b)),
    [routeOptions],
  );
  const groupRouteOptions = useMemo(
    () => routeOptions.filter(isGroupRouteOption),
    [routeOptions],
  );
  const validGroupRouteIdSet = useMemo(
    () => new Set(groupRouteOptions.map((route) => route.id)),
    [groupRouteOptions],
  );
  const normalizedSelectedGroupRouteIds = useMemo(
    () => uniqIds(form.selectedGroupRouteIds.filter((id) => validGroupRouteIdSet.has(id))),
    [form.selectedGroupRouteIds, validGroupRouteIdSet],
  );

  const filteredModels = useMemo(() => {
    const keyword = modelSearch.trim().toLowerCase();
    if (!keyword) return exactModels;
    return exactModels.filter((model) => model.toLowerCase().includes(keyword));
  }, [exactModels, modelSearch]);

  const filteredGroups = useMemo(() => {
    const keyword = groupSearch.trim().toLowerCase();
    if (!keyword) return groupRouteOptions;
    return groupRouteOptions.filter((route) => {
      const title = routeTitle(route).toLowerCase();
      return title.includes(keyword) || getRouteRequestedModelPattern(route).toLowerCase().includes(keyword);
    });
  }, [groupRouteOptions, groupSearch]);

  const filteredSites = useMemo(() => {
    const keyword = siteSearch.trim().toLowerCase();
    if (!keyword) return siteOptions;
    return siteOptions.filter((site) => site.siteName.toLowerCase().includes(keyword));
  }, [siteOptions, siteSearch]);

  const filteredCredentials = useMemo(() => {
    const keyword = credentialSearch.trim().toLowerCase();
    if (!keyword) return credentialOptions;
    return credentialOptions.filter((item) => (
      item.siteName.toLowerCase().includes(keyword)
      || item.accountName.toLowerCase().includes(keyword)
      || item.label.toLowerCase().includes(keyword)
      || item.detail.toLowerCase().includes(keyword)
    ));
  }, [credentialOptions, credentialSearch]);

  const selectedModelCount = form.selectedModels.length;
  const selectedGroupCount = normalizedSelectedGroupRouteIds.length;

  return (
    <CenteredModal
      open={open}
      onClose={onClose}
      title={editingItem ? '编辑下游密钥' : '新增下游密钥'}
      maxWidth={860}
      bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 12 }}
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>取消</Button>
          <Button type="button" onClick={onSave} disabled={saving}>
            {saving
              ? <><LoaderCircle className="size-4 animate-spin" /> 保存中...</>
              : (editingItem ? '保存修改' : '创建密钥')}
          </Button>
        </>
      )}
    >
      <InfoNote>
        支持为每个下游密钥独立配置分组、标签、额度与有效期。高级限制项可按需展开。
      </InfoNote>

      <div className="grid grid-cols-1 gap-3">
        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">名称</div>
          <Input value={form.name} onChange={(e) => onChange((prev) => ({ ...prev, name: e.target.value }))} placeholder="例如：项目 A / 移动端" />
        </div>
        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">下游密钥</div>
          <div className="flex min-w-0 items-stretch gap-2">
            <Input
              value={form.key}
              onChange={(e) => onChange((prev) => ({ ...prev, key: e.target.value }))}
              placeholder="sk-..."
              className="min-w-0 flex-1 font-mono"
            />
            <Button variant="outline"
              type="button"
             
             
              onClick={() => onChange((prev) => ({ ...prev, key: generateDownstreamSkKey(PROXY_TOKEN_PREFIX) }))}
            >
              随机
            </Button>
          </div>
        </div>
        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">主分组</div>
          <Input
            value={form.groupName}
            onChange={(e) => onChange((prev) => ({ ...prev, groupName: e.target.value }))}
            placeholder="例如：VIP / 内部项目 / A组"
            list="downstream-group-suggestions"
          />
        </div>
        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">请求额度</div>
          <Input value={form.maxRequests} onChange={(e) => onChange((prev) => ({ ...prev, maxRequests: e.target.value }))} placeholder="留空表示不限" />
        </div>
        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">成本额度</div>
          <Input value={form.maxCost} onChange={(e) => onChange((prev) => ({ ...prev, maxCost: e.target.value }))} placeholder="留空表示不限" />
        </div>
        <div className="grid gap-1.5">
          <div className="text-xs font-medium text-muted-foreground">过期时间</div>
          <Input type="datetime-local" value={form.expiresAt} onChange={(e) => onChange((prev) => ({ ...prev, expiresAt: e.target.value }))} />
        </div>
        <label className="flex items-start gap-3 rounded-md border p-3">
          <Checkbox checked={form.enabled} onCheckedChange={(checked) => onChange((prev) => ({ ...prev, enabled: checked === true }))} />
          <div>
            <div className="text-sm font-medium">创建后立即启用</div>
            <div className="text-xs text-muted-foreground">关闭后该密钥将无法继续分发请求</div>
          </div>
        </label>
      </div>

      <div className="grid gap-1.5">
        <div className="text-xs font-medium text-muted-foreground">备注说明</div>
        <Textarea
          value={form.description}
          onChange={(e) => onChange((prev) => ({ ...prev, description: e.target.value }))}
          placeholder="填写业务场景、负责人或限制说明"
          className="min-h-21 resize-y"
        />
      </div>

      <div className="grid gap-1.5">
        <div className="text-xs font-medium text-muted-foreground">标签</div>
        <TagInput
          tags={form.tags}
          onChange={(tags) => onChange((prev) => ({ ...prev, tags }))}
          suggestions={tagSuggestions}
          placeholder="输入标签后按回车或逗号，例如：移动端、VIP、项目A"
        />
        <div className="text-xs text-muted-foreground">标签用于搜索、筛选和辅助归类，不影响路由与权限。</div>
      </div>

      <div className="grid gap-3">
        <Button type="button" variant="outline" className="w-full justify-between" onClick={() => setAdvancedOpen((value) => !value)}>
          <span>高级配置</span>
          <span className="text-xs text-muted-foreground">{advancedOpen ? '收起' : '展开'}</span>
        </Button>
        {advancedOpen ? (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <div className="text-xs font-medium text-muted-foreground">站点倍率 JSON</div>
              <Textarea
                value={form.siteWeightMultipliersText}
                onChange={(e) => onChange((prev) => ({ ...prev, siteWeightMultipliersText: e.target.value }))}
                placeholder={'例如：{\n  "1": 1.2,\n  "7": 0.8\n}'}
                className="min-h-24 resize-y font-mono"
              />
              <div className="text-xs text-muted-foreground">用于对特定站点做分发倍率微调；留空或 `{}` 表示走默认倍率。</div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="grid gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">模型白名单</div>
                    <div className="text-xs text-muted-foreground">只展示精确模型；未勾选时默认不允许任何精确模型，可点“全选”一次性放开。</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" type="button" onClick={() => onChange((prev) => ({ ...prev, selectedModels: exactModels }))}>全选</Button>
                    <Button variant="outline" type="button" onClick={() => onChange((prev) => ({ ...prev, selectedModels: [] }))}>清空</Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">已选 {selectedModelCount} 个模型</div>
                <SearchInput value={modelSearch} onChange={(e) => setModelSearch(e.target.value)} placeholder="搜索模型" />
                <div className="flex max-h-70 flex-col gap-2 overflow-y-auto">
                  {filteredModels.length === 0 ? (
                    <div className="text-xs text-muted-foreground">暂无匹配模型</div>
                  ) : filteredModels.map((model) => {
                    const checked = form.selectedModels.includes(model);
                    return (
                      <label key={model}>
                        <SelectableRow checked={checked} className="items-center">
                        <Checkbox
                          checked={checked}
                          onChange={() => onChange((prev) => ({
                            ...prev,
                            selectedModels: checked ? prev.selectedModels.filter((item) => item !== model) : [...prev.selectedModels, model],
                          }))}
                        />
                        <code className="text-xs text-foreground">{model}</code>
                        </SelectableRow>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">群组范围</div>
                    <div className="text-xs text-muted-foreground">限制可访问的群组路由；未勾选时默认不允许任何群组，可点“全选”一次性放开。</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button variant="outline" type="button" onClick={() => onChange((prev) => ({ ...prev, selectedGroupRouteIds: groupRouteOptions.map((route) => route.id) }))}>全选</Button>
                    <Button variant="outline" type="button" onClick={() => onChange((prev) => ({ ...prev, selectedGroupRouteIds: [] }))}>清空</Button>
                  </div>
                </div>
                <div className="text-xs text-muted-foreground">已选 {selectedGroupCount} 个群组</div>
                <SearchInput value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} placeholder="搜索群组或模型模式" />
                <div className="flex max-h-70 flex-col gap-2 overflow-y-auto">
                  {filteredGroups.length === 0 ? (
                    <div className="text-xs text-muted-foreground">暂无匹配群组</div>
                  ) : filteredGroups.map((route) => {
                    const checked = normalizedSelectedGroupRouteIds.includes(route.id);
                    return (
                      <label key={route.id}>
                        <SelectableRow checked={checked}>
                        <Checkbox
                          checked={checked}
                          onChange={() => onChange((prev) => ({
                            ...prev,
                            selectedGroupRouteIds: checked
                              ? prev.selectedGroupRouteIds.filter((item) => item !== route.id)
                              : uniqIds([...prev.selectedGroupRouteIds.filter((item) => validGroupRouteIdSet.has(item)), route.id]),
                          }))}
                          className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground">
                            {routeTitle(route)}
                            {!route.enabled ? <span className="ml-2 text-xs text-destructive">已禁用</span> : null}
                          </div>
                          <code className="mt-1 block text-xs text-muted-foreground">{getRouteRequestedModelPattern(route)}</code>
                        </div>
                        </SelectableRow>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">排除站点</div>
                    <div className="text-xs text-muted-foreground">命中的站点会直接跳过，不参与当前下游密钥的通道路由。</div>
                  </div>
                  <Button variant="outline" type="button" onClick={() => onChange((prev) => ({ ...prev, excludedSiteIds: [] }))}>清空</Button>
                </div>
                <div className="text-xs text-muted-foreground">已排除 {form.excludedSiteIds.length} 个站点</div>
                <SearchInput value={siteSearch} onChange={(e) => setSiteSearch(e.target.value)} placeholder="搜索站点" />
                <div className="flex max-h-60 flex-col gap-2 overflow-y-auto">
                  {exclusionSourceLoading ? (
                    <div className="text-xs text-muted-foreground">加载站点与令牌中...</div>
                  ) : filteredSites.length === 0 ? (
                    <div className="text-xs text-muted-foreground">暂无可排除站点</div>
                  ) : filteredSites.map((site) => {
                    const checked = form.excludedSiteIds.includes(site.siteId);
                    return (
                      <label key={site.siteId}>
                        <SelectableRow checked={checked} className="items-center">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(checked) => onChange((prev) => ({
                            ...prev,
                            excludedSiteIds: normalizeExcludedSiteIds(
                              checked === true
                                ? [...prev.excludedSiteIds, site.siteId]
                                : prev.excludedSiteIds.filter((item) => item !== site.siteId),
                            ),
                          }))}            />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground">{site.siteName}</div>
                          <div className="mt-1 text-xs text-muted-foreground">{site.accountCount} 个账号</div>
                        </div>
                        </SelectableRow>
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid gap-3 rounded-md border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-foreground">排除 API Key/令牌</div>
                    <div className="text-xs text-muted-foreground">支持排除显式令牌，以及 `tokenId` 为空时实际使用的默认 API Key。</div>
                  </div>
                  <Button variant="outline" type="button" onClick={() => onChange((prev) => ({ ...prev, excludedCredentialRefs: [] }))}>清空</Button>
                </div>
                <div className="text-xs text-muted-foreground">已排除 {form.excludedCredentialRefs.length} 个凭证</div>
                <SearchInput value={credentialSearch} onChange={(e) => setCredentialSearch(e.target.value)} placeholder="搜索站点 / 账号 / 令牌" />
                <div className="flex max-h-70 flex-col gap-2 overflow-y-auto">
                  {exclusionSourceLoading ? (
                    <div className="text-xs text-muted-foreground">加载站点与令牌中...</div>
                  ) : filteredCredentials.length === 0 ? (
                    <div className="text-xs text-muted-foreground">暂无可排除 API Key/令牌</div>
                  ) : filteredCredentials.map((item) => {
                    const checked = form.excludedCredentialRefs.some((ref) => buildExcludedCredentialRefKey(ref) === buildExcludedCredentialRefKey(item.ref));
                    return (
                      <label key={item.key}>
                        <SelectableRow checked={checked}>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(checked) => onChange((prev) => ({
                            ...prev,
                            excludedCredentialRefs: normalizeExcludedCredentialRefs(
                              checked === true
                                ? [...prev.excludedCredentialRefs, item.ref]
                                : prev.excludedCredentialRefs.filter((ref) => buildExcludedCredentialRefKey(ref) !== buildExcludedCredentialRefKey(item.ref)),
                            ),
                          }))}              className="mt-0.5"
                        />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-foreground">{item.label}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {item.siteName} / {item.accountName}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">{item.detail}</div>
                        </div>
                        </SelectableRow>
                      </label>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </div>
      <datalist id="downstream-group-suggestions">
        {groupSuggestions.map((group) => <option key={group} value={group} />)}
      </datalist>
    </CenteredModal>
  );
}
