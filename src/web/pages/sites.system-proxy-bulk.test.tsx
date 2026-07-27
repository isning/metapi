import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import Sites from './Sites.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getSites: vi.fn(),
    batchUpdateSites: vi.fn(),
    updateSite: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function collectText(node: any): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (!node || !Array.isArray(node.children)) return '';
  return node.children.map(collectText).join('');
}

function toggleCheckbox(node: { props: Record<string, any> }, checked = true) {
  if (typeof node.props.onCheckedChange === 'function') {
    node.props.onCheckedChange(checked);
    return;
  }
  if (typeof node.props.onChange === 'function') {
    node.props.onChange({ target: { checked } });
    return;
  }
  if (typeof node.props.onClick === 'function') {
    node.props.onClick({ stopPropagation: vi.fn(), target: { checked } });
  }
}

describe('Sites system proxy bulk actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getSites.mockResolvedValue([
      {
        id: 1,
        name: 'Site A',
        url: 'https://a.example.com',
        platform: 'new-api',
        status: 'active',
        useSystemProxy: false,
      },
      {
        id: 2,
        name: 'Site B',
        url: 'https://b.example.com',
        platform: 'new-api',
        status: 'active',
        useSystemProxy: false,
      },
    ]);
    apiMock.batchUpdateSites.mockResolvedValue({
      success: true,
      successIds: [1, 2],
      failedItems: [],
    });
    apiMock.updateSite.mockResolvedValue({});
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('sends selected site ids to enable system proxy', async () => {
    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/sites']}>
            <ToastProvider>
              <Sites />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const checkboxA = root.root.find((node) => node.props['data-testid'] === 'site-select-1');
      const checkboxB = root.root.find((node) => node.props['data-testid'] === 'site-select-2');

      await act(async () => {
        toggleCheckbox(checkboxA);
        toggleCheckbox(checkboxB);
      });

      const batchButton = root.root.find((node) => node.props['data-testid'] === 'sites-batch-enable-system-proxy');
      await act(async () => {
        batchButton.props.onClick();
      });
      await flushMicrotasks();

      expect(apiMock.batchUpdateSites).toHaveBeenCalledWith({
        ids: [1, 2],
        action: 'enableSystemProxy',
      });
    } finally {
      root?.unmount();
    }
  });

  it('selects a site when clicking the row instead of only the checkbox', async () => {
    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/sites']}>
            <ToastProvider>
              <Sites />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const row = root.root.find((node) => node.props['data-testid'] === 'site-row-1');
      await act(async () => {
        row.props.onClick({ target: { closest: () => null } });
      });
      await flushMicrotasks();

      const checkbox = root.root.find((node) => node.props['data-testid'] === 'site-select-1');
      expect(checkbox.props.checked).toBe(true);
    } finally {
      root?.unmount();
    }
  });

  it('reorders sites by dragging the row handle', async () => {
    let root!: WebTestRenderer;
    try {
      await act(async () => {
        root = create(
          <MemoryRouter initialEntries={['/sites']}>
            <ToastProvider>
              <Sites />
            </ToastProvider>
          </MemoryRouter>,
        );
      });
      await flushMicrotasks();

      const dragContext = root.root.find((node) => typeof node.props?.onDragEnd === 'function');
      await act(async () => {
        dragContext.props.onDragStart({
          active: { id: 2 },
        });
      });
      expect(collectText(root.root)).toContain('Site B');

      await act(async () => {
        await dragContext.props.onDragEnd({
          active: { id: 2 },
          over: { id: 1 },
        });
      });
      await flushMicrotasks();

      expect(apiMock.updateSite).toHaveBeenCalledWith(2, { sortOrder: 0 });
      expect(apiMock.updateSite).toHaveBeenCalledWith(1, { sortOrder: 1 });
    } finally {
      root?.unmount();
    }
  });
});
