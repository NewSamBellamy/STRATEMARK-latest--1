import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it } from 'vitest';
import { BackgroundResearchControl } from './BackgroundResearchControl';
import { useResearchControl } from './researchControl';

afterEach(() => { act(() => useResearchControl.setState({ paused: false, storageError: null })); });
it('wires the visible dashboard switch to the same durable control as decks', async () => {
  const user = userEvent.setup();
  render(<BackgroundResearchControl />);
  await user.click(screen.getByRole('button', { name: 'Pause background research' }));
  expect(useResearchControl.getState().paused).toBe(true);
  expect(screen.getByRole('button', { name: 'Resume background research' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/manual checks can still use your key/i)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Resume background research' }));
  expect(useResearchControl.getState().paused).toBe(false);
});
it('does not hide a preference persistence failure', () => {
  useResearchControl.setState({ paused: true, storageError: 'Setting could not be saved.' });
  render(<BackgroundResearchControl />);
  expect(screen.getByRole('alert')).toHaveTextContent('Setting could not be saved.');
});
