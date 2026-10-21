import { describe, expect, it } from 'vitest';
import { isChallengeHtml, isChallengeTitle, titleOfHtml } from './siteChallenge';

describe('challenge page detection', () => {
  it.each([
    ['Just a moment...', true],
    ['Verify you are human', true],
    ['Verify you are human by completing the action below.', true],
    ['Attention Required! | Cloudflare', true],
    ['Checking your browser before accessing example.com', true],
    ['OpenAI', false],
    ['Crusoe | AI infrastructure', false],
    ['A moment in time: our story', false],
    ['', false],
    [null, false],
  ])('title %s -> %s', (title, expected) => {
    expect(isChallengeTitle(title)).toBe(expected);
  });

  it('reads the title and the Cloudflare markers from markup', () => {
    expect(titleOfHtml('<html><head><title> Just a\n moment... </title>')).toBe('Just a moment...');
    expect(isChallengeHtml('<title>Anything</title><script src="https://challenges.cloudflare.com/turnstile/v0/api.js"></script>')).toBe(true);
    expect(isChallengeHtml('<title>Home</title><p>Welcome</p>')).toBe(false);
  });
});
