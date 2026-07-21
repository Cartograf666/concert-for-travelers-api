import test from 'node:test';
import assert from 'node:assert';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import {
  buildProbeUrl,
  isSameOrSubdomain,
  isHomepageOrSamePath,
  hasMeaningfulPathKeyword,
  analyzeContent,
  probeArtist,
  isTourUrlProbeCandidate,
  ArtistEntry,
  ProbeResult
} from '../src/scripts/discover_tour_urls.js';
import { loadApprovedArtists, saveApprovedArtists } from '../src/pipeline/artistDb.js';

// Clean test helpers
const originalFetch = global.fetch;

test('discover_tour_urls - buildProbeUrl', () => {
  // Simple domain
  assert.strictEqual(buildProbeUrl('artist.com', '/tour'), 'https://artist.com/tour');
  assert.strictEqual(buildProbeUrl('https://artist.com/', 'tours'), 'https://artist.com/tours');
  
  // Subdirectories (should keep subdirectory in path)
  assert.strictEqual(buildProbeUrl('https://foo.com/sub/page', '/shows'), 'https://foo.com/sub/page/shows');
  assert.strictEqual(buildProbeUrl('https://foo.com/sub/page/', 'shows'), 'https://foo.com/sub/page/shows');
});

test('discover_tour_urls - isSameOrSubdomain', () => {
  assert.ok(isSameOrSubdomain('https://artist.com', 'https://artist.com/tour'));
  assert.ok(isSameOrSubdomain('https://artist.com', 'https://www.artist.com/tour'));
  assert.ok(isSameOrSubdomain('https://artist.com', 'https://shows.artist.com/tour'));
  assert.ok(isSameOrSubdomain('https://www.artist.co.uk', 'https://shows.artist.co.uk/tour'));
  
  // Rejects different domains
  assert.ok(!isSameOrSubdomain('https://artist.com', 'https://ticketmaster.com/artist'));
  assert.ok(!isSameOrSubdomain('https://artist.com', 'https://bandsintown.com/artist'));
});

test('discover_tour_urls - isHomepageOrSamePath', () => {
  assert.ok(isHomepageOrSamePath('https://artist.com', 'https://artist.com/'));
  assert.ok(isHomepageOrSamePath('https://artist.com', 'https://artist.com/index.html'));
  assert.ok(isHomepageOrSamePath('https://artist.com/about', 'https://artist.com/about'));
  
  // Not same path or homepage
  assert.ok(!isHomepageOrSamePath('https://artist.com', 'https://artist.com/tour'));
  assert.ok(!isHomepageOrSamePath('https://artist.com/about', 'https://artist.com/tour'));
});

test('discover_tour_urls - hasMeaningfulPathKeyword', () => {
  assert.ok(hasMeaningfulPathKeyword('https://artist.com/tour-dates'));
  assert.ok(hasMeaningfulPathKeyword('https://artist.com/shows'));
  assert.ok(hasMeaningfulPathKeyword('https://artist.com/live'));
  
  // No keyword
  assert.ok(!hasMeaningfulPathKeyword('https://artist.com/about-us'));
  assert.ok(!hasMeaningfulPathKeyword('https://artist.com/contact.php'));
});

test('discover_tour_urls - analyzeContent scoring', () => {
  // High score page
  const goodHtml = `
    <html>
      <body>
        <h1>Tour Dates 2026</h1>
        <p>Catch us live on tour in October 2026!</p>
        <div class="event">
          <span>12. Oct 2026</span> - London Wembley Arena - <a href="/buy">Tickets</a>
        </div>
        <div class="event">
          <span>15. Oct 2026</span> - Berlin Max-Schmeling-Halle - <a href="/buy">Tickets</a>
        </div>
      </body>
    </html>
  `;
  const goodRes = analyzeContent(goodHtml);
  assert.ok(goodRes.ok);
  assert.ok(goodRes.score >= 8);
  
  // Widget embedded page
  const widgetHtml = `
    <html>
      <body>
        <script src="https://widget.bandsintown.com/main.min.js"></script>
        <a class="bit-widget-initializer" data-artist-name="The Cure">Tour Dates</a>
      </body>
    </html>
  `;
  const widgetRes = analyzeContent(widgetHtml);
  assert.ok(widgetRes.ok);
  assert.ok(widgetRes.score >= 8);

  // Soft-404 / low score homepage
  const badHtml = `
    <html>
      <body>
        <h1>Welcome to our official website</h1>
        <p>Copyright 2026 Band Name. All rights reserved.</p>
        <p>This is just a simple bio page about our band. Feel free to browse around.</p>
      </body>
    </html>
  `;
  const badRes = analyzeContent(badHtml);
  assert.ok(!badRes.ok);
  assert.ok(badRes.score < 8);
});

