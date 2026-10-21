import { describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { buildDataset } from '@mi/mocks';
import type { VerifyMetricResult } from '@mi/contracts';
import { makeRepo, renderWithProviders } from '@/test/test-utils';
import { FactCheck } from './FactCheck';

const base = buildDataset().metrics[0]!;
function setup(patch: Partial<VerifyMetricResult> = {}) {
  const result: VerifyMetricResult = {
    metric: { ...base, metricType: 'employees', value: 100, confidence: 'verified' },
    verdict: 'supported', changed: false, retieredCardIds: [],
    rationale: 'Original source supports this figure.', citations: [], ...patch,
  };
  const verifyMetric = vi.fn().mockResolvedValue(result);
  const factCheck = vi.fn().mockResolvedValue({ verdict: 'supported', rationale: 'Search summary agrees.', citations: [] });
  const repository = Object.assign(makeRepo(), { verifyMetric, factCheck });
  const rendered = renderWithProviders(<FactCheck claim="Example has 100 employees" companyName="Example"
    companyId={base.companyId} metricType="employees" storedValue={100} />, { repository });
  return { ...rendered, verifyMetric, factCheck };
}

describe('metric fact-check evidence route', () => {
  it('explains blocked original sources without triggering another research call', async () => {
    const { user, verifyMetric } = setup({ verdict: 'unverified', originalSources: [{
      requestedUrl: 'https://reuters.com/report', status: 'blocked', retrievedAt: '2026-10-05T00:00:00.000Z',
      reason: 'Browser source requires protected desktop retrieval.',
    }] });
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    await user.click(await screen.findByText('Inspect source checks (1)'));
    expect(screen.getByText('Blocked')).toBeInTheDocument();
    expect(screen.getByText('Browser source requires protected desktop retrieval.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'reuters.com' })).toHaveAttribute('href', 'https://reuters.com/report');
    expect(verifyMetric).toHaveBeenCalledTimes(1);
  });
  it('renders a retained extract as text, not executable markup or proof', async () => {
    const { user, container } = setup({ verdict: 'unverified', originalSources: [{
      requestedUrl: 'javascript:alert(1)', status: 'retrieved', retrievedAt: '2026-10-05T00:00:00.000Z',
      text: '<img src=x onerror=alert(1)> Unrelated company has 100 employees.', truncated: true,
    }] });
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    await user.click(await screen.findByText('Inspect source checks (1)'));
    expect(screen.getByText(/Unrelated company has 100 employees/)).toBeInTheDocument();
    expect(screen.getByText(/Reading a page does not confirm the figure/)).toBeInTheDocument();
    expect(screen.getByText(/Partial page extract/)).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a[href^="javascript:"]')).toBeNull();
  });
  it('distinguishes an empty search from an unreadable page', async () => {
    const { user } = setup({ verdict: 'unverified', originalSources: [] });
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    expect(await screen.findByText(/No original pages were attempted/)).toBeInTheDocument();
  });
  it('uses the protected verification route once, not summary-only fact-checking first', async () => {
    const { user, verifyMetric, factCheck } = setup();
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    expect(await screen.findByText('Supported')).toBeInTheDocument();
    expect(verifyMetric).toHaveBeenCalledTimes(1);
    expect(factCheck).not.toHaveBeenCalled();
  });
  it.each([false, true])('never claims freshness or a corrected number for an unverified attempt (changed=%s)', async changed => {
    const { user } = setup({ verdict: 'unverified', changed, rationale: 'No readable original source.',
      metric: { ...base, metricType: 'employees', value: 100, confidence: 'estimated' } });
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    expect(await screen.findByText('Unverified')).toBeInTheDocument();
    expect(screen.queryByText(/freshness updated|corrected from live sources|confirms the stored figure/i)).not.toBeInTheDocument();
    expect(screen.getByText(/figure remains unverified/i)).toBeInTheDocument();
  });
  it('describes an accepted value correction only after write-back succeeds', async () => {
    const { user } = setup({ verdict: 'contradicted', changed: true,
      metric: { ...base, metricType: 'employees', value: 200, confidence: 'verified' } });
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    expect(await screen.findByText(/stored figure updated from accepted evidence/i)).toBeInTheDocument();
  });
  it('does not describe a human-locked number as an automated correction', async () => {
    const { user } = setup({ verdict: 'contradicted', changed: false,
      metric: { ...base, metricType: 'employees', value: 100, confidence: 'user_verified' } });
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    expect(await screen.findByText(/human-reviewed figure was preserved/i)).toBeInTheDocument();
    expect(screen.queryByText(/corrected from live sources|freshness updated/i)).not.toBeInTheDocument();
  });
  it('keeps narrative checks on the existing read-only route', async () => {
    const factCheck = vi.fn().mockResolvedValue({ verdict: 'unverified', rationale: 'Insufficient evidence.', citations: [] });
    const verifyMetric = vi.fn();
    const { user } = renderWithProviders(<FactCheck claim="A narrative claim" companyName="Example" />,
      { repository: Object.assign(makeRepo(), { factCheck, verifyMetric }) });
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    expect(await screen.findByText('Unverified')).toBeInTheDocument();
    expect(factCheck).toHaveBeenCalledTimes(1);
    expect(verifyMetric).not.toHaveBeenCalled();
  });
  it('reports failed verification and retries only on a user click', async () => {
    const { user, verifyMetric, factCheck } = setup();
    verifyMetric.mockRejectedValueOnce(new Error('Source request failed'));
    await user.click(screen.getByRole('button', { name: 'Fact-check' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No result has been confirmed');
    expect(verifyMetric).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Retry verification' }));
    expect(await screen.findByText('Supported')).toBeInTheDocument();
    expect(verifyMetric).toHaveBeenCalledTimes(2);
    expect(factCheck).not.toHaveBeenCalled();
  });
  it('does not silently fall back to summary verification on unsupported transports', async () => {
    const factCheck = vi.fn();
    renderWithProviders(<FactCheck claim="Example has 100 employees" companyName="Example"
      companyId={base.companyId} metricType="employees" />,
      { repository: Object.assign(makeRepo(), { factCheck, verifyMetric: undefined }) });
    expect(screen.getByRole('button', { name: 'Verification unavailable' })).toBeDisabled();
    expect(factCheck).not.toHaveBeenCalled();
  });
});
