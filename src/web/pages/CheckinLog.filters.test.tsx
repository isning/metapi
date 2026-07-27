import { act, create, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SegmentedTabBar from '../components/SegmentedTabBar.js';
import { ToastProvider } from '../components/Toast.js';
import CheckinLog from './CheckinLog.js';

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getCheckinLogs: vi.fn(),
    triggerCheckinAll: vi.fn(),
  },
}));

vi.mock('../api.js', () => ({ api: apiMock }));

function collectText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : collectText(child)).join('');
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function checkinLog(id: number, username: string, status: 'success' | 'failed' | 'skipped') {
  return {
    accounts: { username },
    sites: { name: 'Test site' },
    checkin_logs: {
      id,
      status,
      createdAt: new Date().toISOString(),
      message: `${status} message`,
      reward: '-',
    },
  };
}

describe('CheckinLog filters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getCheckinLogs.mockResolvedValue([
      checkinLog(1, 'success-user', 'success'),
      checkinLog(2, 'failed-user', 'failed'),
      checkinLog(3, 'skipped-user', 'skipped'),
    ]);
  });

  it.each([
    ['success', 'success-user', ['failed-user', 'skipped-user']],
    ['failed', 'failed-user', ['success-user', 'skipped-user']],
    ['skipped', 'skipped-user', ['success-user', 'failed-user']],
  ] as const)('filters loaded rows by %s status', async (status, visibleUser, hiddenUsers) => {
    let root!: ReturnType<typeof create>;
    await act(async () => {
      root = create(<ToastProvider><CheckinLog /></ToastProvider>);
    });
    await flush();

    expect(apiMock.getCheckinLogs).toHaveBeenCalledWith('limit=100');
    const tabs = root.root.findByType(SegmentedTabBar);
    act(() => tabs.props.onValueChange(status));

    const pageText = collectText(root.root);
    expect(pageText).toContain(visibleUser);
    for (const hiddenUser of hiddenUsers) expect(pageText).not.toContain(hiddenUser);
    root.unmount();
  });
});
