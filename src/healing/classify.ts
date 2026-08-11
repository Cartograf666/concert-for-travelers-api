/**
 * Turns a fail-log entry into the repair strategy that could actually fix it.
 *
 * Before this existed, heal.ts had a single coarse gate: `fetch_error`,
 * `csr_detected` and `circuit_open` were skipped outright and everything else
 * went to the LLM re-selector. Measured against a real fail-log (2026-07-24,
 * 84 failures) that meant 69 of 84 failures were never acted on at all, even
 * though most of them were mechanically fixable:
 *
 *   fetch_error      61   <- skipped, but 20x 404 (page moved), 9x 403 (anti-bot
 *                             header check), 7x timeout and 1x 500 are all fixable
 *                             without an LLM; 17x ENOTFOUND are genuinely dead
 *   selectors_stale  13   <- handled (LLM)
 *   parse_error       9   <- handled only when an htmlSample was captured (2 of 9)
 *   csr_detected      1   <- skipped, but flipping type to 'playwright_render' is
 *                             exactly the fix
 *
 * Classification is deliberately string-matching on the error text: the fail-log
 * is a plain JSON artifact and carries no structured error object, so the message
 * produced by axios/got/node's DNS layer is all we have to go on.
 */

export type RepairStrategy =
  /** Domain no longer resolves, or resolves somewhere useless (parked on loopback). Retire it. */
  | 'dead_domain'
  /** TLS is broken in a way that suggests the domain was abandoned/re-parked. Probe, then retire. */
  | 'tls_broken'
  /** 404 -- host is alive, the schedule page moved. Re-discover the URL. */
  | 'url_moved'
  /** 403 -- served, but the request was fingerprinted as a bot. Escalate the HTTP backend. */
  | 'anti_bot'
  /** Timeout / 5xx / 429 / connection reset. Escalate retries and try again. */
  | 'transient'
  /** Events only exist after client-side JS. Switch to a rendering scraper. */
  | 'needs_render'
  /** Layout changed. JSON-LD probe, then LLM re-selection. */
  | 'selectors'
  /** Nothing in this codebase can act on it (e.g. parse_error with no HTML captured). */
  | 'unfixable';

export interface FailureEntry {
  id?: unknown;
  reason?: string;
  error?: string;
  htmlSample?: string;
}

export interface Classification {
  strategy: RepairStrategy;
  /** Human-readable justification, echoed into the repair report and the PR body. */
  detail: string;
}

/** Extracts the HTTP status out of the message axios/got produce for a non-2xx response. */
export function extractHttpStatus(error: string | undefined): number | null {
  if (!error) return null;
  const m = /status code (\d{3})/i.exec(error);
  return m ? Number(m[1]) : null;
}

// EAI_AGAIN is a *temporary* resolver failure (busy/unreachable DNS server), not a
// dead domain -- retiring a scraper on it would delete a live site because a CI
// runner's resolver hiccuped. Only ENOTFOUND/NXDOMAIN mean "no such name".
const DEAD_DNS_RE = /getaddrinfo\s+(ENOTFOUND|EAI_NONAME)|NXDOMAIN/i;
const TEMP_DNS_RE = /getaddrinfo\s+EAI_AGAIN/i;

// The SSRF guard fires when a hostname resolves into private space. For a venue
// domain that means the name was released and re-pointed (typically at 127.0.0.1
// by a parking provider) -- functionally dead, and we must never keep requesting it.
const SSRF_RE = /Blocked SSRF target/i;

const TLS_RE = /certificate has expired|does not match certificate's altnames|self[- ]signed certificate|SSL routines|EPROTO|unable to verify the first certificate|CERT_/i;

const TIMEOUT_RE = /timeout of \d+ms exceeded|ECONNABORTED|ETIMEDOUT|ECONNRESET|EPIPE|socket hang up|wall-clock timeout/i;

/**
 * Maps one fail-log entry to a repair strategy.
 *
 * Order matters: DNS/SSRF verdicts are checked before HTTP status, because a
 * dead domain can also surface a status-shaped message from an intermediary.
 */
export function classifyFailure(failure: FailureEntry): Classification {
  const reason = failure.reason ?? '';
  const error = failure.error ?? '';
  const hasSample = typeof failure.htmlSample === 'string' && failure.htmlSample.length > 0;

  if (reason === 'csr_detected') {
    return { strategy: 'needs_render', detail: 'events absent from server HTML; needs a rendering scraper' };
  }

  if (reason === 'selectors_stale' || reason === 'parse_error') {
    return hasSample
      ? { strategy: 'selectors', detail: `${reason} with a captured HTML sample` }
      : { strategy: 'unfixable', detail: `${reason} but no HTML sample was captured, nothing to re-select against` };
  }

  // A circuit opens after 3 consecutive failures against the same domain within one
  // run. That is a rate/ban signal, not a layout break -- back off and retry later.
  if (reason === 'circuit_open') {
    return { strategy: 'transient', detail: 'domain circuit breaker opened during the run' };
  }

  if (DEAD_DNS_RE.test(error)) {
    return { strategy: 'dead_domain', detail: 'hostname does not resolve (NXDOMAIN)' };
  }
  if (SSRF_RE.test(error)) {
    return { strategy: 'dead_domain', detail: 'hostname resolves into private/loopback space -- domain released or parked' };
  }
  if (TEMP_DNS_RE.test(error)) {
    return { strategy: 'transient', detail: 'temporary resolver failure (EAI_AGAIN)' };
  }
  if (TLS_RE.test(error)) {
    return { strategy: 'tls_broken', detail: 'TLS handshake/validation failed -- often an abandoned or re-parked domain' };
  }

  const status = extractHttpStatus(error);
  if (status === 404 || status === 410) {
    return { strategy: 'url_moved', detail: `host answered ${status}; the schedule page moved` };
  }
  if (status === 403 || status === 401) {
    return { strategy: 'anti_bot', detail: `host answered ${status}; request was rejected as automated` };
  }
  if (status === 429 || (status !== null && status >= 500)) {
    return { strategy: 'transient', detail: `host answered ${status}` };
  }

  if (TIMEOUT_RE.test(error)) {
    return { strategy: 'transient', detail: 'request timed out or the connection dropped' };
  }

  if (reason === 'fetch_error') {
    // Unrecognized network-layer error. Treat as transient rather than dead: an
    // escalated retry is cheap, and retiring on an unknown error risks deleting a
    // live scraper over a one-off runner/network fault.
    return { strategy: 'transient', detail: `unclassified fetch error: ${error.slice(0, 120)}` };
  }

  return { strategy: 'unfixable', detail: `no strategy for reason="${reason}" error="${error.slice(0, 120)}"` };
}
