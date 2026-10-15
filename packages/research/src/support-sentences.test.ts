import { describe, expect, it } from 'vitest';
import { extractProviderGrounding } from './grounding-support';
import { companyAliases } from './company-aliases';
import { renderCompanyProducts } from './company-products';
import { renderCompanyTeamOrg } from './company-team';
import { SENTENCE_END, widenSupportsToSentences } from './support-sentences';

/** Google marks the supported clause only; the sentence's subject stays outside the span. */
function clauseGrounding(answer: string, clauses: string[], offsets?: number[]) {
  return extractProviderGrounding(answer, {
    groundingChunks: clauses.map((_, i) => ({ web: { uri: `https://bevnet.com/article-${i}`, title: 'bevnet.com' } })),
    groundingSupports: clauses.map((clause, i) => {
      const startIndex = offsets?.[i] ?? answer.indexOf(clause);
      return { segment: { text: clause, startIndex, endIndex: startIndex + clause.length }, groundingChunkIndices: [i] };
    }),
  })!;
}

const company = (name: string, site: string) => ({ id: 'cmp', name, websiteUrl: site, oneLiner: 'x', logoUrl: null, hqLocation: null, brandTheme: null });
const lyres = company("Lyre's Spirit Co.", 'https://lyres.com');
const acme = company('Acme', 'https://acme.com');
const gin = "Lyre's Spirit Co. operates the Gin Alternative as its product.";
const bourbon = "Lyre's Spirit Co. operates the Bourbon Alternative as its product.";
const answer = `${gin} ${bourbon}`;
const widen = (c: ReturnType<typeof company>, g: ReturnType<typeof clauseGrounding>) => widenSupportsToSentences(g, companyAliases(c.name, c.websiteUrl)).supports[0]!;

