import { describe, expect, it } from 'vitest';
import { extractProviderGrounding } from './grounding-support';
import { renderCompanyProducts } from './company-products';
import { renderCompanyTeamOrg } from './company-team';
import { SENTENCE_END, widenSupportsToSentences } from './support-sentences';

/** Google marks the supported clause only; the sentence's subject stays outside the span. */
function clauseGrounding(answer: string, clauses: string[]) {
  return extractProviderGrounding(answer, {
    groundingChunks: clauses.map((_, i) => ({ web: { uri: `https://bevnet.com/article-${i}`, title: 'bevnet.com' } })),
    groundingSupports: clauses.map((clause, i) => {
      const startIndex = answer.indexOf(clause);
      return { segment: { text: clause, startIndex, endIndex: startIndex + clause.length }, groundingChunkIndices: [i] };
    }),
  })!;
}

const lyres = { id: 'cmp_lyres', name: "Lyre's Spirit Co.", websiteUrl: 'https://lyres.com', oneLiner: 'Non-alcoholic spirits', logoUrl: null, hqLocation: null, brandTheme: null };
const gin = "Lyre's Spirit Co. operates the Gin Alternative as its product.";
const bourbon = "Lyre's Spirit Co. operates the Bourbon Alternative as its product.";
const answer = `${gin} ${bourbon}`;

describe('widenSupportsToSentences', () => {
  it('gives a clause-only support the sentence it sits in, verbatim, with matching offsets', () => {
    const grounding = clauseGrounding(answer, ['operates the Bourbon Alternative as its product']);
    expect(grounding.supports[0]!.text).toBe('operates the Bourbon Alternative as its product');
    const widened = widenSupportsToSentences(grounding).supports[0]!;
    expect(widened.text).toBe(bourbon);
    expect(answer.slice(widened.startIndex, widened.endIndex)).toBe(bourbon);
    expect(widened.sources).toEqual(grounding.supports[0]!.sources);
  });
  it('leaves a support that already is a whole sentence untouched', () => {
    const whole = clauseGrounding(answer, [bourbon]);
    expect(widenSupportsToSentences(whole)).toEqual(whole);
  });
});

describe('products from clause-only supports', () => {
  const selections = (grounding: unknown, quote: string, name: string) => ({ products: [], roadmap: [], reportedGrounding: grounding,
    reportedProducts: [{ name, status: null, supportIndex: 0, quote }], reportedRoadmap: [], reportedRelationships: [] });

  it("lists the product when Google's support leaves out the company name (Lyre's: eleven products found, none shown)", () => {
    const grounding = clauseGrounding(answer, ['operates the Bourbon Alternative as its product']);
    const { content } = renderCompanyProducts(lyres, [], selections(grounding, bourbon, 'Bourbon Alternative'));
    expect(content.products.map((p) => p.name)).toEqual(['Bourbon Alternative']);
    expect(content.products[0]!.description).toContain(bourbon);
  });

  it('still refuses a rival product named in the same kind of sentence', () => {
    const rival = "Lyre's Spirit Co. competes with Seedlip Garden 108, a rival product.";
    const grounding = clauseGrounding(rival, ['competes with Seedlip Garden 108, a rival product']);
    expect(renderCompanyProducts(lyres, [], selections(grounding, rival, 'Seedlip Garden 108')).content.products).toEqual([]);
  });

  it('still refuses a quote that is not in the support sentence', () => {
    const grounding = clauseGrounding(answer, ['operates the Bourbon Alternative as its product']);
    expect(renderCompanyProducts(lyres, [], selections(grounding, "Lyre's Spirit Co. operates the Vodka Alternative as its product.", 'Vodka Alternative')).content.products).toEqual([]);
  });
});

describe('team from clause-only supports', () => {
  const acme = { id: 'cmp', name: 'Acme', websiteUrl: 'https://acme.com', oneLiner: 'Research tools', logoUrl: null, hqLocation: null, brandTheme: null };
  const quote = 'Acme appointed Avery Founder as its current Chief Executive Officer.';

  it('lists the person when the support starts after the company name', () => {
    const grounding = clauseGrounding(quote, ['appointed Avery Founder as its current Chief Executive Officer']);
    const { content } = renderCompanyTeamOrg(acme, [], { nodes: [], reportedGrounding: grounding,
      reportedNodes: [{ id: 'avery', name: 'Avery Founder', role: 'Chief Executive Officer', group: 'exec', supportIndex: 0, quote }] });
    expect(content.nodes.map((n) => n.name)).toEqual(['Avery Founder']);
  });

  it('still refuses a person whose role the sentence does not state', () => {
    const grounding = clauseGrounding(quote, ['appointed Avery Founder as its current Chief Executive Officer']);
    const { content } = renderCompanyTeamOrg(acme, [], { nodes: [], reportedGrounding: grounding,
      reportedNodes: [{ id: 'avery', name: 'Avery Founder', role: 'Chief Financial Officer', group: 'exec', supportIndex: 0, quote }] });
    expect(content.nodes).toEqual([]);
  });
});

describe('SENTENCE_END', () => {
  it('splits real sentences but not after a legal form, honorific or initial', () => {
    expect("Lyre's Spirit Co. operates the Gin. It also sells Rum.".split(SENTENCE_END)).toEqual(["Lyre's Spirit Co. operates the Gin.", 'It also sells Rum.']);
    expect('Anthropic Inc. CEO Dario Amodei spoke. John D. Smith left!'.split(SENTENCE_END)).toEqual(['Anthropic Inc. CEO Dario Amodei spoke.', 'John D. Smith left!']);
    expect('Dr. Chen runs Acme Ltd. in Leeds? Yes.'.split(SENTENCE_END)).toEqual(['Dr. Chen runs Acme Ltd. in Leeds?', 'Yes.']);
  });
});
