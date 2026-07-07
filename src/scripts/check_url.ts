import { chromium } from 'playwright';

(async () => {
  const url = process.argv[2];
  if (!url) {
    console.error('usage: check_url <url>');
    process.exit(1);
  }
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on('response', response => {
    const u = response.url();
    console.log(`[Response] ${response.status()} ${u}`);
  });

  await page.goto(url, { waitUntil: 'networkidle' });
  const html = await page.content();
  console.log('--- Page Title ---');
  console.log(await page.title());
  console.log('--- HTML Length ---');
  console.log(html.length);
  console.log('--- Sample HTML (first 2000 chars) ---');
  console.log(html.slice(0, 2000));
  console.log('--- Sample HTML (some body tags) ---');
  // Log children of the .block div
  const structure = await page.locator('.block > *').evaluateAll((els: any[]) => {
    if (els.length === 0) return 'No .block found';
    return els.map((el: any) => ({
      tag: el.tagName,
      id: el.id,
      class: el.className,
      text: el.textContent?.trim().slice(0, 100)
    }));
  });
  console.log(JSON.stringify(structure, null, 2));
  await browser.close();
})().catch(e => {
  console.error(e);
  process.exit(1);
});
