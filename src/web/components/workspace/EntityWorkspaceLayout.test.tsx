import { create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import EntityWorkspaceLayout from './EntityWorkspaceLayout.js';

vi.mock('../ui/resizable/index.js', () => ({
  ResizablePanelGroup: ({ children, ...props }: any) => <div data-kind="group" {...props}>{children}</div>,
  ResizablePanel: ({ children, ...props }: any) => <section data-kind="panel" {...props}>{children}</section>,
  ResizableHandle: ({ children, ...props }: any) => <div data-kind="handle" {...props}>{children}</div>,
}));

vi.mock('../ui/scroll-area/index.js', () => ({
  ScrollArea: ({ children, ...props }: any) => <div data-kind="scroll-area" {...props}>{children}</div>,
}));

function findPanels(root: ReactTestInstance) {
  return root.findAll((node) => node.props['data-kind'] === 'panel');
}

describe('EntityWorkspaceLayout', () => {
  it('uses explicit percentage constraints for desktop resizable panels', () => {
    const renderer = create(
      <EntityWorkspaceLayout
        index={<div>index</div>}
        workspace={<div>workspace</div>}
        inspector={<div>inspector</div>}
      />,
    );

    try {
      const panels = findPanels(renderer.root);
      expect(panels.map((panel) => ({
        defaultSize: panel.props.defaultSize,
        minSize: panel.props.minSize,
        maxSize: panel.props.maxSize,
      }))).toEqual([
        { defaultSize: '24%', minSize: '18%', maxSize: '34%' },
        { defaultSize: '54%', minSize: '36%', maxSize: undefined },
        { defaultSize: '22%', minSize: '18%', maxSize: '32%' },
      ]);
    } finally {
      renderer.unmount();
    }
  });
});
