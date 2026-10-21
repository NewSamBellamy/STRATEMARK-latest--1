/**
 * Plain wording for what the Overview can and cannot say about time. Nothing
 * here guesses: a story is "recent" only when dates support it, and an
 * undated item says so.
 */
import type { LiveIntelItem } from '@mi/contracts';

type Story = Pick<LiveIntelItem, 'stale' | 'publishedDate'>;

const hasDate = (item: Story): boolean => {
  const raw = item.publishedDate?.trim();
  return Boolean(raw) && Number.isFinite(new Date(raw as string).getTime());
};

/**
 * "15 stories (dates not reported)" until stories carry a reported date;
 * "recent" only when every counted story does. Stale items are not counted.
 */
export function storiesCaption(items: readonly Story[]): string | null {
  const live = items.filter((item) => !item.stale);
  if (live.length === 0) return null;
  const noun = live.length === 1 ? 'story' : 'stories';
  const dated = live.filter(hasDate).length;
  if (dated === live.length) return `${live.length} recent ${noun}`;
  if (dated === 0) return `${live.length} ${noun} (dates not reported)`;
  return `${live.length} ${noun} (${dated} with a reported date)`;
}
