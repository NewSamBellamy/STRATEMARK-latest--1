import { describe, expect, it } from 'vitest';
import { homepageCompanySummary, isPendingCompanySummary, UNSUPPORTED_COMPANY_SUMMARY } from './company-summary';
import type { OriginalSourceReceipt } from './original-source';

const page = (html: string, finalUrl = 'https://www.brinc.com/'): OriginalSourceReceipt => ({
  requestedUrl: 'https://brinc.com', finalUrl, status: 'retrieved', httpStatus: 200,
  retrievedAt: '2026-10-13T00:00:00.000Z', contentHash: 'a'.repeat(64), text: html,
});

describe('homepageCompanySummary', () => {
  it('takes the page\'s own description, entities decoded, cited to the homepage', () => {
    const out = homepageCompanySummary({ companyName: 'Brinc', websiteUrl: 'https://brinc.com',
      homepage: page('<head><meta content="Brinc is a US company developing drones that serve public safety teams&#x27; needs." name="description"></head><body>Menu</body>') });
    expect(out?.summary).toBe("Brinc is a US company developing drones that serve public safety teams' needs.");
    expect(out?.citations[0]?.url).toBe('https://www.brinc.com/');
  });

  it('prefers a self-describing body sentence over an imperative tagline', () => {
    const out = homepageCompanySummary({ companyName: 'Brinc', websiteUrl: 'https://brinc.com',
      homepage: page('<meta name="description" content="Experience the future of drones for public safety with Brinc."><p>Brinc builds rugged drones for police and fire departments.</p>') });
    expect(out?.summary).toBe('Brinc builds rugged drones for police and fire departments.');
  });

  it('never uses testimonials, negations or cookie text from the body', () => {
    const html = '<p>Brinc does not provide drone pilot services to anyone.</p><p>Our team loves working with Brinc every single day.</p><p>We use cookies to provide you with a better browsing experience.</p>';
    expect(homepageCompanySummary({ companyName: 'Brinc', websiteUrl: 'https://brinc.com', homepage: page(html) })).toBeNull();
  });

  it('rejects a homepage that redirected off the company\'s domain, or one that did not load', () => {
    const html = '<meta name="description" content="Brinc builds rugged drones for police and fire departments.">';
    expect(homepageCompanySummary({ companyName: 'Brinc', websiteUrl: 'https://brinc.com', homepage: page(html, 'https://www.acquirer.com/unmanned') })).toBeNull();
    expect(homepageCompanySummary({ companyName: 'Brinc', websiteUrl: 'https://brinc.com',
      homepage: { ...page(html), status: 'unavailable', text: undefined } })).toBeNull();
  });

  it('treats the placeholder and empty copy as pending', () => {
    expect(isPendingCompanySummary(UNSUPPORTED_COMPANY_SUMMARY)).toBe(true);
    expect(isPendingCompanySummary('')).toBe(true);
    expect(isPendingCompanySummary('Brinc builds drones.')).toBe(false);
  });
});
