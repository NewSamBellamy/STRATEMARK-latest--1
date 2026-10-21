/** Names short enough for chart axes and table rows. Pure; touches no card face. */

const LEGAL_SUFFIX = /[\s,]+(?:corporation|corp\.?|incorporated|inc\.?|ltd\.?|limited|llc|plc|gmbh|s\.?a\.?|co\.?|company|holdings?|group)$/i;

/**
 * A name short enough for a chart axis or a table row: a trailing parenthetical
 * ("Crusoe (Crusoe Energy Systems)") and a legal suffix ("NVIDIA Corporation")
 * are dropped. Never empties a name, and never touches a name that has neither.
 */
export function shortCompanyName(name: string): string {
  let out = name.replace(/\s*\([^)]*\)\s*$/, '').trim();
  const stripped = out.replace(LEGAL_SUFFIX, '').trim();
  if (stripped.length >= 2) out = stripped;
  return out || name;
}
