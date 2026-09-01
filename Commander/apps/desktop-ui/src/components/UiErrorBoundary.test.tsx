// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { UiErrorBoundary } from './UiErrorBoundary.js';

afterEach(cleanup);

it('keeps a renderer failure visible and recoverable', () => {
  const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const BrokenView = () => {
    throw new Error('Picker render failed');
  };

  render(
    <UiErrorBoundary>
      <BrokenView />
    </UiErrorBoundary>,
  );

  expect(screen.getByRole('alert')).toHaveTextContent('Commander could not display this view.');
  expect(screen.getByText('Picker render failed')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Reload Commander' })).toBeVisible();
  report.mockRestore();
});
