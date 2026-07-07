/**
 * Resolve a possibly-relative href against a base and return it ONLY if it is an
 * http(s) URL. Rejects javascript:/data:/vbscript:/mailto: and any unparseable value —
 * so a malicious page (or an LLM-picked selector during self-heal) can never land a
 * dangerous scheme in a published ticketUrl. Returns undefined when unsafe/invalid.
 */
export function safeAbsoluteUrl(href: string, base: string): string | undefined {
  try {
    const u = new URL(href, base);
    if (u.protocol === 'http:' || u.protocol === 'https:') return u.toString();
  } catch {
    /* unparseable -> drop */
  }
  return undefined;
}
