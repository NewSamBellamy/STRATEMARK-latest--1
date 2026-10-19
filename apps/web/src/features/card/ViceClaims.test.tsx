import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ViceClaim } from '@mi/contracts';
import { ViceClaims } from './ViceClaims';

vi.mock('@/features/factcheck/FactCheck', () => ({ FactCheck: () => null }));

const claim = (over: Partial<ViceClaim>): ViceClaim => ({
  id: 'v1', companyId: 'c', claimText: 'Fined over a recall.', sourceTitle: 'Wire', sourceUrl: 'https://wire.example/a',
  ...over,
}) as ViceClaim;

describe('ViceClaims sources', () => {
  it('links a web source', () => {
    render(<ViceClaims claims={[claim({})]} companyName="Acme" />);
    expect(screen.getByRole('link', { name: /Wire/ })).toHaveAttribute('href', 'https://wire.example/a');
  });

  it('names a source whose address is not a web page but does not link it', () => {
    render(<ViceClaims claims={[claim({ sourceUrl: 'javascript:alert(1)' })]} companyName="Acme" />);
    expect(screen.getByText('Wire')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
