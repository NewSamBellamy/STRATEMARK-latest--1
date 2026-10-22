import { describe, expect, it } from 'vitest';
import { overviewParagraph } from './overviewSummary';

const reuters = { title: 'Reuters', url: 'https://reuters.com/a' };
const gartner = { title: 'Gartner', url: 'https://gartner.com/b' };

describe('overviewParagraph', () => {
  it('joins the description, the brief lead sentences and the recorded product names into one paragraph', () => {
    const out = overviewParagraph({
      name: 'Acme',
      description: 'Acme builds industrial widgets for factories.',
      takeaways: [
        { text: 'Acme sells to plant managers across Europe and Asia. It also runs a service arm.', links: [reuters] },
        { text: 'Acme holds a leading share of the European widget market.', links: [gartner, reuters] },
      ],
      productNames: ['WidgetOS', 'Gearbox'],
    });
    expect(out.sentences).toEqual([
      'Acme builds industrial widgets for factories.',
      'Acme sells to plant managers across Europe and Asia.',
      'Acme holds a leading share of the European widget market.',
      'Products on record include WidgetOS and Gearbox.',
    ]);
    expect(out.links.map((l) => l.url)).toEqual([reuters.url, gartner.url]);
    expect(out.products).toEqual(['WidgetOS', 'Gearbox']);
  });

  it('does not repeat a sentence the description already says, nor a product already named', () => {
    const out = overviewParagraph({
      name: 'Acme',
      description: 'Acme builds industrial widgets for factories with WidgetOS.',
      takeaways: [{ text: 'Acme builds industrial widgets for factories.', links: [reuters] }],
      productNames: ['WidgetOS'],
    });
    expect(out.sentences).toEqual(['Acme builds industrial widgets for factories with WidgetOS.']);
    expect(out.links).toEqual([]);
    expect(out.products).toEqual([]);
  });

  it('names a short product that only appears inside another word, and a non-Latin product name', () => {
    const out = overviewParagraph({
      name: 'Acme',
      description: 'Acme builds a pipeline of industrial widgets for factories.',
      takeaways: [],
      productNames: ['Pi', '日本語'],
    });
    expect(out.products).toEqual(['Pi', '日本語']);
  });

  it('ends a sentence cut where a list began at the colon, and caps the length', () => {
    const out = overviewParagraph({
      name: 'Acme',
      description: null,
      takeaways: [
        { text: 'Acme sells directly to four distinct buyer personas: 1.', links: [] },
        { text: 'Second statement about the company and its customers.', links: [] },
        { text: 'Third statement about markets the company serves today.', links: [] },
        { text: 'Fourth statement about its partners and channel reach.', links: [] },
        { text: 'Fifth statement about growth that would make it too long.', links: [] },
      ],
      productNames: [],
    });
    expect(out.sentences[0]).toBe('Acme sells directly to four distinct buyer personas.');
    expect(out.sentences).toHaveLength(4);
  });

  it('writes nothing when nothing is stored', () => {
    expect(overviewParagraph({ name: 'Acme', description: '', takeaways: [], productNames: [] }).sentences).toEqual([]);
  });
});
