import type { Concert } from '../schemas/concert.js';

export type ProcessingDropReason = 'incomplete' | 'notApproved' | 'badDate' | 'pastDate' | 'zodFail';

export interface ProcessingDiagnosticsDrops {
  incomplete: number;
  notApproved: number;
  badDate: number;
  pastDate: number;
  zodFail: number;
}

export interface ProcessingDiagnosticsSourceBreakdown {
  /** `sources` keys are normalized domains, never full source URLs. */
  rawCount: number;
  publishedCount: number;
  duplicatesMerged: number;
  dropped: ProcessingDiagnosticsDrops;
}

/** Deliberately excludes URLs, HTML, tokens, social links, and arbitrary raw payloads. */
export interface ProcessingDiagnosticsSample {
  reason: ProcessingDropReason;
  artist?: string;
  date?: string;
  venue?: string;
  city?: string;
  country?: string;
  originalSource?: string;
}

export interface ProcessingDiagnostics {
  schemaVersion: 1;
  generatedAt: string;
  baseDate: string;
  rawCount: number;
  publishedCount: number;
  duplicatesMerged: number;
  dropped: ProcessingDiagnosticsDrops;
  sources: Record<string, ProcessingDiagnosticsSourceBreakdown>;
  validationIssues: Record<string, number>;
  missingFields: Record<string, number>;
  samples: ProcessingDiagnosticsSample[];
}

/** Safe to publish in status: the full diagnostics report alone carries samples. */
export interface ProcessingDiagnosticsSummary {
  schemaVersion: 1;
  generatedAt: string;
  baseDate: string;
  rawCount: number;
  publishedCount: number;
  duplicatesMerged: number;
  dropped: ProcessingDiagnosticsDrops;
  sources: Record<string, ProcessingDiagnosticsSourceBreakdown>;
  validationIssues: Record<string, number>;
  missingFields: Record<string, number>;
}

const SAMPLE_LIMIT_PER_REASON = 3;
const SAMPLE_LIMIT_TOTAL = 15;
const SAMPLE_TEXT_LIMIT = 160;
const SOURCE_LIMIT = 120;

function emptyDrops(): ProcessingDiagnosticsDrops {
  return { incomplete: 0, notApproved: 0, badDate: 0, pastDate: 0, zodFail: 0 };
}

function safeMap<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function increment(map: Record<string, number>, key: string): void {
  map[key] = (map[key] ?? 0) + 1;
}

function safeText(value: unknown, limit = SAMPLE_TEXT_LIMIT): string | undefined {
  if (typeof value !== 'string') return undefined;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, limit) : undefined;
}

function sourceFor(raw: Partial<Concert>): string {
  const rawSource = safeText(raw.originalSource, SOURCE_LIMIT);
  if (!rawSource) return '(missing source)';

  // `originalSource` is normally a domain, but malformed adapters can hand us
  // a complete URL. Reports are retained and status is public, so retain only
  // the hostname: paths, query parameters, credentials, and fragments are not
  // useful for source-level diagnostics and may carry secrets.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(rawSource) || rawSource.startsWith('//')) {
    try {
      const parsed = new URL(rawSource.startsWith('//') ? `https:${rawSource}` : rawSource);
      return parsed.hostname ? parsed.hostname.toLowerCase() : '(invalid source)';
    } catch {
      return '(invalid source)';
    }
  }

  // A source is expected to be a domain. Strip accidental path/query/credential
  // suffixes even when the adapter omitted the URL scheme.
  const host = rawSource.split(/[/?#]/, 1)[0].split('@').at(-1)?.trim();
  return host ? host.slice(0, SOURCE_LIMIT).toLowerCase() : '(invalid source)';
}

function sampleFor(reason: ProcessingDropReason, raw: Partial<Concert>): ProcessingDiagnosticsSample {
  const sample: ProcessingDiagnosticsSample = { reason };
  for (const field of ['artist', 'date', 'venue', 'city', 'country', 'originalSource'] as const) {
    const value = field === 'originalSource'
      ? sourceFor(raw)
      : safeText(raw[field], SAMPLE_TEXT_LIMIT);
    if (value) sample[field] = value;
  }
  return sample;
}

export function processingDiagnosticsSummary(report: ProcessingDiagnostics): ProcessingDiagnosticsSummary {
  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    baseDate: report.baseDate,
    rawCount: report.rawCount,
    publishedCount: report.publishedCount,
    duplicatesMerged: report.duplicatesMerged,
    dropped: report.dropped,
    sources: report.sources,
    validationIssues: report.validationIssues,
    missingFields: report.missingFields
  };
}

/**
 * Bounded, public-safe accounting for processing outcomes. It intentionally keeps
 * only issue aggregates and a small set of plain event fields for diagnosis.
 */
export class ProcessingDiagnosticsCollector {
  private readonly sources = safeMap<ProcessingDiagnosticsSourceBreakdown>();
  private readonly validationIssues = safeMap<number>();
  private readonly missingFields = safeMap<number>();
  private readonly samples: ProcessingDiagnosticsSample[] = [];
  private readonly sampleCounts = safeMap<number>();
  private readonly dropped = emptyDrops();
  private duplicatesMerged = 0;

  constructor(private readonly rawCount: number, private readonly baseDate: string) {}

  recordDrop(reason: ProcessingDropReason, raw: Partial<Concert>, missingFields: readonly string[] = []): void {
    this.dropped[reason]++;
    this.recordRaw(raw).dropped[reason]++;
    for (const field of missingFields) increment(this.missingFields, field);
    this.sample(reason, raw);
  }

  recordValidationIssues(issues: readonly { path: PropertyKey[]; code: string }[]): void {
    for (const issue of issues) {
      const path = issue.path.map(String).join('.') || '(root)';
      increment(this.validationIssues, `${path}:${issue.code}`);
    }
    // `recordDrop` owns all zod-failure totals and samples.
  }

  recordDuplicate(raw: Partial<Concert>): void {
    this.duplicatesMerged++;
    this.source(raw).duplicatesMerged++;
  }

  recordAccepted(raw: Partial<Concert>): void {
    this.recordRaw(raw);
  }

  build(published: Concert[]): ProcessingDiagnostics {
    for (const concert of published) this.source(concert).publishedCount++;
    return {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      baseDate: this.baseDate,
      rawCount: this.rawCount,
      publishedCount: published.length,
      duplicatesMerged: this.duplicatesMerged,
      dropped: { ...this.dropped },
      sources: this.sources,
      validationIssues: this.validationIssues,
      missingFields: this.missingFields,
      samples: this.samples
    };
  }

  private recordRaw(raw: Partial<Concert>): ProcessingDiagnosticsSourceBreakdown {
    const source = this.source(raw);
    source.rawCount++;
    return source;
  }

  private source(raw: Partial<Concert>): ProcessingDiagnosticsSourceBreakdown {
    const key = sourceFor(raw);
    let source = this.sources[key];
    if (!source) {
      source = { rawCount: 0, publishedCount: 0, duplicatesMerged: 0, dropped: emptyDrops() };
      this.sources[key] = source;
    }
    return source;
  }

  private sample(reason: ProcessingDropReason, raw: Partial<Concert>): void {
    if (this.samples.length >= SAMPLE_LIMIT_TOTAL || (this.sampleCounts[reason] ?? 0) >= SAMPLE_LIMIT_PER_REASON) return;
    this.samples.push(sampleFor(reason, raw));
    increment(this.sampleCounts, reason);
  }
}
