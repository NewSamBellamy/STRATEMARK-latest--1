/**
 * Verbatim Equinix profile answer + provider support spans, captured from a
 * real research run's committed vault (2026-10-08). The supports are the API's
 * own sub-sentence fragments — each metric sentence's subject ("Equinix,
 * Inc.") sits outside the span. This is the regression fixture for
 * sentence-expanded identity binding; do not reformat the strings.
 */
export const EQUINIX_ANSWER_TEXT = "Equinix, Inc. operates as a global digital infrastructure company and real estate investment trust (REIT) that delivers vendor-neutral colocation, private interconnection, and data center platform services enabling organizations to power and interconnect hybrid multicloud architectures and artificial intelligence workloads, as stated in its Annual Report on Form 10-K filed on February 11, 2026.\n\nEquinix, Inc. maintains its corporate headquarters at One Lagoon Drive in Redwood City, California, United States, as disclosed in its Annual Report on Form 10-K filed with the U.S. Securities and Exchange Commission on February 11, 2026.\n\nThe official website of Equinix, Inc. is https://www.equinix.com, as confirmed in the company's SEC regulatory disclosures dated February 11, 2026.\n\nEquinix, Inc. accounts for more than one-third (over 33.3%) of the global colocation interconnect market share based on Synergy Research Group's Q1 2026 Colocation Interconnect Market tracker, as published in an official Equinix disclosure on September 2, 2026.\n\nIn the U.S. data center colocation sector, Equinix, Inc. held a 10.28% revenue market share in 2024, as reported by ResearchAndMarkets on September 5, 2025.\n\nIn the worldwide colocation edge data center market, Equinix, Inc. led the industry with an 11.9% market share in 2025, according to an industry assessment published by Global Market Insights.\n\nEquinix, Inc. holds a public market capitalization of $100.98 billion USD on the NASDAQ exchange under ticker symbol EQIX as of October 5, 2026, as reported by Stock Analysis via Nasdaq Data Link.\n\nFor the fiscal year ended December 31, 2025, Equinix, Inc. generated total consolidated annual revenues of $9.217 billion USD (with recurring revenues accounting for $8.739 billion USD and non-recurring revenues accounting for $478 million USD), as reported in its 2025 Annual Report and Form 10-K filed with the SEC on February 11, 2026.\n\nEquinix, Inc. serviced more than 10,500 customers worldwide across its global footprint as of December 31, 2025, as reported in its Annual Report on Form 10-K filed with the SEC on February 11, 2026.\n\nEquinix, Inc. employed 13,716 employees worldwide as of December 31, 2025 (comprising 5,917 employees based in the Americas, 4,706 in EMEA, and 3,093 in Asia-Pacific), as reported in its Annual Report on Form 10-K filed with the SEC on February 11, 2026.\n\nThe primary brand colors of Equinix, Inc. are Equinix Red (hex code: #EC1E27, with #ED1C24 also documented) and Black (hex code: #000000), as documented in brand identity visual guidelines and the Equinix Brand Center.\n\nOriginal source: https://www.sec.gov/Archives/edgar/data/1101239/000110123926000032/eqix-20251231_g3.jpg\nOriginal source: https://brand.equinix.com/content/dam/brand/en_us/images/pages/home/foundations-home-tile.png";

export const EQUINIX_SUPPORTS = [
  {
    "text": "holds a public market capitalization of $100.98 billion USD on the NASDAQ exchange under ticker symbol EQIX as of October 5, 2026, as reported by Stock Analysis via Nasdaq Data Link",
    "sources": [
      {
        "url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQHcD684oNYlqalX4E8cRWGcjTc7GYtNuJi01_NaF23UatMPUzCvDK5OUsi5Qe13Lm7tjB6vt7DlUyK2m4VAHaO3ZOUgDDJbhfxarqyZDT0_AMurozQTcWExrWyrmz6wrWfMeU-u8hor",
        "title": "stockanalysis.com"
      }
    ]
  },
  {
    "text": "generated total consolidated annual revenues of $9.217 billion USD (with recurring revenues accounting for $8.739 billion USD and non-recurring revenues accounting for $478 million USD), as reported in its 2025 Annual Report and Form 10-K filed with the SEC on February 11, 2026",
    "sources": [
      {
        "url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFrByOdxV7HfrR2KqdAdOpN4Y-cd6vaWOQ-zPl-Kp-N89pxg8gkrGf_wwdwdN-o7Ex3AOVR9JN3m8WudbWsrq-vPb-jDpBva2Ock76fT9FIXz8HCk1x2zgwL81skG5f5BxRScZL-_3B1Jh9As8d1sFjmGPBx_3JfsSlhkBudOiQe9r4Mu6w7uuZ1T9t3pMXA2XVimCd0FxnjTBugnLdiygVsnv7AQ==",
        "title": "equinix.com"
      }
    ]
  },
  {
    "text": "employed 13,716 employees worldwide as of December 31, 2025 (comprising 5,917 employees based in the Americas, 4,706 in EMEA, and 3,093 in Asia-Pacific), as reported in its Annual Report on Form 10-K filed with the SEC on February 11, 2026",
    "sources": [
      {
        "url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFx8V7SpH_SyQ-peTqvFoyMBgI8ZyryNpUvXalduyjIRk1exYIueuG0Jeqnilfdet7jv6wcWciCTb1h2frZmZdmCJ3L_-SSM3Z4j09VPXhs--hIkXx1HJtcTCUIHLTbAdDatHlcBkIIABjILf9cGM22ioMQtc209AbkBxC3wWQSKyP1pRZ15evOsLROp4TKRG46FU8qJ21fYVRq3hZl",
        "title": "equinix.com"
      }
    ]
  }
];
