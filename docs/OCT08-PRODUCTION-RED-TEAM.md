Stratemark Production Red Team — October 8
I reviewed the full 8-minute-44-second recording, including the deck, card preview, company dashboard, research output, live intelligence, organization data, market findings, timeline, reporting, and empty states.
Verdict
Stratemark is visually promising but not ready for production or a public beta yet.
The cards are currently the strongest part of the product. The primary risks are now:
1. Research trustworthiness.
2. Incomplete research coverage.
3. Long-running work with no dependable completion.
4. Raw research being exposed instead of finished intelligence.
5. Major screens appearing functional while containing empty, stale, unverified, or unfinished information.
6. A severe quality gap between the polished cards and the deeper product.
The app currently feels approximately 65–70% product-complete visually, but substantially less complete as a dependable research product.
P0 — Launch blockers
These must be resolved before inviting real users.
1. A completed deck does not actually look complete
The Frontier AI Labs deck contains seven companies, but the visible counts show:
- Infrastructure: 0
- Distribution: 0
- Culture: 0
- Vice: 0
- Insight: 0
- Barrier to Entry: 0
The product presents all these categories as core parts of a market deck. A deck with every specialist category empty does not fulfill that promise.
“Nothing surfaced in the first pass,” “actively hunting,” and queued research states cannot remain the final visible experience.
2. Research does not have a trustworthy finish line
The recording repeatedly shows:
- “Live research”
- “Agent researching 1 section”
- “Hunting missing figures”
- “Searching latest news”
- Queued research waiting for another hunt
- Report composition continuing for more than a minute
- Background research continuing while the user navigates
There is no clear point where a user can confidently say:
“This deck is ready, complete, and safe to use.”

