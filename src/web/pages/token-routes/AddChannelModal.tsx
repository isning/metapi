import { useState, useMemo } from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import ModernSelect from '../../components/ModernSelect.js';
import SearchInput from '../../components/SearchInput.js';
import { api } from '../../api.js';
import { useToast } from '../../components/Toast.js';
import { tr } from '../../i18n.js';
import type { RouteCandidateView, RouteAccountOption, RouteTokenOption } from '../helpers/routeModelCandidatesIndex.js';
import type { RouteMissingTokenHint } from '../helpers/routeMissingTokenHints.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import { Checkbox } from '../../components/ui/checkbox/index.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import { ScrollArea } from '../../components/ui/scroll-area/index.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';
import { cn } from '../../lib/utils.js';
import {
  buildFixedTokenOptionDescription,
  buildFixedTokenOptionLabel,
  describeTokenBinding,
} from './tokenBindingPresentation.js';

type ChannelSelection = {
  accountId: number;
  tokenId?: number;
  sourceModel?: string;
};

type AddChannelModalProps = {
  open: boolean;
  onClose: () => void;
  routeId: number;
  routeTitle: string;
  candidateView: RouteCandidateView;
  onSuccess: () => void;
  missingTokenHints?: RouteMissingTokenHint[];
  onCreateTokenForMissing?: (accountId: number, modelName: string) => void;
  existingChannelAccountIds?: Set<number>;
};

