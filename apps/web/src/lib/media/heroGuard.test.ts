import { describe, expect, it } from 'vitest';
import { heroNamesOtherCompany } from '@/lib/media/heroGuard';

const mistral = { name: 'Mistral AI', website: 'https://mistral.ai' };

describe('heroNamesOtherCompany', () => {
  it.each([
    ['https://cdn.microsoft.com/og/hero.png', null, true],
    ['https://img.example.com/images/Microsoft-logo.png', null, true],
    ['https://img.example.com/a.png', 'Microsoft logo', true],
    ['https://wsrv.example/image?url=' + encodeURIComponent('https://assets.nvidia.com/x.jpg'), null, true],
    ['https://cdn.mistral.ai/og.png', null, false],
    ['https://img.example.com/a.png', 'Mistral AI headquarters', false],
    ['https://img.reuters.com/photo-123.jpg', 'A data center', false],
    ['not a url', null, false],
  ])('%s alt=%s -> %s', (src, alt, expected) => {
    expect(heroNamesOtherCompany(src, alt, mistral)).toBe(expected);
  });
});
