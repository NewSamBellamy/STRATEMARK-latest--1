import type { ImportPlan } from '@mi/research';

type Counts = Pick<ImportPlan, 'decks' | 'companies' | 'skipped' | 'unfinishedResearch'>;

const count = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** What an import will do, in plain words, for the confirmation shown before anything is replaced. */
export function importSummary(plan: Counts): string {
  const lines = [`This brings in ${count(plan.decks, 'deck')} and ${count(plan.companies, 'company', 'companies')}.`];
  if (plan.skipped > 0) {
    lines.push(`${count(plan.skipped, 'item')} in the file could not be read, so ${plan.skipped === 1 ? 'it is' : 'they are'} left out.`);
  }
  if (plan.unfinishedResearch > 0) {
    lines.push(`${count(plan.unfinishedResearch, 'research run')} that ${plan.unfinishedResearch === 1 ? 'was' : 'were'} still going when the file was saved will not be started again.`);
  }
  return lines.join(' ');
}

/** The full question for the confirmation box. `what` names the source: "this export", "the saved backup". */
export function importQuestion(plan: Counts, what: string): string {
  return `Replace this workspace with ${what}?\n\n${importSummary(plan)}\n\nYour current research will become the backup. Nothing is researched until you ask.`;
}