test('discover_tour_urls - probeArtist integration with mock fetch', async () => {
  // Case 1: Happy path - find /tour
  global.fetch = async (url) => {
    const urlString = String(url);
    if (urlString.endsWith('/tour')) {
      return {
        status: 200,
        url: urlString,
        text: async () => `
          <h1>Tour 2026</h1>
          <p>Tickets on sale for our shows in October 2026!</p>
          <div>12. Oct 2026 - London - <a href="#">Tickets</a></div>
          <div>15. Oct 2026 - Berlin - <a href="#">Tickets</a></div>
        `
      } as any;
    }
    return { status: 404, url: urlString } as any;
  };

  const hit = await probeArtist({ name: 'Happy Band', website: 'https://happyband.com' });
  assert.strictEqual(hit.tourUrl, 'https://happyband.com/tour');
  assert.strictEqual(hit.pathPattern, '/tour');
  assert.ok(hit.reason.includes('score='));

  // Case 2: Soft-404 homepage redirect rejected
  global.fetch = async (url) => {
    const urlString = String(url);
    // Redirects to homepage
    return {
      status: 200,
      url: 'https://happyband.com/',
      text: async () => `Welcome to the homepage. Copyright 2026.`
    } as any;
  };

  const soft404 = await probeArtist({ name: 'Redirect Band', website: 'https://happyband.com' });
  assert.strictEqual(soft404.tourUrl, null);

  // Case 3: Cross-domain redirect rejected
  global.fetch = async (url) => {
    return {
      status: 200,
      url: 'https://ticketmaster.com/happy-band-tickets',
      text: async () => `Buy tickets now!`
    } as any;
  };

  const crossDomain = await probeArtist({ name: 'Ticketmaster Band', website: 'https://happyband.com' });
  assert.strictEqual(crossDomain.tourUrl, null);

  // Case 4: Platform domain apex redirect rejected
  global.fetch = async (url) => {
    const urlString = String(url);
    if (urlString.endsWith('/tour') || urlString.endsWith('/live')) {
      return {
        status: 200,
        url: 'https://bandcamp.com/live',
        text: async () => `Show list for Bandcamp live`
      } as any;
    }
    // Mock base preflight
    return { status: 200, url: urlString } as any;
  };

  const platformRedirect = await probeArtist({ name: 'Bandcamp Artist', website: 'https://artistname.bandcamp.com' });
  assert.strictEqual(platformRedirect.tourUrl, null);

  // Case 5: Resolved path block keyword rejected
  global.fetch = async (url) => {
    const urlString = String(url);
    if (urlString.endsWith('/tour') || urlString.endsWith('/shows')) {
      return {
        status: 200,
        url: 'https://happyband.com/album/live-dates',
        text: async () => `Tour Dates 2026. Oct 2026. Nov 2026. Dec 2026. Tickets`
      } as any;
    }
    // Mock base preflight
    return { status: 200, url: urlString } as any;
  };

  const pathBlock = await probeArtist({ name: 'Blocked Path Artist', website: 'https://happyband.com' });
  assert.strictEqual(pathBlock.tourUrl, null);

  // Restore fetch
  global.fetch = originalFetch;
});

