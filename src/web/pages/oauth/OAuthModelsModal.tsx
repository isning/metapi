import React from 'react';
import CenteredModal from '../../components/CenteredModal.js';
import { Button } from '../../components/ui/button/index.js';
import { LoaderCircle } from 'lucide-react';
import ToneBadge from '../../components/ToneBadge.js';
import { Card, CardContent } from '../../components/ui/card/index.js';
import EmptyStateBlock from '../../components/EmptyStateBlock.js';

export type OAuthModelItem = {
  name: string;
  latencyMs: number | null;
  disabled: boolean;
  isManual?: boolean;
};

type OAuthModelsModalProps = {
  open: boolean;
  title: string;
  siteName?: string | null;
  loading: boolean;
  refreshing: boolean;
  models: OAuthModelItem[];
  totalCount: number;
  disabledCount: number;
  onClose: () => void;
  onRefresh: () => Promise<void> | void;
};

export default function OAuthModelsModal({
  open,
  title,
  siteName,
  loading,
  refreshing,
  models,
  totalCount,
  disabledCount,
  onClose,
  onRefresh,
}: OAuthModelsModalProps) {
  const enabledCount = Math.max(0, totalCount - disabledCount);

  return (
    <CenteredModal
      open={open}
      onClose={onClose}
      title={title}
      maxWidth={620}
      footer={(
        <>
          <Button variant="outline" type="button" onClick={onClose}>
            关闭
          </Button>
          <Button
            type="button"
           
            onClick={() => void onRefresh()}
            disabled={loading || refreshing}
          >
            {refreshing ? <><LoaderCircle className="size-4 animate-spin" />刷新中...</> : '刷新模型'}
          </Button>
        </>
      )}
    >
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <LoaderCircle className="size-5 animate-spin" />
          <span>正在加载模型列表...</span>
        </div>
      ) : (
        <div className="grid gap-3">
          <Card>
            <CardContent className="grid gap-1 p-3">
            <div className="text-sm font-semibold">
              {siteName ? `${siteName} · 共 ${totalCount} 个模型` : `共 ${totalCount} 个模型`}
            </div>
            <div className="text-sm text-muted-foreground">
              已启用 {enabledCount} 个，已禁用 {disabledCount} 个。点击“刷新模型”可重新拉取当前账号支持的模型列表。
            </div>
            </CardContent>
          </Card>

          {models.length === 0 ? (
            <EmptyStateBlock title="暂无模型" description="当前账号还没有同步到可用模型，可点击右下角“刷新模型”重试。" />
          ) : (
            <div className="grid max-h-[420px] gap-2 overflow-y-auto">
              {models.map((model) => (
                <Card key={model.name} className={model.disabled ? 'opacity-60' : undefined}>
                  <CardContent className="flex items-start justify-between gap-3 p-3">
                    <div className="min-w-0 flex-1">
                      <div className="break-all font-mono text-sm font-semibold">{model.name}</div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        {model.latencyMs != null ? <span className="text-xs text-muted-foreground">{model.latencyMs}ms</span> : null}
                        {model.isManual ? <ToneBadge tone="-info">手动</ToneBadge> : null}
                        {model.disabled ? <ToneBadge tone="-warning">禁用</ToneBadge> : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </CenteredModal>
  );
}
