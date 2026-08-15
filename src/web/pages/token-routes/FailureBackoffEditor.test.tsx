import { describe, expect, it, vi } from 'vitest';
import { act, create } from 'react-test-renderer';
import { Select } from '../../components/ui/select/index.js';
import { FailureBackoffEditor } from './FailureBackoffEditor.js';

describe('FailureBackoffEditor', () => {
  it('supports inherit, custom, and disabled states', async () => {
    const onChange = vi.fn();
    const root = create(<FailureBackoffEditor value={null} onChange={onChange} />);
    const select = root.root.findByType(Select);

    await act(async () => select.props.onValueChange('custom'));
    expect(onChange).toHaveBeenLastCalledWith({
      mode: 'custom',
      policy: { failureThreshold: 3, levelsSec: [0, 600, 3600, 86400], maxSec: 86400 },
    });
    await act(async () => select.props.onValueChange('disabled'));
    expect(onChange).toHaveBeenLastCalledWith({ mode: 'disabled' });
    await act(async () => select.props.onValueChange('inherit'));
    expect(onChange).toHaveBeenLastCalledWith(null);
    root.unmount();
  });

  it('only exposes an editable custom policy for the global default', () => {
    const root = create(<FailureBackoffEditor
      allowInherit={false}
      value={{ mode: 'custom', policy: { failureThreshold: 2, levelsSec: [0, 5], maxSec: 5 } }}
      onChange={() => undefined}
    />);
    expect(root.root.findAllByProps({ value: 'inherit' })).toHaveLength(0);
    expect(root.root.findAllByProps({ value: 'disabled' })).toHaveLength(0);
    expect(root.root.findAllByType('input').map((input) => input.props.value)).toEqual([2, '0, 5', 5]);
    root.unmount();
  });
});
