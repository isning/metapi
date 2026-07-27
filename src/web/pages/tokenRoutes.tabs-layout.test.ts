import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('TokenRoutes mode layout', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/web/pages/TokenRoutes.tsx'), 'utf8');

  it('uses the management list as the default surface and keeps graph editing separate', () => {
    expect(source).toContain("type RouteWorkspaceTab = 'groups' | 'graph' | 'json'");
    expect(source).toContain("const [tab, setTab] = useState<RouteWorkspaceTab>('groups')");
    expect(source).toContain('<RouteGroupWorkspace onOpenGraph={openGroupInGraph} refreshSignal={refreshSignal} />');
    expect(source).toContain('<RouteGraphWorkbench mode={tab} focusIntent={focusIntent}');
  });

  it('keeps Route Group management and Graph editing as separate native workspaces', () => {
    expect(source).toContain("import RouteGroupWorkspace from './token-routes/RouteGroupWorkspace.js'");
    expect(source).toContain("import RouteGraphWorkbench from './token-routes/RouteGraphWorkbench.js'");
    expect(source).not.toContain('tokenRouteContract');
    expect(source).not.toContain('routeEditorMode');
  });

  it('does not reintroduce numeric route identifiers into the page adapter', () => {
    expect(source).not.toContain('RouteSummaryRow');
    expect(source).not.toContain('RouteEndpointTarget');
    expect(source).not.toContain('tokenRouteContract');
  });
});
