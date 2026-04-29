#!/usr/bin/env node
// Compile research markdown files into HTML report + CSV
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename } from 'path';
import { execSync } from 'child_process';

const outputDir = process.argv[2];
if (!outputDir || !existsSync(outputDir)) {
  console.error('Usage: compile_report.mjs <output_dir>');
  console.error(`  Reads .md files from <output_dir>, generates index.html + results.csv`);
  process.exit(1);
}

const companiesDir = join(outputDir, 'companies');
mkdirSync(companiesDir, { recursive: true });

// Parse all markdown files
const files = readdirSync(outputDir).filter(f => f.endsWith('.md'));
const companies = [];

for (const file of files) {
  const content = readFileSync(join(outputDir, file), 'utf-8');
  const parsed = parseMarkdown(content, file);
  if (parsed) companies.push(parsed);
}

// Deduplicate by normalized company name (keep highest score)
const deduped = [];
const seen = new Map();
for (const c of companies.sort((a, b) => (b.icp_fit_score || 0) - (a.icp_fit_score || 0))) {
  const key = (c.company_name || '').toLowerCase().trim();
  if (key && !seen.has(key)) {
    seen.set(key, true);
    deduped.push(c);
  }
}
// If no company_name, still include
for (const c of companies) {
  const key = (c.company_name || '').toLowerCase().trim();
  if (!key && !seen.has(c.filename)) {
    seen.set(c.filename, true);
    deduped.push(c);
  }
}

deduped.sort((a, b) => (b.icp_fit_score || 0) - (a.icp_fit_score || 0));

// Generate individual company HTML pages
for (const c of deduped) {
  const html = renderCompanyPage(c);
  writeFileSync(join(companiesDir, `${c.slug}.html`), html);
}

// Generate index.html
const indexHtml = renderIndex(deduped);
writeFileSync(join(outputDir, 'index.html'), indexHtml);

// Generate CSV
const csv = renderCsv(deduped);
writeFileSync(join(outputDir, 'results.csv'), csv);

// Summary
console.log(`Report generated: ${deduped.length} companies`);
console.log(JSON.stringify({
  total: deduped.length,
  strong: deduped.filter(c => c.icp_fit_score >= 8).length,
  partial: deduped.filter(c => c.icp_fit_score >= 5 && c.icp_fit_score <= 7).length,
  weak: deduped.filter(c => c.icp_fit_score <= 4).length,
}, null, 2));

// Try to open in browser
try {
  execSync(`open "${join(outputDir, 'index.html')}" 2>/dev/null || xdg-open "${join(outputDir, 'index.html')}" 2>/dev/null || true`, { stdio: 'ignore' });
} catch {}

// --- Helpers ---

function parseMarkdown(content, filename) {
  const slug = filename.replace(/\.md$/, '');

  // Extract YAML frontmatter
  const yamlMatch = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!yamlMatch) return null;

  const yaml = parseYaml(yamlMatch[1]);
  const body = content.slice(yamlMatch[0].length);

  return {
    slug,
    filename,
    company_name: yaml.company_name || slug.replace(/-/g, ' '),
    website: yaml.website || '',
    product_description: yaml.product_description || '',
    industry: yaml.industry || '',
    target_audience: yaml.target_audience || '',
    key_features: yaml.key_features || '',
    icp_fit_score: parseInt(yaml.icp_fit_score) || 0,
    icp_fit_reasoning: yaml.icp_fit_reasoning || '',
    employee_estimate: yaml.employee_estimate || '',
    funding_info: yaml.funding_info || '',
    headquarters: yaml.headquarters || '',
    body: body.trim(),
  };
}

function parseYaml(text) {
  const result = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^(\w+):\s*(.*)/);
    if (m) result[m[1]] = m[2].trim();
  }
  return result;
}

function scoreColor(score) {
  if (score >= 8) return '#16a34a';
  if (score >= 5) return '#ca8a04';
  return '#dc2626';
}

