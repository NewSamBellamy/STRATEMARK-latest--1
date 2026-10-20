import type { ImportPlan } from '@mi/research';
import type { InstallKind } from './browserResearchStore';

type Counts = Pick<ImportPlan, 'decks' | 'companies' | 'skipped' | 'unfinishedResearch' | 'followsLeftOut'>;

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
  if (plan.followsLeftOut > 0) {
    lines.push(`${count(plan.followsLeftOut, 'followed company', 'followed companies')} in the file ${plan.followsLeftOut === 1 ? 'is' : 'are'} not brought in. Follow them again from Today if you want them.`);
  }
  return lines.join(' ');
}

/**
 * What is kept of the research this replaces, said as it is. The backup is only
 * the revision before the latest save, so it is never promised as a safe copy:
 * an import keeps the research it replaces in its own place.
 */
function keptLine(kind: InstallKind, replacesEarlierCopy: boolean, where: 'browser' | 'desktop'): string {
  if (kind === 'import' && where === 'desktop') {
    return "Your current research is saved as a file named repo.before-import.json in the app's research folder, and you can import that file to go back. Your next import replaces that file.";
  }
  if (kind === 'import') {
    return `Your current research is kept as a separate copy from before the import, and Settings can restore it until you import another file.${replacesEarlierCopy ? ' That replaces the copy you kept from your last import.' : ''}`;
  }
  return 'Your current research stays available as the backup until you next make a change.';
}

/**
 * Importing starts no research, but the app's ordinary background work applies
 * to the decks it brings in: a deck that is due is refreshed on its schedule, and
 * opening one fills in missing figures. Both stop while background research is
 * paused, so the question says exactly that.
 */
const BACKGROUND_LINE = 'Decks you bring in work like your own: unless background research is paused, the app can refresh a deck that is due and fill in missing figures when you open one.';

/** The full question for the confirmation box. `what` names the source: "this export", "the saved backup". */
export function importQuestion(plan: Counts, what: string, options: { kind?: InstallKind; replacesEarlierCopy?: boolean; where?: 'browser' | 'desktop' } = {}): string {
  const kind = options.kind ?? 'import';
  return `Replace this workspace with ${what}?\n\n${importSummary(plan)}\n\n${keptLine(kind, options.replacesEarlierCopy === true, options.where ?? 'browser')} ${BACKGROUND_LINE}`;
}
