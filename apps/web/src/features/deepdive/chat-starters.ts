import type { ResearchScope } from '@mi/contracts';

const companyTypes = new Set(['company', 'infrastructure', 'distribution']);

export function getConversationStarters(scope: ResearchScope | null): string[] {
  if (scope?.kind === 'company' || scope?.kind === 'datapoint') {
    return companyStarters(scope.subject);
  }

  if (scope?.kind === 'cards' && scope.cardIds?.length === 1) {
    const subject = scope.subject?.trim();

    if (scope.cardType === 'insight') {
      return [
        `What evidence supports${subject ? ` “${subject}”` : ' this trend'} — and what is still uncertain?`,
        'What could make this trend misleading, temporary, or wrong?',
        'Who is most affected by this shift, and through what mechanism?',
        'What should we watch next to confirm or reject it?',
      ];
    }

    if (scope.cardType === 'barrier') {
      return [
        `What evidence shows${subject ? ` “${subject}”` : ' this'} is a real barrier rather than an assumption?`,
        'Who has overcome this barrier, and how?',
        'What could weaken or remove this barrier over time?',
        'Which parts of the market feel its effects most?',
      ];
    }

    if (scope.cardType === 'vice') {
      return [
        `What do the sources actually establish${subject ? ` about “${subject}”` : ''}?`,
        'What remains alleged, disputed, or unverified?',
        'Is there a primary source behind this claim?',
        'Has anything materially changed since it was reported?',
      ];
    }

    if (scope.cardType === 'culture') {
      return [
        `What evidence supports${subject ? ` “${subject}”` : ' this signal'}?`,
        'Is this a sustained pattern or a one-off example?',
        'Which sources or people offer a different perspective?',
        'What new evidence would strengthen or weaken this conclusion?',
      ];
    }

    if (scope.cardType && companyTypes.has(scope.cardType)) {
      return companyStarters(subject);
    }
  }

  if (scope?.kind === 'cards') {
    return [
      'Compare these head-to-head: strengths, weaknesses, momentum.',
      'Which of these would you back, and why?',
      'What do these players all miss that a new entrant could take?',
    ];
  }

  return [
    'Who is winning this market right now, and why?',
    "Where's the whitespace a new entrant could take?",
    'What moved in this market in the last month?',
    'Which players look overrated by the hype?',
  ];
}

function companyStarters(subject?: string | null): string[] {
  const company = subject?.trim() || 'this company';
  return [
    `What changed for ${company} in the last 90 days?`,
    'How do they make money — and how durable is it?',
    'Who are their most direct competitors, and where do they lose?',
    'What are the biggest risks ahead?',
  ];
}
