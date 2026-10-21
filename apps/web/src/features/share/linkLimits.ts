/**
 * What a share link can honestly be pasted into. The whole snapshot travels inside the link, so a
 * deck's link runs to many thousands of characters, and chat apps cut a message at a fixed length:
 * Discord at 2,000 characters, Slack and Telegram at about 4,000. Past the first limit the dialog must
 * say so instead of promising the link "works anywhere".
 */

/** A link at or under this fits in every chat app we know of (Discord is the tightest at 2,000). */
export const CHAT_LINK_LIMIT = 2_000;

/** A plain-English note about a link too long for chat apps; null when it fits. */
export function longLinkNote(length: number): string | null {
  if (!Number.isFinite(length) || length <= CHAT_LINK_LIMIT) return null;
  return `This link is ${Math.round(length).toLocaleString('en-US')} characters long, because the whole research travels inside it. `
    + 'Discord cuts messages at 2,000 characters, Slack and Telegram at about 4,000, so it will not paste into those chats. '
    + 'Email, notes and most browsers take it. To share in a chat, download the page below and host it, or create a short link.';
}