function renderIndex(companies) {
  const rows = companies.map(c => `
    <tr>
      <td><a href="companies/${c.slug}.html">${esc(c.company_name)}</a></td>
      <td><span class="score" style="background:${scoreColor(c.icp_fit_score)}">${c.icp_fit_score}</span></td>
      <td>${esc(c.industry)}</td>
      <td>${esc(c.product_description)}</td>
      <td>${esc(c.target_audience)}</td>
      <td>${esc(c.headquarters)}</td>
      <td>${esc(c.employee_estimate)}</td>
      <td>${esc(c.funding_info)}</td>
    </tr>
  `).join('\n');

  const strong = companies.filter(c => c.icp_fit_score >= 8).length;
  const partial = companies.filter(c => c.icp_fit_score >= 5 && c.icp_fit_score <= 7).length;
  const weak = companies.filter(c => c.icp_fit_score <= 4).length;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Company Research Report</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 2rem; }
  h1 { font-size: 1.5rem; font-weight: 700; margin-bottom: 0.5rem; }
  .meta { color: #64748b; margin-bottom: 2rem; }
  .summary { display: flex; gap: 1rem; margin-bottom: 2rem; }
  .summary-card { flex: 1; background: white; border-radius: 8px; padding: 1rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  .summary-card .num { font-size: 1.5rem; font-weight: 700; }
  .summary-card .label { font-size: 0.875rem; color: #64748b; }
  table { width: 100%; border-collapse: collapse; background: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
  th, td { text-align: left; padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; font-size: 0.875rem; }
  th { background: #f1f5f9; font-weight: 600; color: #475569; }
  .score { display: inline-block; color: white; font-weight: 700; padding: 0.25rem 0.5rem; border-radius: 4px; font-size: 0.875rem; min-width: 2rem; text-align: center; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<h1>Company Research Report</h1>
<p class="meta">${companies.length} companies researched</p>

<div class="summary">
  <div class="summary-card"><div class="num" style="color:#16a34a">${strong}</div><div class="label">Strong Fit (8-10)</div></div>
  <div class="summary-card"><div class="num" style="color:#ca8a04">${partial}</div><div class="label">Partial Fit (5-7)</div></div>
  <div class="summary-card"><div class="num" style="color:#dc2626">${weak}</div><div class="label">Weak Fit (1-4)</div></div>
</div>

<table>
<thead><tr>
  <th>Company</th><th>Score</th><th>Industry</th><th>Product</th><th>Target Audience</th><th>HQ</th><th>Employees</th><th>Funding</th>
</tr></thead>
<tbody>${rows}</tbody>
</table>
</body>
</html>`;
}

function renderCompanyPage(c) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(c.company_name)} — Research</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; color: #1e293b; padding: 2rem; max-width: 800px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  .website { color: #2563eb; margin-bottom: 1.5rem; display: block; }
  .field { margin-bottom: 1rem; }
  .field-label { font-size: 0.75rem; font-weight: 600; text-transform: uppercase; color: #64748b; margin-bottom: 0.25rem; }
  .field-value { font-size: 0.9375rem; }
  .score-badge { display: inline-block; background: ${scoreColor(c.icp_fit_score)}; color: white; font-weight: 700; padding: 0.25rem 0.75rem; border-radius: 4px; font-size: 1.25rem; }
  .body { margin-top: 2rem; }
  .body h2 { font-size: 1.125rem; margin: 1.5rem 0 0.5rem; }
  .body ul { padding-left: 1.5rem; }
  .body li { margin-bottom: 0.5rem; font-size: 0.9375rem; }
  .back { display: inline-block; margin-bottom: 1.5rem; color: #64748b; text-decoration: none; font-size: 0.875rem; }
  .back:hover { color: #1e293b; }
</style>
</head>
<body>
<a class="back" href="../index.html">&larr; Back to report</a>
<h1>${esc(c.company_name)}</h1>
<a class="website" href="${esc(c.website)}" target="_blank">${esc(c.website)}</a>

<div class="field"><span class="score-badge">${c.icp_fit_score}</span></div>
<div class="field"><div class="field-label">ICP Fit Reasoning</div><div class="field-value">${esc(c.icp_fit_reasoning)}</div></div>
<div class="field"><div class="field-label">Industry</div><div class="field-value">${esc(c.industry)}</div></div>
${c.target_audience ? `<div class="field"><div class="field-label">Target Audience</div><div class="field-value">${esc(c.target_audience)}</div></div>` : ''}
${c.headquarters ? `<div class="field"><div class="field-label">Headquarters</div><div class="field-value">${esc(c.headquarters)}</div></div>` : ''}
${c.employee_estimate ? `<div class="field"><div class="field-label">Employees</div><div class="field-value">${esc(c.employee_estimate)}</div></div>` : ''}
${c.funding_info ? `<div class="field"><div class="field-label">Funding</div><div class="field-value">${esc(c.funding_info)}</div></div>` : ''}
${c.key_features ? `<div class="field"><div class="field-label">Key Features</div><div class="field-value">${esc(c.key_features.replace(/\|/g, ' · '))}</div></div>` : ''}

<div class="body">${renderBody(c.body)}</div>
</body>
</html>`;
}

function renderBody(md) {
  // Minimal markdown to HTML conversion for our known format
  let html = md
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^- \*\*\[(\w+)\]\*\* (.+?) \(source: (.+?)\)$/gm, '<li><strong>[$1]</strong> $2 <em>(source: $3)</em></li>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(?!<[hl])/gm, '');
  return `<p>${html}</p>`;
}

function renderCsv(companies) {
  const header = 'Company,Website,Product,Industry,Target Audience,Key Features,ICP Score,ICP Reasoning,Employees,Funding,Headquarters';
  const rows = companies.map(c => {
    return [
      csvEsc(c.company_name),
      csvEsc(c.website),
      csvEsc(c.product_description),
      csvEsc(c.industry),
      csvEsc(c.target_audience),
      csvEsc(c.key_features),
      c.icp_fit_score,
      csvEsc(c.icp_fit_reasoning),
      csvEsc(c.employee_estimate),
      csvEsc(c.funding_info),
      csvEsc(c.headquarters),
    ].join(',');
  });
  return header + '\n' + rows.join('\n');
}

function esc(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function csvEsc(s) {
  const v = (s || '').replace(/"/g, '""');
  return v.includes(',') || v.includes('"') || v.includes('\n') ? `"${v}"` : v;
}
