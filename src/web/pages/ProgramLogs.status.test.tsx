import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { ToastProvider } from '../components/Toast.js';
import ModernSelect from '../components/ModernSelect.js';
import { Switch } from '../components/ui/switch/index.js';
import ProgramLogs from './ProgramLogs.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getEvents: vi.fn(),
    markEventRead: vi.fn(),
    markAllEventsRead: vi.fn(),
    clearEvents: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({
  api: apiMock,
}));

function collectText(node: ReactTestInstance): string {
  const children = node.children || [];
  return children.map((child) => {
    if (typeof child === 'string') return child;
    return collectText(child);
  }).join('');
}

async function flushMicrotasks() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ProgramLogs status label', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('treats summary with failed=0 as success', async () => {
    apiMock.getEvents.mockResolvedValue([
      {
        id: 1,
        type: 'status',
        title: '同步全部账号令牌已完成（成功31/跳过0/失败0）',
        message: '全部账号令牌同步完成：成功 31，跳过 0，失败 0',
        level: 'info',
        read: false,
        createdAt: '2026-03-04T06:43:03.000Z',
      },
    ]);

    let root!: WebTestRenderer;
    await act(async () => {
      root = create(
        <MemoryRouter initialEntries={['/events']}>
          <ToastProvider>
            <ProgramLogs />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await flushMicrotasks();

    const rows = root!.root.findAll((node) => node.type === 'tr');
    const targetRow = rows.find((row) => collectText(row).includes('同步全部账号令牌已完成'));
    expect(targetRow).toBeTruthy();

    const tds = targetRow!.findAll((node) => node.type === 'td');
    const statusCell = tds[5];
    expect(collectText(statusCell).trim()).toBe('成功');
    const statusBadge = statusCell.find((node) => node.props['data-tone'] === 'success');
    expect(statusBadge).toBeTruthy();
  });

  it('treats parenthesized counts with failed=0 as success', async () => {
    apiMock.getEvents.mockResolvedValue([
      {
        id: 2,
        type: 'status',
        title: '同步全部账号令牌已完成',
        message: '成功(15): a, b\n跳过(1): c\n失败(0): -',
        level: 'info',
        read: false,
        createdAt: '2026-03-04T06:43:03.000Z',
      },
    ]);

    let root!: WebTestRenderer;
    await act(async () => {
      root = create(
        <MemoryRouter initialEntries={['/events']}>
          <ToastProvider>
            <ProgramLogs />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await flushMicrotasks();

    const rows = root!.root.findAll((node) => node.type === 'tr');
    const targetRow = rows.find((row) => collectText(row).includes('同步全部账号令牌已完成'));
    expect(targetRow).toBeTruthy();

    const tds = targetRow!.findAll((node) => node.type === 'td');
    const statusCell = tds[5];
    expect(collectText(statusCell).trim()).toBe('成功');
    const statusBadge = statusCell.find((node) => node.props['data-tone'] === 'success');
    expect(statusBadge).toBeTruthy();
  });

  it('hydrates every event filter from a deep link and sends it to the API', async () => {
    apiMock.getEvents.mockResolvedValue([]);

    let root!: WebTestRenderer;
    await act(async () => {
      root = create(
        <MemoryRouter initialEntries={['/events?type=proxy&scope=attention&state=open&read=false']}>
          <ToastProvider>
            <ProgramLogs />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await flushMicrotasks();

    expect(apiMock.getEvents).toHaveBeenLastCalledWith(
      'type=proxy&scope=attention&state=open&read=false&limit=50&offset=0',
    );
    expect(root.root.findAllByType(ModernSelect).map((select) => select.props.value)).toEqual([
      'proxy',
      'attention',
      'open',
    ]);
    expect(root.root.findByType(Switch).props.checked).toBe(true);
    root.unmount();
  });

  it('updates the routed API query when type and unread filters change', async () => {
    apiMock.getEvents.mockResolvedValue([]);

    let root!: WebTestRenderer;
    await act(async () => {
      root = create(
        <MemoryRouter initialEntries={['/events?type=proxy&read=false']}>
          <ToastProvider>
            <ProgramLogs />
          </ToastProvider>
        </MemoryRouter>,
      );
    });
    await flushMicrotasks();

    const typeFilter = root.root.findAllByType(ModernSelect).find((select) => select.props.value === 'proxy')!;
    await act(async () => {
      typeFilter.props.onChange('token');
    });
    await flushMicrotasks();
    expect(apiMock.getEvents).toHaveBeenLastCalledWith('type=token&read=false&limit=50&offset=0');

    await act(async () => {
      root.root.findByType(Switch).props.onCheckedChange(false);
    });
    await flushMicrotasks();
    expect(apiMock.getEvents).toHaveBeenLastCalledWith('type=token&limit=50&offset=0');
    root.unmount();
  });
});
