/*
 * build.mjs — assemble the single-file tool from src/ parts.
 *
 *   node build.mjs            writes ./index.html (standalone, offline)
 *   node build.mjs <path>     also writes an Artifact body fragment to <path>
 *
 * Everything is inlined so the result is fully self-contained: no external
 * scripts, styles, or fonts — it runs from a file:// URL with no network.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, p), 'utf8');

const styles = read('src/styles.css');
const body = read('src/body.html');
const convert = read('src/convert.js');
const ui = read('src/ui.js');

const scripts = `<script>\n${convert}\n</script>\n<script>\n${ui}\n</script>`;

// Standalone document (committed as index.html).
const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Wealthsimple → Wealthfolio CSV Translator</title>
<meta name="description" content="Convert Wealthsimple transaction CSVs into Wealthfolio-ready import files, entirely in your browser.">
<style>
${styles}
</style>
</head>
<body>
${body}
${scripts}
</body>
</html>
`;
writeFileSync(join(here, 'index.html'), standalone);
console.log('wrote index.html');

// Artifact body fragment (no doctype/html/head/body — the host wraps it).
const artifactPath = process.argv[2];
if (artifactPath) {
  const fragment = `<style>\n${styles}\n</style>\n${body}\n${scripts}\n`;
  writeFileSync(artifactPath, fragment);
  console.log('wrote ' + artifactPath);
}
