#!/usr/bin/env node
/**
 * Rebuild datasets.json index from ALL .json dataset files in data/
 * Run: node data/rebuild-index.js
 */
import { readdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const dataDir = 'data';
const skipFiles = new Set(['datasets.json', 'openintro_catalog.json']);
const files = readdirSync(dataDir).filter(f =>
  f.endsWith('.json') && !skipFiles.has(f)
);

const index = [];

for (const f of files) {
  try {
    const ds = JSON.parse(readFileSync(join(dataDir, f), 'utf-8'));
    if (ds.id && ds.rows) {
      index.push({
        id: ds.id,
        name: ds.name,
        description: ds.description,
        type: ds.type,
        chapter: ds.chapter || '',
        n: ds.rows.length,
        variables: (ds.variables || []).map(v => v.name),
        hasNumeric: (ds.variables || []).some(v => v.type === 'numeric'),
        hasCategorical: (ds.variables || []).some(v => v.type === 'categorical'),
      });
    }
  } catch (e) {
    console.error(`  skip ${f}: ${e.message}`);
  }
}

index.sort((a, b) => a.id.localeCompare(b.id));
writeFileSync(join(dataDir, 'datasets.json'), JSON.stringify(index, null, 2) + '\n');
console.log(`datasets.json — ${index.length} datasets indexed`);

// Verify new datasets
const newIds = [
  'avandia', 'cuckoo', 'gss2010', 'chickwts', 'cats', 'exam_grades',
  'trees', 'antibiotics', 'diamond', 'county_2019', 'urban_owner',
  'oscars', 'mammals'
];
for (const id of newIds) {
  const ds = index.find(d => d.id === id);
  if (ds) console.log(`  ✓ ${id} — ${ds.n} rows`);
  else console.log(`  ✗ ${id} — NOT FOUND`);
}
