import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { describe, expect, it } from 'vitest';
import { translateText } from '../../i18n.js';
import DiagnosticItem from './DiagnosticItem.js';

function collectText(node: ReactTestInstance): string {
  return node.children.map((child) => (
    typeof child === 'string' ? child : collectText(child)
  )).join('');
}

describe('DiagnosticItem', () => {
  it('renders localized diagnostic labels and target action text', () => {
    let root!: ReturnType<typeof create>;
    act(() => {
      root = create(
        <DiagnosticItem
          level="warn"
          message="Route graph notice"
          onGoToTarget={() => {}}
        />,
      );
    });

    const text = collectText(root.root);
    expect(text).toContain('警告');
    expect(text).toContain('定位节点');
    expect(text).not.toContain('warn');
    expect(text).not.toContain('Go to node');
    expect(translateText('components.diagnosticItem.level.warn', 'en')).toBe('Warning');
    expect(translateText('components.diagnosticItem.goToTarget', 'en')).toBe('Go to node');
    root.unmount();
  });
});
