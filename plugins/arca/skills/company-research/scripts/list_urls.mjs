#!/usr/bin/env node
// URL deduplication — reads discovery batch JSON files, deduplicates by URL
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const dir = process.argv[2] || '/tmp';
const outFile = join(dir, 'company_urls_deduped.json');

if (!existsSync(dir)) {
  console.error(`Directory not found: ${dir}`);
  process.exit(1);
}

const files = readdirSync(dir).filter(f =>
  f.startsWith('company_discovery_batch_') && f.endsWith('.json')
);

if (files.length === 0) {
  console.error('No discovery batch files found');
  writeFileSync(outFile, JSON.stringify([], null, 2));
  process.exit(0);
}

const seen = new Map(); // url -> { title, urls: [sources] }

for (const file of files) {
  const raw = readFileSync(join(dir, file), 'utf-8');
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error(`Skipping unparseable: ${file}`);
    continue;
  }

  // Handle both { results: [...] } and flat array formats
  const results = Array.isArray(data) ? data : (data.results || []);

  for (const r of results) {
    let url = (r.url || '').replace(/\/$/, '').toLowerCase();
    if (!url) continue;

    // Normalize: strip www., protocol
    url = url.replace(/^https?:\/\//, '').replace(/^www\./, '');

    if (seen.has(url)) {
      seen.get(url).sources.push(file);
    } else {
      seen.set(url, {
        url: r.url,
        title: r.title || '',
        description: r.description || '',
        sources: [file],
      });
    }
  }
}

const output = Array.from(seen.values());
writeFileSync(outFile, JSON.stringify(output, null, 2));
console.log(`Deduped ${seen.size} unique URLs from ${files.length} batch files`);
