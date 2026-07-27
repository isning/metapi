import { describe, expect, it } from 'vitest';
import { sidebarGroups } from './App.js';

const allSidebarItems = () => sidebarGroups.flatMap((group) => group.items);

describe('App sidebar config', () => {
  it('uses 连接管理 for /accounts and removes standalone /tokens navigation item', () => {
    const accountsItem = allSidebarItems().find((item) => item.to === '/accounts');

    expect(accountsItem?.label).toBe('连接管理');
    expect(allSidebarItems().some((item) => item.to === '/tokens')).toBe(false);
  });

  it('places downstream key navigation under 控制台 instead of 系统', () => {
    const consoleGroup = sidebarGroups.find((group) => group.label === '控制台');
    const systemGroup = sidebarGroups.find((group) => group.label === '系统');

    expect(consoleGroup?.items.some((item) => item.to === '/downstream-keys')).toBe(true);
    expect(systemGroup?.items.some((item) => item.to === '/downstream-keys')).toBe(false);
  });

  it('adds standalone OAuth 管理 navigation entry', () => {
    const oauthItem = allSidebarItems().find((item) => item.to === '/oauth');

    expect(oauthItem?.label).toBe('OAuth 管理');
  });

  it('adds 成本目录 under 控制台 for pricing ownership', () => {
    const consoleGroup = sidebarGroups.find((group) => group.label === '控制台');
    const systemGroup = sidebarGroups.find((group) => group.label === '系统');

    expect(consoleGroup?.items.some((item) => item.to === '/costs')).toBe(true);
    expect(systemGroup?.items.some((item) => item.to === '/costs')).toBe(false);
  });
});
