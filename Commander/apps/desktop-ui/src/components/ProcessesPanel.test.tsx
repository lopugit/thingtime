// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessesPanel } from './ProcessesPanel.js';
import { defaultProcessPreferences } from './processModel.js';
import { nativeRequest } from '../lib/nativeBridge.js';
vi.mock('../lib/nativeBridge.js', () => ({ nativeRequest: vi.fn(async () => undefined) }));
afterEach(cleanup);
it('exposes sorting, time windows, filters and the native pop-out action', () => {
  const change = vi.fn();
  render(
    <ProcessesPanel
      processes={[]}
      preferences={defaultProcessPreferences}
      onPreferencesChange={change}
      onError={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText('Sort by'), { target: { value: 'cpu' } });
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ sort: 'cpu' }));
  fireEvent.change(screen.getByLabelText('Average window'), { target: { value: '86400' } });
  expect(change).toHaveBeenLastCalledWith(expect.objectContaining({ averageSeconds: 86400 }));
  fireEvent.click(screen.getByRole('button', { name: 'Add filter' }));
  expect(change).toHaveBeenLastCalledWith(
    expect.objectContaining({ filters: [expect.objectContaining({ column: 'name' })] }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Open Processes in its own window' }));
  expect(nativeRequest).toHaveBeenCalledWith('processes.open');
});
