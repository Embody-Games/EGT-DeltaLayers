#!/usr/bin/env node
/*
 * Renders one version's changelog.json entry as markdown, so the GitHub release body
 * and the plugin's own Changelog tab in Blockbench come from the same source.
 *
 *   node scripts/release_notes.mjs 1.4.0
 *   node scripts/release_notes.mjs 1.4.0 --title-only
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const titleOnly = args.includes('--title-only');
const version = args.find((a) => !a.startsWith('-'));

if (!version) {
	console.error('usage: release_notes.mjs <version> [--title-only]');
	process.exit(2);
}

const changelog = JSON.parse(readFileSync(join(root, 'changelog.json'), 'utf8'));
const entry = changelog[version];
if (!entry) {
	console.error(`changelog.json has no entry for ${version}`);
	process.exit(1);
}

// Older entries used the version string as the title; that is not worth repeating.
const title = entry.title && entry.title !== version ? entry.title : '';

if (titleOnly) {
	console.log(title);
	process.exit(0);
}

const out = [];
if (title) out.push(`## ${title}`, '');
for (const category of entry.categories || []) {
	out.push(`### ${category.title}`, '');
	for (const item of category.list || []) out.push(`- ${item}`);
	out.push('');
}
out.push(
	'---',
	'',
	'Download both files below into the same folder, then in Blockbench: File > Plugins >',
	'Load Plugin From File. Do not rename the .js, Blockbench takes the plugin id from the',
	'filename. Keep changelog.json beside it so the Changelog tab resolves.'
);
console.log(out.join('\n'));
