import { useRef, useState } from 'react';
import { Network, RefreshCw, Workflow } from 'lucide-react';
import { api } from '../api.js';
import { useToast } from '../components/Toast.js';
import PageHeader from '../components/workspace/PageHeader.js';
import PageShell from '../components/workspace/PageShell.js';
import { PageActionBar, SecondaryActionButton } from '../components/workspace/ActionBar.js';
import SegmentedTabBar from '../components/SegmentedTabBar.js';
import * as Tabs from '../components/ui/tabs/index.js';
import { tr } from '../i18n.js';
import RouteGraphWorkbench from './token-routes/RouteGraphWorkbench.js';
import RouteGroupWorkspace from './token-routes/RouteGroupWorkspace.js';
import type { RouteGraphWorkspaceFocusIntent } from './token-routes/RouteGraphWorkspaceView.js';

type RouteWorkspaceTab = 'groups' | 'graph' | 'json';

export default function TokenRoutes() {
  const [tab, setTab] = useState<RouteWorkspaceTab>('groups');
  const [focusIntent, setFocusIntent] = useState<RouteGraphWorkspaceFocusIntent | null>(null);
  const [rebuilding, setRebuilding] = useState(false);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const focusIntentId = useRef(0);
  const toast = useToast();

  const openGroupInGraph = (macroId: string) => {
    focusIntentId.current += 1;
    setFocusIntent({ id: focusIntentId.current, kind: 'macro', macroId });
    setTab('graph');
  };
  const rebuildRoutes = async () => {
    setRebuilding(true);
    try {
      const result = await api.rebuildRoutes(true);
      toast.success(result?.message || tr('pages.tokenRoutes.rebuildStarted'));
      setRefreshSignal((current) => current + 1);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : tr('pages.tokenRoutes.failedRebuildRoute'));
    } finally {
      setRebuilding(false);
    }
  };

  return <PageShell className="shadcn-default-scope min-h-[400px]">
    <PageHeader
      title={tr('app.routes')}
      description={tr('pages.tokenRoutes.routesSubtitle')}
      actions={<PageActionBar><SecondaryActionButton type="button" icon={RefreshCw} loading={rebuilding} loadingLabel={tr('pages.tokenRoutes.rebuilding')} onClick={() => void rebuildRoutes()} disabled={rebuilding}>{tr('pages.tokenRoutes.autoRebuild')}</SecondaryActionButton></PageActionBar>}
    />
    <Tabs.Tabs value={tab} onValueChange={(value) => setTab(value as RouteWorkspaceTab)} className="grid min-w-0 max-w-full gap-3">
      <SegmentedTabBar
        value={tab}
        onValueChange={(value) => setTab(value as RouteWorkspaceTab)}
        className="w-full sm:w-auto"
        items={[
          { value: 'groups', label: tr('pages.tokenRoutes.routeGroups'), icon: <Workflow className="size-4" /> },
          { value: 'graph', label: tr('pages.tokenRoutes.graph'), icon: <Network className="size-4" /> },
          { value: 'json', label: tr('pages.tokenRoutes.json') },
        ]}
      />
      <Tabs.TabsContent value="groups" className="min-w-0 max-w-full">
        {tab === 'groups' ? <RouteGroupWorkspace onOpenGraph={openGroupInGraph} refreshSignal={refreshSignal} /> : null}
      </Tabs.TabsContent>
      <Tabs.TabsContent value="graph" className="min-w-0 max-w-full overflow-hidden">
        {tab === 'graph' ? <RouteGraphWorkbench mode={tab} focusIntent={focusIntent} onFocusIntentConsumed={(id) => setFocusIntent((current) => current?.id === id ? null : current)} /> : null}
      </Tabs.TabsContent>
      <Tabs.TabsContent value="json" className="min-w-0 max-w-full overflow-hidden">
        {tab === 'json' ? <RouteGraphWorkbench mode={tab} /> : null}
      </Tabs.TabsContent>
    </Tabs.Tabs>
  </PageShell>;
}
