import RouteGraphJsonWorkbench from './RouteGraphJsonWorkbench.js';
import RouteGraphWorkspaceView from './RouteGraphWorkspaceView.js';
import type { RouteGraphWorkspaceFocusIntent } from './RouteGraphWorkspaceView.js';

export type RouteGraphWorkbenchMode = 'graph' | 'json';

/**
 * The workbench is intentionally only a mode boundary.  Workspace and JSON
 * authoring each own their request lifecycle and never pass through Route
 * Group management state.
 */
export default function RouteGraphWorkbench({
  mode,
  focusIntent,
  onFocusIntentConsumed,
}: {
  mode: RouteGraphWorkbenchMode;
  focusIntent?: RouteGraphWorkspaceFocusIntent | null;
  onFocusIntentConsumed?: (id: number) => void;
}) {
  return mode === 'json'
    ? <RouteGraphJsonWorkbench />
    : <RouteGraphWorkspaceView focusIntent={focusIntent} onFocusIntentConsumed={onFocusIntentConsumed} />;
}
