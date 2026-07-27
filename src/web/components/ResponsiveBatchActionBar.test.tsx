import React from 'react';
import { describe, expect, it } from 'vitest';
import { create } from 'react-test-renderer';
import ResponsiveBatchActionBar from './ResponsiveBatchActionBar.js';

describe('ResponsiveBatchActionBar', () => {
  it('renders the shared mobile batch bar on mobile', () => {
    const root = create(
      <ResponsiveBatchActionBar isMobile info="已选 2 项">
        <button type="button">批量启用</button>
      </ResponsiveBatchActionBar>,
    );

    expect(root.root.find((node) => node.props['data-slot'] === 'card')).toBeTruthy();
    expect(root.root.findByType('button').children).toContain('批量启用');
  });

  it('renders the desktop card wrapper on desktop', () => {
    const root = create(
      <ResponsiveBatchActionBar isMobile={false} info="已选 3 项">
        <button type="button">批量删除</button>
      </ResponsiveBatchActionBar>,
    );

    expect(root.root.find((node) => node.props['data-slot'] === 'card')).toBeTruthy();
    expect(root.root.findAll((node) => node.props.className === 'card')).toHaveLength(0);
    expect(root.root.findAllByType('span').some((node) => node.children.includes('已选 3 项'))).toBe(true);
  });
});
