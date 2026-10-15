import { describe, expect, it } from 'vitest';
import { dropPartialDuplicates, isPartialOfName } from './person-name';
import { renderCompanyTeamOrg } from './company-team';

describe('isPartialOfName', () => {
  it.each([
    ['Huml', 'David W. Huml'],
    ['D. Huml', 'David W. Huml'],
    ['David Huml', 'David W. Huml'],
    ['Müller', 'Anna Muller'],
    ['Dr. Huml', 'David Huml'],
  ])('%s is part of %s', (partial, full) => expect(isPartialOfName(partial, full)).toBe(true));

  it.each([
    ['David W. Huml', 'David W. Huml'], // the same name is not "partial"
    ['David W. Huml', 'Huml'],
    ['Huml', 'Fay West'],
    ['Wes', 'Fay West'], // a prefix of a word is not the word
    ['', 'Fay West'],
  ])('%s is not part of %s', (partial, full) => expect(isPartialOfName(partial, full)).toBe(false));
});

describe('dropPartialDuplicates', () => {
  const huml = { id: 'a', name: 'David W. Huml', role: 'President and Chief Executive Officer', parentId: null };
  it('drops a surname-only repeat of a listed person with the same role', () => {
    const rows = [huml, { id: 'b', name: 'Huml', role: 'President and Chief Executive Officer', parentId: null },
      { id: 'c', name: 'Fay West', role: 'Chief Financial Officer', parentId: null }];
    expect(dropPartialDuplicates(rows).map((row) => row.id)).toEqual(['a', 'c']);
  });
  it('treats a role worded differently but containing the other as the same position', () => {
    const rows = [huml, { id: 'b', name: 'Huml', role: 'Chief Executive Officer', parentId: null }];
    expect(dropPartialDuplicates(rows).map((row) => row.id)).toEqual(['a']);
  });
  it('keeps a surname that matches a different role, and one that matches nobody', () => {
    const rows = [huml, { id: 'b', name: 'Huml', role: 'Chairman of the Board', parentId: null }, { id: 'c', name: 'Erickson', role: 'General Counsel', parentId: null }];
    expect(dropPartialDuplicates(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
  it('points the reports of a dropped record at the fuller one', () => {
    const rows = [huml, { id: 'b', name: 'Huml', role: 'Chief Executive Officer', parentId: null }, { id: 'c', name: 'Fay West', role: 'Chief Financial Officer', parentId: 'b' }];
    expect(dropPartialDuplicates(rows).find((row) => row.id === 'c')?.parentId).toBe('a');
  });
  it('leaves a clean list untouched', () => {
    const rows = [huml, { id: 'c', name: 'Fay West', role: 'Chief Financial Officer', parentId: null }];
    expect(dropPartialDuplicates(rows)).toEqual(rows);
  });
});

describe('team tab', () => {
  const company = { id: 'cmp', name: 'Tennant Company', websiteUrl: 'https://tennantco.com', oneLiner: 'Floor cleaning equipment', logoUrl: null, hqLocation: null, brandTheme: null };
  const url = 'https://tennantco.com/investors/leadership';
  const quote = 'David W. Huml is President and Chief Executive Officer of Tennant Company. Huml, President and Chief Executive Officer, signed this report for Tennant Company.';
  const source = { requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200, contentHash: 'b'.repeat(64), text: quote, retrievedAt: '2026-10-14T00:00:00.000Z' };
  const row = (id: string, name: string, q: string) => ({ id, name, role: 'President and Chief Executive Officer', group: 'exec', parentName: null,
    bio: '', tenure: null, priorCompany: null, notableProject: null, sourceUrl: url, quote: q });

  it('lists the chief executive once when one page gives the full name and another only the surname', () => {
    const selections = { nodes: [
      row('full', 'David W. Huml', 'David W. Huml is President and Chief Executive Officer of Tennant Company.'),
      row('short', 'Huml', 'Huml, President and Chief Executive Officer, signed this report for Tennant Company.'),
    ] };
    const { content } = renderCompanyTeamOrg(company, [source], selections);
    expect(content.nodes.map((node) => node.name)).toEqual(['David W. Huml']);
  });
});
