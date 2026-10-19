import { describe, expect, it } from 'vitest';
import { CHAT_LINK_LIMIT, longLinkNote } from './linkLimits';

describe('longLinkNote', () => {
  it('says nothing about a link that fits in every chat app', () => {
    expect(longLinkNote(120)).toBeNull();
    expect(longLinkNote(CHAT_LINK_LIMIT)).toBeNull();
  });

  it('tells the truth about a link too long for chat: its size, the limits, what still works, what to do', () => {
    const note = longLinkNote(12_370)!;
    expect(note).toContain('12,370 characters');
    expect(note).toMatch(/Discord/);
    expect(note).toMatch(/Slack and Telegram/);
    expect(note).toMatch(/Email, notes and most browsers/);
    expect(note).toMatch(/download the page/);
    // It never promises the link works everywhere.
    expect(note).not.toMatch(/always works|anywhere/i);
    expect(longLinkNote(CHAT_LINK_LIMIT + 1)).not.toBeNull();
  });

  it('treats a nonsense length as no note', () => {
    expect(longLinkNote(Number.NaN)).toBeNull();
  });
});