test('discover_tour_urls - SSRF: a real 3xx redirect to a blocked host is refused, never fetched', async () => {
  const fetchedUrls: string[] = [];

  // Every hop is a REAL 3xx response with a Location header (unlike the other
  // integration tests above, which simulate fetch()'s automatic redirect-follow
  // by returning the already-resolved final URL in one 200 response) -- this is
  // what actually exercises fetchHelper's manual redirect-following + per-hop
  // isBlockedHost check.
  global.fetch = (async (url: string) => {
    fetchedUrls.push(url);
    return {
      status: 302,
      url,
      headers: { get: (h: string) => (h.toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data/' : null) },
      text: async () => ''
    } as any;
  }) as any;

  const result = await probeArtist({ name: 'Malicious Redirect Band', website: 'https://evil-tour-site.example' });

  assert.strictEqual(result.tourUrl, null, 'a redirect to a blocked host must never be accepted as a hit');
  assert.ok(
    !fetchedUrls.some((u) => u.includes('169.254.169.254')),
    `fetchHelper must refuse to follow the redirect at all -- it should never issue a request to the blocked target. Fetched: ${JSON.stringify(fetchedUrls)}`
  );

  global.fetch = originalFetch;
});

test('discover_tour_urls - a real 3xx redirect to a legitimate same-domain path is still followed', async () => {
  global.fetch = (async (url: string) => {
    if (url === 'https://happyband.com/tour') {
      return {
        status: 301,
        url,
        headers: { get: (h: string) => (h.toLowerCase() === 'location' ? '/tour/2026' : null) },
        text: async () => ''
      } as any;
    }
    if (url.endsWith('/tour/2026')) {
      return {
        status: 200,
        url,
        headers: { get: () => null },
        text: async () => `
          <h1>Tour 2026</h1>
          <div>12. Oct 2026 - London - Tickets</div>
          <div>15. Oct 2026 - Berlin - Tickets</div>
        `
      } as any;
    }
    return { status: 404, url, headers: { get: () => null } } as any;
  }) as any;

  const hit = await probeArtist({ name: 'Redirected Happy Band', website: 'https://happyband.com' });
  assert.strictEqual(hit.tourUrl, 'https://happyband.com/tour/2026');

  global.fetch = originalFetch;
});

test('discover_tour_urls - DB save & tried-vs-hit marker updates', async () => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'artist-db-test-'));
  const tempDbFile = path.join(tempDir, 'artists.json');

  const initialDb: ArtistEntry[] = [
    { name: 'Hit Artist', website: 'https://hitartist.com', tourUrl: null },
    { name: 'Miss Artist', website: 'https://missartist.com', tourUrl: null }
  ];

  await fs.writeFile(tempDbFile, JSON.stringify(initialDb, null, 2), 'utf-8');

  // Probe results mock
  const results: ProbeResult[] = [
    {
      name: 'Hit Artist',
      website: 'https://hitartist.com',
      tourUrl: 'https://hitartist.com/tour',
      pathPattern: '/tour',
      reason: 'score=12'
    },
    {
      name: 'Miss Artist',
      website: 'https://missartist.com',
      tourUrl: null,
      pathPattern: null,
      reason: 'No suffix matched'
    }
  ];

  // We test the logic of apply manually using the local DB file
  const artists = (await loadApprovedArtists(tempDbFile)) as ArtistEntry[];
  const byName = new Map<string, number>();
  artists.forEach((a, i) => byName.set(a.name.toLowerCase(), i));
  const now = new Date().toISOString();

  for (const r of results) {
    const idx = byName.get(r.name.toLowerCase());
    if (idx !== undefined) {
      const entry = artists[idx];
      entry.tourUrlProbeTriedAt = now;
      if (r.tourUrl) {
        entry.tourUrl = r.tourUrl;
      }
    }
  }

  await saveApprovedArtists(tempDbFile, artists);

  // Reload and check
  const updated = (await loadApprovedArtists(tempDbFile)) as ArtistEntry[];
  
  const hitArtist = updated.find(a => a.name === 'Hit Artist')!;
  assert.strictEqual(hitArtist.tourUrl, 'https://hitartist.com/tour');
  assert.strictEqual(hitArtist.tourUrlProbeTriedAt, now);

  const missArtist = updated.find(a => a.name === 'Miss Artist')!;
  assert.strictEqual(missArtist.tourUrl, null);
  assert.strictEqual(missArtist.tourUrlProbeTriedAt, now);

  // Clean up
  await fs.rm(tempDir, { recursive: true, force: true });
});

test('discover_tour_urls - candidate selection excludes longtail tier but keeps legacy untiered rows', () => {
  assert.strictEqual(isTourUrlProbeCandidate({ name: 'Pro', website: 'https://pro.example', tier: 'professional' }), true);
  assert.strictEqual(isTourUrlProbeCandidate({ name: 'Legacy', website: 'https://legacy.example' }), true);
  assert.strictEqual(isTourUrlProbeCandidate({ name: 'Longtail', website: 'https://long.example', tier: 'longtail' }), false);
  assert.strictEqual(isTourUrlProbeCandidate({ name: 'Tried', website: 'https://tried.example', tier: 'professional', tourUrlProbeTriedAt: '2026-07-09T00:00:00.000Z' }), false);
});
