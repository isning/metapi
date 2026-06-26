import { describe, expect, it } from 'vitest';
import { create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import SiteBadgeLink from './SiteBadgeLink.js';

describe('SiteBadgeLink', () => {
  it('renders a focus-navigation link when site id is valid', () => {
    const root = create(
      <MemoryRouter>
        <SiteBadgeLink siteId={7} siteName="Demo Site" />
      </MemoryRouter>,
    );

    const link = root.root.findByType('a');
    expect(String(link.props.href || '')).toContain('/sites?focusSiteId=7');
    expect(String(link.props.className || '')).toContain('inline-flex');
    expect(root.root.findAll((node) => node.children.includes('Demo Site'))).not.toHaveLength(0);

    root.unmount();
  });

  it('falls back to plain badge text when site id is invalid', () => {
    const root = create(
      <MemoryRouter>
        <SiteBadgeLink siteId={0} siteName="Unknown Site" />
      </MemoryRouter>,
    );

    expect(root.root.findAllByType('a')).toHaveLength(0);
    expect(root.root.findAll((node) => node.children.includes('Unknown Site'))).not.toHaveLength(0);

    root.unmount();
  });
});