describe('widenSupportsToSentences: the subject, and only the subject', () => {
  it('gives a clause-only support the company name that precedes it, verbatim, with matching offsets', () => {
    const grounding = clauseGrounding(answer, ['operates the Bourbon Alternative as its product']);
    const widened = widen(lyres, grounding);
    expect(widened.text).toBe(bourbon);
    expect(answer.slice(widened.startIndex, widened.endIndex)).toBe(bourbon);
    expect(widened.sources).toEqual(grounding.supports[0]!.sources);
  });
  it('leaves a support that already is a whole sentence, or has no aliases to check, as it was', () => {
    const whole = clauseGrounding(answer, [bourbon]);
    expect(widenSupportsToSentences(whole, companyAliases(lyres.name, lyres.websiteUrl))).toEqual(whole);
    const clause = clauseGrounding(answer, ['operates the Bourbon Alternative as its product']);
    expect(widenSupportsToSentences(clause, [])).toEqual(clause);
  });
  it('is stable when applied twice', () => {
    const aliases = companyAliases(lyres.name, lyres.websiteUrl);
    const once = widenSupportsToSentences(clauseGrounding(answer, ['operates the Bourbon Alternative as its product']), aliases);
    expect(widenSupportsToSentences(once, aliases)).toEqual(once);
  });
  it('accepts a possessive subject', () => {
    const text = "Acme's flagship Widget Pro is its product. Acme's Widget Pro ships worldwide.";
    expect(widen(acme, clauseGrounding(text, ['flagship Widget Pro is its product'])).text).toBe("Acme's flagship Widget Pro is its product.");
  });

  // Every case below once passed because the widened sentence, not the claim, was the unit of attribution.
  it.each([
    ['another company is the subject', 'Globex, a supplier to Acme, makes the Widget Pro for industrial users.', 'makes the Widget Pro for industrial users'],
    ['the person left the company', 'Bob Stone, who left Acme last year, is the Chief Executive Officer of Globex.', 'is the Chief Executive Officer of Globex'],
    ['the company only "formerly" did it', 'Acme formerly sold the Widget Deluxe line in Europe before discontinuing it.', 'sold the Widget Deluxe line in Europe'],
    ['the rest of the sentence retracts it', 'Acme is a partner of Globex.com, but the partnership ended in 2022.', 'is a partner of Globex'],
    ['the subject carries an aside', 'Acme (acme.com) operates the Bourbon Alternative as its product.', 'operates the Bourbon Alternative as its product'],
  ])('does not lend the company name when %s', (_why, sentence, clause) => {
    const widened = widen(acme, clauseGrounding(sentence, [clause]));
    expect(widened.text).toBe(clause);
  });

  it('does not guess between two identical clauses it cannot tell apart', () => {
    const text = 'Acme operates the Widget Pro. Globex operates the Widget Pro.';
    expect(widen(acme, clauseGrounding(text, ['operates the Widget Pro'], [-1])).text).toBe('operates the Widget Pro');
  });

  it("reads Google's UTF-8 byte offsets, so a curly quote earlier in the answer cannot point at the wrong sentence", () => {
    const text = 'Globex says it’s “great”. Globex operates the Widget Pro. Acme operates the Widget Pro.';
    const clause = 'operates the Widget Pro';
    const charAt = text.lastIndexOf(clause);
    const byteAt = new TextEncoder().encode(text.slice(0, charAt)).length;
    expect(byteAt).toBeGreaterThan(charAt);
    expect(widen(acme, clauseGrounding(text, [clause], [byteAt])).text).toBe('Acme operates the Widget Pro.');
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

  it.each([
    ['a supplier’s product', 'Globex, a supplier to Acme, makes the Widget Pro for industrial users.', 'makes the Widget Pro for industrial users', 'Widget Pro'],
    ['a product Acme used to sell', 'Acme formerly sold the Widget Deluxe line in Europe before discontinuing it.', 'sold the Widget Deluxe line in Europe', 'Widget Deluxe'],
    ['a second company’s product after a legal form', 'Globex sells the Gadget Plan B. Acme is based in Leeds.', 'sells the Gadget Plan B', 'Gadget Plan B'],
  ])('does not list %s as Acme’s', (_why, sentence, clause, product) => {
    const quote = sentence.split(/(?<=[.!?])\s+/)[0]!;
    const { content } = renderCompanyProducts(acme, [], selections(clauseGrounding(sentence, [clause]), quote, product));
    expect(content.products).toEqual([]);
  });
});

describe('team from clause-only supports', () => {
  const quote = 'Acme appointed Avery Founder as its current Chief Executive Officer.';
  const nodes = (role: string, q = quote) => ({ nodes: [], reportedNodes: [{ id: 'avery', name: 'Avery Founder', role, group: 'exec', supportIndex: 0, quote: q }] });

  it('lists the person when the support starts after the company name', () => {
    const grounding = clauseGrounding(quote, ['appointed Avery Founder as its current Chief Executive Officer']);
    const { content } = renderCompanyTeamOrg(acme, [], { ...nodes('Chief Executive Officer'), reportedGrounding: grounding });
    expect(content.nodes.map((n) => n.name)).toEqual(['Avery Founder']);
  });

  it('still refuses a person whose role the sentence does not state', () => {
    const grounding = clauseGrounding(quote, ['appointed Avery Founder as its current Chief Executive Officer']);
    expect(renderCompanyTeamOrg(acme, [], { ...nodes('Chief Financial Officer'), reportedGrounding: grounding }).content.nodes).toEqual([]);
  });

  it('does not make a person who left Acme its chief executive because he runs another company', () => {
    const sentence = 'Bob Stone, who left Acme last year, is the Chief Executive Officer of Globex.';
    const grounding = clauseGrounding(sentence, ['is the Chief Executive Officer of Globex']);
    const out = renderCompanyTeamOrg(acme, [], { nodes: [], reportedGrounding: grounding,
      reportedNodes: [{ id: 'bob', name: 'Bob Stone', role: 'Chief Executive Officer', group: 'exec', supportIndex: 0, quote: 'Bob Stone is the Chief Executive Officer of Globex.' }] });
    expect(out.content.nodes).toEqual([]);
  });
});

describe('SENTENCE_END', () => {
  it('keeps a company legal form followed by a lower-case word inside one sentence', () => {
    expect("Lyre's Spirit Co. operates the Gin. It also sells Rum.".split(SENTENCE_END)).toEqual(["Lyre's Spirit Co. operates the Gin.", 'It also sells Rum.']);
    expect('Acme Ltd. makes the Widget. Acme Inc. sells it.'.split(SENTENCE_END)).toEqual(['Acme Ltd. makes the Widget.', 'Acme Inc. sells it.']);
  });
  it('splits everywhere else, so one sentence never vouches for the next', () => {
    // A capital after the legal form starts a new sentence.
    expect('Jane Doe serves as Chief Executive Officer of Globex Inc. Acme announced layoffs.'.split(SENTENCE_END))
      .toEqual(['Jane Doe serves as Chief Executive Officer of Globex Inc.', 'Acme announced layoffs.']);
    // Single capitals and titles end sentences too ("Plan B.", "Model S.", "Dr.").
    expect('Globex sells the Gadget Plan B. Acme is based in Leeds.'.split(SENTENCE_END)).toEqual(['Globex sells the Gadget Plan B.', 'Acme is based in Leeds.']);
    expect('Tesla sells the Model S. Unlike Rivian, Tesla also sells the Model 3.'.split(SENTENCE_END)).toEqual(['Tesla sells the Model S.', 'Unlike Rivian, Tesla also sells the Model 3.']);
    expect('First line.\nSecond line.'.split(SENTENCE_END)).toEqual(['First line.', 'Second line.']);
  });
});
