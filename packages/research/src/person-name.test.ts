import { describe, expect, it } from 'vitest';
import { dropPartialDuplicates, isPartialOfName, orgGroupFor } from './person-name';
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
  it('does not treat an unreadable (non-Latin) role as the same role as everyone else', () => {
    const rows = [{ id: 'a', name: 'Li Chen', role: '首席执行官', parentId: null }, { id: 'b', name: 'Chen', role: '首席财务官', parentId: null }, { id: 'c', name: 'Jones', role: '', parentId: null }];
    expect(dropPartialDuplicates(rows).map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });
  it('keeps the reporting line of a dropped surname-only record when the fuller one has none', () => {
    const rows = [huml, { id: 'b', name: 'Huml', role: 'Chief Executive Officer', parentId: 'boss' }, { id: 'boss', name: 'Pat Chair', role: 'Chair', parentId: null }];
    expect(dropPartialDuplicates(rows).find((row) => row.id === 'a')?.parentId).toBe('boss');
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

describe('orgGroupFor', () => {
  it.each([
    ['member of the Board of Directors', 'other'],
    ['Independent Director', 'other'],
    ['Director', 'other'],
  ])('%s is not an executive seat', (role, group) => expect(orgGroupFor(role, 'exec')).toBe(group));

  it.each([
    'President and Chief Executive Officer',
    'Chairman of the Executive Board',
    "Chair of Tennant's Board of Directors",
    'Director of Engineering',
    'Managing Director',
    'Senior Vice President, General Counsel',
    'Chief Operating Officer',
    'Head of Product',
  ])('%s keeps the group the model gave', (role) => expect(orgGroupFor(role, 'exec')).toBe('exec'));

  it('never moves a non-exec group, and never invents a group', () => {
    expect(orgGroupFor('Independent Director', 'product')).toBe('other');
    expect(orgGroupFor('Head of Design', 'design')).toBe('design');
  });
});

describe('team tab groups', () => {
  const company = { id: 'cmp', name: 'Tennant Company', websiteUrl: 'https://tennantco.com', oneLiner: 'Floor cleaning equipment', logoUrl: null, hqLocation: null, brandTheme: null };
  const url = 'https://tennantco.com/investors/governance';
  const text = 'Maria Green is a member of the Board of Directors of Tennant Company. David W. Huml is President and Chief Executive Officer of Tennant Company.';
  const source = { requestedUrl: url, finalUrl: url, status: 'retrieved' as const, httpStatus: 200, contentHash: 'c'.repeat(64), text, retrievedAt: '2026-10-14T00:00:00.000Z' };
  const row = (id: string, name: string, role: string, quote: string) => ({ id, name, role, group: 'exec', parentName: null, bio: '', tenure: null, priorCompany: null, notableProject: null, sourceUrl: url, quote });

  it('files a board seat under "other" even when the model called it executive, and leaves the chief executive alone', () => {
    const { content } = renderCompanyTeamOrg(company, [source], { nodes: [
      row('g', 'Maria Green', 'member of the Board of Directors', 'Maria Green is a member of the Board of Directors of Tennant Company.'),
      row('h', 'David W. Huml', 'President and Chief Executive Officer', 'David W. Huml is President and Chief Executive Officer of Tennant Company.'),
    ] });
    expect(Object.fromEntries(content.nodes.map((node) => [node.name, node.group]))).toEqual({ 'Maria Green': 'other', 'David W. Huml': 'exec' });
  });
});
