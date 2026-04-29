#!/usr/bin/env node
// Extract page content using Playwright (handles JS-rendered SPAs).
// Usage: node extract_page.mjs <url> [--max-chars N]
// Outputs structured: TITLE, META_DESCRIPTION, OG_*, HEADINGS, BODY

import { chromium } from 'playwright';

const url = process.argv[2];
if (!url) { console.error('Usage: extract_page.mjs <url> [--max-chars N]'); process.exit(1); }

const maxChars = parseInt(process.argv.find(a => a.startsWith('--max-chars='))?.split('=')[1]
  || process.argv[process.argv.indexOf('--max-chars') + 1]
  || '5000', 10);

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  let fetchOk = true;
  let fallback = false;

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    // Wait a beat for JS to execute
    await page.waitForTimeout(2000);
  } catch (err) {
    fetchOk = false;
    console.error(`Navigation failed: ${err.message}`);
  }

  const result = { url, fetch_ok: fetchOk };

  if (fetchOk) {
    try {
      result.title = await page.title().catch(() => '');

      const metaDesc = await page.$('meta[name="description"]');
      result.meta_description = metaDesc ? await metaDesc.getAttribute('content') || '' : '';

      const ogTitle = await page.$('meta[property="og:title"]');
      result.og_title = ogTitle ? await ogTitle.getAttribute('content') || '' : '';

      const ogDesc = await page.$('meta[property="og:description"]');
      result.og_description = ogDesc ? await ogDesc.getAttribute('content') || '' : '';

      // Extract headings
      const headings = await page.$$eval('h1, h2, h3', els => els.map(e => e.textContent?.trim()).filter(Boolean));
      result.headings = headings.join(' | ');

      // Extract body text
      const bodyText = await page.$eval('body', el => {
        // Clone body to avoid mutation while removing
        const clone = el.cloneNode(true);
        // Remove script, style, nav, footer, header, aside
        const remove = clone.querySelectorAll('script, style, nav, footer, header, aside, .sidebar, .menu, [role="navigation"]');
        remove.forEach(e => e.remove());
        return clone.textContent?.replace(/\s+/g, ' ').trim() || '';
      }).catch(() => '');

      result.body = bodyText.slice(0, maxChars);
      result.body_chars = bodyText.length;
    } catch (err) {
      console.error(`Extraction error: ${err.message}`);
      result.fetch_ok = false;
    }
  }

  await browser.close();

  // Structured output
  const out = [
    `URL: ${result.url}`,
    `FETCH_OK: ${result.fetch_ok}`,
    `TITLE: ${result.title || ''}`,
    `META_DESCRIPTION: ${result.meta_description || ''}`,
    `OG_TITLE: ${result.og_title || ''}`,
    `OG_DESCRIPTION: ${result.og_description || ''}`,
    `HEADINGS: ${result.headings || ''}`,
    `BODY_CHARS: ${result.body_chars || 0}`,
    `BODY:`,
    result.body || '',
  ].join('\n');

  console.log(out);
}

main().catch(err => {
  console.error(`Fatal: ${err.message}`);
  console.log(`URL: ${url}\nFETCH_OK: false\nFATAL: ${err.message}`);
  process.exit(1);
});
