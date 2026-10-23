// npm run batch -- [--applications f] [--documents f] [--extraction f] [--reference dir] [--config f] [--out dir]
// Defaults run the bundled sample set. Writes <out>/decisions_output.csv and compares with expected_decisions.csv when found.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareWithExpected, compareWithInline, hasExpectedColumns, runBatch, writeDecisionsCsv } from '../src/services/kyc/batch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith('--') ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const sample = path.join(root, 'data', 'sample');
const opts = {
  applicationsFile: path.resolve(args.applications || path.join(sample, 'applications.csv')),
  documentsFile: path.resolve(args.documents || path.join(sample, 'documents.csv')),
  extractionFile: path.resolve(args.extraction || path.join(sample, 'extraction_mock.csv')),
  referenceDir: path.resolve(args.reference || path.join(root, 'data', 'reference')),
  configFile: args.config ? path.resolve(args.config) : undefined,
};
const outDir = path.resolve(args.out || path.join(root, 'output'));

try {
  const { rows, skipped, ms, applications, config } = runBatch(opts);
  const outFile = path.join(outDir, 'decisions_output.csv');
  writeDecisionsCsv(outFile, rows);
  console.log(`Evaluated ${rows.length} applications in ${ms.toFixed(0)} ms -> ${outFile}`);
  for (const s of skipped) console.warn(`  skipped row ${s.row}${s.application_id ? ` (${s.application_id})` : ''}: ${s.reason}`);

  if (config.file) {
    const mapped = Object.keys(config.mapped).length;
    console.log(`Rule configuration: ${path.basename(config.file)} (${mapped} setting(s) read)`);
    if (config.ignored.length) console.warn(`  not understood and left at the defaults: ${config.ignored.join(', ')}`);
  } else console.warn('Rule configuration: no config file found, using the built-in defaults');

  const expectedFile = args.expected ? path.resolve(args.expected) : path.join(path.dirname(opts.applicationsFile), 'expected_decisions.csv');
  let cmp = null;
  let label = '';
  if (hasExpectedColumns(applications)) {
    cmp = compareWithInline(rows, applications);
    label = 'the expected_* columns of the applications file';
  } else if (fs.existsSync(expectedFile)) {
    cmp = compareWithExpected(rows, expectedFile);
    label = path.basename(expectedFile);
  }
  if (cmp) {
    if (cmp.problems.length) {
      console.error(`\nMISMATCH: ${cmp.problems.length} difference(s) against ${label} (${cmp.total} expected rows)`);
      for (const p of cmp.problems.slice(0, 40)) console.error(`  ${p.application_id} ${p.column}: expected "${p.expected}", got "${p.got}"`);
      process.exit(2);
    }
    console.log(`Matches ${label}: ${cmp.total}/${cmp.total} applications identical on all 5 output columns.`);
  }
} catch (err) {
  console.error('Batch failed:', err.message);
  process.exit(1);
}
