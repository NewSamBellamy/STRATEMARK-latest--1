import { describe, expect, it } from 'vitest';
import { companyAliases, mentionsCompany } from './company-aliases';

describe('companyAliases', () => {
  it.each([
    ['Anthropic, PBC', 'https://www.anthropic.com', 'Anthropic released a model.'],
    ['Mistral AI SAS', 'https://mistral.ai', 'Mistral AI shipped Le Chat.'],
    ['Aleph Alpha GmbH', 'https://aleph-alpha.com', 'Aleph Alpha is based in Heidelberg.'],
    ['Heineken N.V. / Heineken 0.0', 'https://www.theheinekencompany.com', 'Heineken reported results.'],
    ['SpaceX (Space Exploration Technologies Corp.)', 'https://www.spacex.com', 'SpaceX launched Starship.'],
    ['Carlsberg A/S', 'https://www.carlsberggroup.com', 'Carlsberg brews Tuborg.'],
  ])('%s is recognised by its short name', (name, site, text) => {
    expect(mentionsCompany(text, companyAliases(name, site))).toBe(true);
  });

  it('never turns a parenthetical parent or a bare legal form into an alias', () => {
    expect(mentionsCompany('Diageo sells Guinness.', companyAliases('Seedlip (Diageo plc)', 'https://seedlipdrinks.com'))).toBe(false);
    expect(mentionsCompany('The PBC filed a report.', companyAliases('Anthropic, PBC', 'https://www.anthropic.com'))).toBe(false);
  });

  it('uses the registrable domain label, never a subdomain', () => {
    expect(companyAliases('Acme Robotics Inc.', 'https://shop.acmerobotics.co.uk')).toContain('acmerobotics');
    expect(companyAliases('Acme Robotics Inc.', 'https://shop.acmerobotics.co.uk')).not.toContain('shop');
  });
});
