import { isSignalCardType, type CardType } from '@mi/contracts';

export type DeckActionPolicy = {
  askLabel: 'Ask' | 'Ask about findings';
  compare: boolean;
  briefing: boolean;
};

/** Signal tabs are for reading and discussing findings; entity tabs support comparison workflows. */
export function deckActionPolicy(type: CardType | null): DeckActionPolicy {
  const signal = type != null && isSignalCardType(type);
  return signal
    ? { askLabel: 'Ask about findings', compare: false, briefing: false }
    : { askLabel: 'Ask', compare: true, briefing: true };
}
