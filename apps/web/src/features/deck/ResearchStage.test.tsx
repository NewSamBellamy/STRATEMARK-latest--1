import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '@/test/test-utils';
import { ResearchStage } from './ResearchStage';

describe('ResearchStage', () => {
  it('shows the real log and turns streamed discoveries into a market brief', async () => {
    const { user } = renderWithProviders(
      <ResearchStage
        message="Verifying company profiles…"
        pct={0.42}
        lines={[
          { message: 'Market defined: Frontier AI labs', kind: 'step', at: 1 },
          { message: 'Found OpenAI', kind: 'find', at: 2 },
          { message: 'Missing a credible user count', kind: 'warn', at: 3 },
        ]}
      />,
    );

    expect(screen.getByLabelText('Live research log')).toHaveTextContent('Found OpenAI');
    expect(screen.getByText('Verifying company profiles…')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /market brief/i }));
    expect(screen.getByText(/the market, as defined/i)).toBeInTheDocument();
    expect(screen.getByText('Frontier AI labs')).toBeInTheDocument();
  });
});