export default function AddChannelModal({
  open,
  onClose,
  routeId,
  routeTitle,
  candidateView,
  onSuccess,
  missingTokenHints,
  onCreateTokenForMissing,
  existingChannelAccountIds,
}: AddChannelModalProps) {
  const toast = useToast();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAccounts, setSelectedAccounts] = useState<Record<number, ChannelSelection>>({});
  const [submitting, setSubmitting] = useState(false);

  const filteredAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return candidateView.accountOptions;
    return candidateView.accountOptions.filter((option) =>
      option.label.toLowerCase().includes(q),
    );
  }, [candidateView.accountOptions, searchQuery]);

  const missingAccounts = useMemo(() => {
    if (!missingTokenHints || missingTokenHints.length === 0) return [];
    const seen = new Map<number, { accountId: number; label: string; modelName: string }>();
    for (const hint of missingTokenHints) {
      for (const account of hint.accounts) {
        if (!seen.has(account.accountId)) {
          const label = `${account.username || `account-${account.accountId}`} @ ${account.siteName}`;
          seen.set(account.accountId, { accountId: account.accountId, label, modelName: hint.modelName });
        }
      }
    }
    return Array.from(seen.values());
  }, [missingTokenHints]);

  const filteredMissingAccounts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return missingAccounts;
    return missingAccounts.filter((item) => item.label.toLowerCase().includes(q));
  }, [missingAccounts, searchQuery]);

  const selectedCount = Object.keys(selectedAccounts).length;

  const toggleAccount = (account: RouteAccountOption) => {
    setSelectedAccounts((prev) => {
      if (prev[account.id]) {
        const next = { ...prev };
        delete next[account.id];
        return next;
      }
      const tokens = candidateView.tokenOptionsByAccountId[account.id] || [];
      return {
        ...prev,
        [account.id]: {
          accountId: account.id,
        },
      };
    });
  };

  const updateTokenForAccount = (accountId: number, tokenId: number, sourceModel: string) => {
    setSelectedAccounts((prev) => {
      if (!prev[accountId]) return prev;
      return {
        ...prev,
        [accountId]: {
          ...prev[accountId],
          tokenId: tokenId || undefined,
          sourceModel: sourceModel || undefined,
        },
      };
    });
  };

  const handleSubmit = async () => {
    const channels = Object.values(selectedAccounts);
    if (channels.length === 0) return;

    setSubmitting(true);
    try {
      const result = await api.batchAddChannels(routeId, channels);
      const msg = `已添加 ${result.created} 个通道` +
        (result.skipped > 0 ? `，跳过 ${result.skipped} 个重复` : '') +
        (result.errors.length > 0 ? `，${result.errors.length} 个错误` : '');
      toast.success(msg);
      setSelectedAccounts({});
      setSearchQuery('');
      onSuccess();
      onClose();
    } catch (e: any) {
      toast.error(e.message || '批量添加通道失败');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    if (!submitting) {
      setSelectedAccounts({});
      setSearchQuery('');
      onClose();
    }
  };

  return (
    <CenteredModal
      open={open}
      onClose={handleClose}
      title={`${tr('添加通道')} - ${routeTitle}`}
      maxWidth={560}
      footer={
        <div className="flex w-full items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground">
            {tr('已选')} {selectedCount} {tr('个通道')}
          </span>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={handleClose} disabled={submitting}>
              {tr('取消')}
            </Button>
            <Button
              type="button"
              onClick={handleSubmit}
              disabled={submitting || selectedCount === 0}
            >
              {submitting ? (
                <><LoaderCircle className="size-4 animate-spin" /> {tr('添加中...')}</>
              ) : (
                `${tr('批量添加')} (${selectedCount})`
              )}
            </Button>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        <SearchInput
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder={tr('搜索账号...')}
        />

        <ScrollArea className="max-h-[360px]">
          <div className="flex flex-col gap-2 pr-1">
          {filteredAccounts.length === 0 && filteredMissingAccounts.length === 0 ? (
            <EmptyStateBlock
              title={candidateView.accountOptions.length === 0 && missingAccounts.length === 0
                ? tr('当前没有可用的账号，请确认已有账号的令牌支持调用此模型')
                : tr('没有匹配的账号')}
              className="py-3"
            />
          ) : (
            <>
              {filteredAccounts.map((account) => {
                const isSelected = !!selectedAccounts[account.id];
                const tokens = candidateView.tokenOptionsByAccountId[account.id] || [];
                const selection = selectedAccounts[account.id];
                const isExisting = existingChannelAccountIds?.has(account.id);
                const tokenBinding = describeTokenBinding(tokens, selection?.tokenId || 0);

                return (
                  <Card
                    key={account.id}
                    onClick={() => toggleAccount(account)}
                    className={cn('cursor-pointer', isSelected && 'bg-muted')}
                  >
                    <CardContent className="grid gap-2 p-2.5">
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={isSelected}
                          aria-readonly="true"
                          className="pointer-events-none"
                        />
                        <span className="text-sm font-medium">{account.label}</span>
                        {isExisting && (
                          <ToneBadge tone="-muted">{tr('已添加')}</ToneBadge>
                        )}
                      </div>

                      {isSelected && tokens.length > 0 && (
                        <div className="ml-6 grid gap-1" onClick={(e) => e.stopPropagation()}>
                          <div className="text-xs text-muted-foreground">{tr('令牌绑定')}:</div>
                          <ModernSelect
                            size="sm"
                            value={(() => {
                              if (!selection?.tokenId) return '0';
                              return `${selection.tokenId}::${selection.sourceModel || ''}`;
                            })()}
                            onChange={(nextValue) => {
                              if (nextValue === '0') {
                                updateTokenForAccount(account.id, 0, '');
                                return;
                              }
                              const [tokenRaw, ...sourceParts] = nextValue.split('::');
                              updateTokenForAccount(account.id, Number.parseInt(tokenRaw, 10) || 0, sourceParts.join('::'));
                            }}
                            options={[
                              {
                                value: '0',
                                label: tr('跟随账号默认'),
                                description: tokenBinding.followOptionDescription,
                              },
                              ...tokens.map((token: RouteTokenOption) => ({
                                value: `${token.id}::${token.sourceModel || ''}`,
                                label: buildFixedTokenOptionLabel(token, {
                                  includeDefaultTag: true,
                                  includeSourceModel: true,
                                }),
                                description: buildFixedTokenOptionDescription(token),
                              })),
                            ]}
                            placeholder={tr('选择绑定方式')}
                          />
                          <div className="text-xs leading-snug text-muted-foreground">
                            {tokenBinding.helperText}
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}

              {/* Missing token hints */}
              {filteredMissingAccounts.length > 0 && (
                <div className="mt-1 flex flex-col gap-2 border-t border-dashed border-border pt-2">
                  <div className="text-xs text-muted-foreground">
                    {tr('以下账号可用此模型但缺少令牌')}:
                  </div>
                  {filteredMissingAccounts.map((item) => (
                    <Card key={item.accountId} className="border-dashed">
                      <CardContent className="flex items-center justify-between gap-2 p-2.5">
                        <span className="text-xs text-muted-foreground">{item.label}</span>
                      {onCreateTokenForMissing && (
                        <Button
                          variant="ghost"
                          size="sm"
                          type="button"
                          onClick={() => onCreateTokenForMissing(item.accountId, item.modelName)}
                        >
                          {tr('创建令牌')}
                        </Button>
                      )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
          </div>
        </ScrollArea>
      </div>
    </CenteredModal>
  );
}
