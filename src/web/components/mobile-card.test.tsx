import { describe, expect, it } from 'vitest';
import { create } from 'react-test-renderer';
import { MobileCard, MobileField } from './MobileCard.js';
import { Button } from './ui/button/index.js';

describe('MobileCard', () => {
  it('renders separate header and footer action slots plus stacked fields', () => {
    const root = create(
      <MobileCard
        title="CardTitle"
        subtitle="CardSubtitle"
        compact
        headerActions={<span>Meta</span>}
        footerActions={<Button type="button">Action</Button>}
      >
        <MobileField label="Status" value="OK" />
        <MobileField label="URL" value="https://example.com/very/long/path" stacked />
      </MobileCard>,
    );

    const text = root.root.findAll(() => true)
      .flatMap((instance) => instance.children)
      .filter((child): child is string => typeof child === 'string')
      .join('');

    expect(text).toContain('CardTitle');
    expect(text).toContain('CardSubtitle');
    expect(text).toContain('Meta');
    expect(text).toContain('Status');
    expect(text).toContain('OK');
    expect(text).toContain('Action');

    const card = root.root.find((node) => node.props?.['data-slot'] === 'card');
    const header = root.root.find((node) => node.props?.['data-slot'] === 'card-header');
    const content = root.root.find((node) => node.props?.['data-slot'] === 'card-content');
    const footer = root.root.find((node) => node.props?.['data-slot'] === 'card-footer');

    expect(card).toBeTruthy();
    expect(header).toBeTruthy();
    expect(content).toBeTruthy();
    expect(footer).toBeTruthy();
  });
});