Every research job needs an understandable final state: complete, partially complete, failed, paused, or awaiting review.
3. Important company figures are explicitly unverified
The OpenAI card displays:
- 4.5K employees
- $20B ARR
- 1B active users
- $852B valuation
Yet the inspection view labels these figures as:
- “Source reported — not verified”
- “Reporting date unavailable”
Those warnings undermine the central value of the card. Stratemark cannot present large financial and operating figures as authoritative while simultaneously admitting that their reporting periods and verification status are unknown.
Every displayed figure needs:
- A clear definition.
- The period it describes.
- Its publication date.
- Its effective date.
- Its source.
- A confidence or verification status that users can understand.
- Protection against figures from incompatible periods being shown together as a current snapshot.
4. “Recorded today” is being confused with “current”
Several figures say they were recorded on October 8, 2026, while also saying the reporting date is unavailable.
The date Stratemark found a figure is not the date the figure represents. This creates a serious risk that old information appears current.
The product must clearly distinguish:
- When the underlying event occurred.
- When the source published the information.
- When Stratemark collected it.
- Whether it remains current.
5. Research quality is inconsistent across companies
OpenAI appears reasonably populated while other companies shown during the card sequence contain unknown or incomplete fields.
The product must work across:
- Public companies.
- Private companies.
- Startups.
- Subsidiaries.
- Research laboratories.
- Companies with limited disclosures.
- Non-US companies.
A polished result for one famous company is not enough to establish product reliability.
6. The source experience is not production quality
The Research & Sources section exposes what looks like raw generated research:
- Field labels such as “Source Type,” “Headline,” and “Reported Detail.”
- Full URLs inside body copy.
- Repetitive bullets.
- Long undifferentiated paragraphs.
- Reddit discussions presented alongside primary company disclosures.
- Repeated openai.com domain entries without enough context.
This reads like internal agent output, not a finished intelligence product.
Users need to understand:
- Which source supports which claim.
- Why that source is credible.
- Whether it is primary, secondary, community, or speculative.
- When it was published.
- Whether multiple entries are duplicates.
- Where sources disagree.
- Which claims remain unsupported.
7. Source quantity currently creates false confidence
The interface says things such as “45 research sources” and “8 sources tracked,” but many entries appear to be repeated pages or repeated domains.
A high source count is not meaningful if sources are duplicated, weak, unrelated, or not connected to individual claims. The product must represent the actual depth and diversity of evidence—not simply the number of retrieved items.
8. Major dashboard sections are empty or misleading
Visible incomplete states include:
- Live Intel showing “No stories yet.”
- Product lineup containing no original-backed details.
- Roadmap showing zero items for Now, Next, and Later.
- Live Landing Page showing a blank embedded area.
- Specialist deck categories containing zero cards.
- Research continuing without visible results.
- Missing portraits throughout the team view.
A production dashboard cannot contain this many empty destinations while presenting itself as a comprehensive company intelligence workspace.
9. The company overview is not sufficiently editorialized
The overview contains extensive text and long product lists, but the information hierarchy is weak. It feels like assembled research rather than a clear executive briefing.
The overview must immediately communicate:
- What the company does.
- Why it matters in this market.
- Its current position.
- The most important verified business figures.
- Recent changes.
- Material opportunities and risks.
- What is known versus unknown.
The current experience requires too much scanning and scrolling to identify those answers.
10. Long-form findings are trapped in a small modal
The detailed DevDay report becomes a lengthy article inside a constrained scrolling window. This reduces readability and makes the report feel secondary.
A deep report must feel like a finished research artifact, with:
- Clear structure.
- Comfortable reading width.
- Section navigation.
- Visible sourcing.
- Publication and freshness information.
- A clear distinction between facts, analysis, and interpretation.
- A complete ending and completion state.
- A dependable share or export experience.
11. Generated imagery weakens trust
The company dashboard includes obviously generated imagery marked “This image was generated by AI.” The imagery is decorative and does not prove anything about the company.
For a fact-focused intelligence product, generated images must never look like documentary evidence. Users must not confuse illustration with a real company asset, location, product, employee, or event.
P1 — High-impact product quality gaps
12. Quality changes sharply between screens
The deck and cards feel considered. The deeper dashboard often feels like an internal research console.
The complete product must maintain the same level of polish across:
- Cards.
- Card inspection.
- Company overview.
- Metrics.
- Sources.
- Live intelligence.
- Organization data.
- Timelines.
- Findings.
- Reports.
- Empty and failure states.
13. Navigation is overloaded
The dashboard contains many top-level sections, with additional sections hidden under “More.” Some sections overlap conceptually, while others are too incomplete to justify their prominence.
Every visible destination must have a clear, unique purpose. Users should not have to explore several tabs to determine where the useful research lives.
14. Research controls are unclear
The interface simultaneously presents:
- Research.
- Background research.
- Pause background research.
- Search within a company.
- Ask/chat controls.
- Report composition.
- Card-level research.
- Deck-level research.
The user cannot easily tell which action updates the card, which updates the dashboard, which consumes their key, or which creates a separate report.
Each action needs a distinct and predictable outcome.
15. Progress communication is too vague
“Agent researching 1 section” does not explain:
- Which section.
- What has completed.
- What remains.
- Whether progress is being made.
- Whether the job is delayed.
- Whether it failed.
- Whether costs are accumulating.
- Whether closing the app will interrupt it.
The application needs trustworthy progress and failure communication throughout the full research lifecycle.
16. Error states are too passive
Empty sections often say that no information is available or that research is ongoing. This does not distinguish among:
- No information exists.
- No source could be accessed.
- Research has not started.
- Research is queued.
- Research failed.
- The provider rejected the request.
- A rate limit was reached.
- The result did not meet quality standards.
Those are materially different states and must not look the same.
17. The organization view is not yet dependable
The Team & Org Chart contains a mixture of:
- Real portraits.
- Initials.
- Truncated titles.
- Executives.
- Directors.
- Board members.
- People whose current relationship is not immediately clear.
The page claims to map reporting relationships, but the visible experience primarily resembles a collection of people.
Every person shown must have:
- Correct identity.
- Correct current role.
- Correct relationship to the company.
- Accurate portrait attribution.
- Current tenure status.
- Supporting evidence.
- Clear separation between management, board, investors, advisers, and former personnel.
18. Timelines lack visible evidence at the point of use
The history timeline is one of the stronger dashboard experiences, but its events and quotes do not visibly expose their evidence in the normal view.
Every milestone, number, quote, and interpretation needs accessible provenance. Quotes particularly need speaker, date, context, and source.
19. Duplicate decks create ambiguity
The sidebar shows two decks with the same name: “Frontier AI Labs.”
Users need to distinguish decks by meaningful identity, including freshness, status, scope, or creation information. They should never have to guess which deck is current.
20. Card summaries still truncate awkwardly
Several card and inspection summaries end in clipped phrases or ellipses. The card should communicate one complete, high-value thought—not display the beginning of a paragraph that happened to fit.
21. Ranking lacks visible authority
Labels such as “Category Leaders” and “Scale Stage” appear on cards, but the recording does not establish:
- What they mean.
- Which evidence determines them.
- How companies compare.
- When rankings were last calculated.
- Whether missing data affects the result.
Rankings cannot feel decorative. They must be explainable and consistently applied.
22. Market coverage appears too narrow
Seven companies is not a convincing representation of the Frontier AI Labs market without a clear explanation of scope and inclusion criteria.
The deck must explain:
- What market was understood.
- Which companies qualified.
- Which were excluded.
- Whether subsidiaries and parent companies are separate.
- Whether the search is still expanding.
- Whether coverage is complete enough to support rankings.
23. The market-level story is missing
The product contains company information, but the visible journey does not provide a strong market-level conclusion.
A completed market deck should answer:
- What is changing in the market?
- Who is winning and why?
- Where is value accumulating?
- What are the major risks and barriers?
- Which companies are genuinely comparable?
- What remains uncertain?
- What has changed since the last research run?
P2 — Production readiness not demonstrated by the audit
These areas were not proven in the recording and therefore must be treated as unverified:
Complete user journey
- Creating a new deck from a blank state.
- Time to first useful result.
- Time to a completed deck.
- Canceling and resuming research.
- Recovering a partially completed deck.
- Reopening the app and retaining all research.
- Deleting or archiving a deck.
Core product actions
- Saved Cards.
- Reports library.
- Ask about findings.
- Company comparison.
- Deck sharing.
- Individual card sharing.
- Report sharing or export.
- Recipient experience when opening shared research.
- Updating and reranking an existing deck.
Provider and credential behavior
- Missing key.
- Invalid key.
- Expired or revoked key.
- Rate limiting.
- Quota exhaustion.
- Provider outage.
- Partial provider response.
- Unexpected cost escalation.
- Switching providers without damaging saved research.
Data integrity
- Duplicate companies.
- Company-name collisions.
- Parent/subsidiary confusion.
- Conflicting figures from different sources.
- Currency and unit normalization.
- Historical versus current figures.
- Private-company estimates.
- Companies with little public information.
- Source removal or changed webpages.
- Updates that contradict previously stored research.
Product reliability
- Crash recovery.
- Interrupted internet connection.
- App restart during research.
- Long-running background jobs.
- Multiple simultaneous decks.
- Large markets containing many companies.
- Performance after months of accumulated research.
- Data backup and restore.
Security and privacy
- Secure treatment of user API credentials.
- Clear disclosure of which providers receive queries.
- Local-data guarantees.
- Research deletion.
- Data export.
- Secret removal from logs and reports.
- Safe handling of externally retrieved webpage content.
- Separation between users on shared computers.
Shipping quality
- Signed desktop installer.
- Updating the installed application.
- Compatibility across supported operating systems.
- Accessibility.
- Keyboard navigation.
- Screen-reader support.
- Responsive behavior at smaller window sizes.
- Clear privacy policy and terms.
- Licensing and attribution for logos, portraits, images, and retrieved content.
- Diagnostics users can share without exposing credentials or private research.
Production acceptance standard
Stratemark should not be considered ready until a fresh user can:
1. Enter a market.
2. Receive useful populated cards quickly.
3. Understand what research is still running.
4. Trust every displayed figure or clearly understand its uncertainty.
5. Open any card and find a coherent, sourced company briefing.
6. Navigate the deeper dashboard without encountering raw agent output.
7. Find meaningful market-level cards and conclusions.
8. Reopen the application without losing work.
9. Recover gracefully from provider and network failures.
10. Share a card, deck, or report that looks complete to someone who has never used Stratemark.
11. Understand when research was updated and what changed.
12. Control paid research activity without fear of uncontrolled spending.
The blunt conclusion: Stratemark currently demonstrates an attractive card concept sitting on top of an unfinished intelligence system. The next milestone should be judged by trustworthy completion, not by the number of dashboards, agents, tabs, or retrieved sources. No application code was changed during this audit.