#!/usr/bin/env node
/*
 * Embeds delta_layers_icon.png into the plugin as a data: URL.
 *
 *   npm run icon
 *
 * Blockbench accepts either an icon filename sitting beside the .js, or a data URL
 * (js/api.ts, getIconNode: `icon.startsWith('data:image/')` becomes an <img class="icon">).
 * Both render at 48px wide in the plugin browser, since css/dialogs.css sets
 * `.plugin_icon_area .icon { width: 48px }`, so the data URL costs nothing visually and
 * keeps the plugin one self-contained file to hand out.
 *
 * Run this after changing the PNG. Do not hand-edit the PLUGIN_ICON line.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ICON = 'delta_layers_icon.png';
const PLUGIN = 'embodygames_delta_layers.js';
const ICON_LINE = /^const PLUGIN_ICON = '[^']*';$/m;
const TAG_LINE = /^const TAG = '[^']*';.*$/m;
const PNG_MAGIC = '89504e470d0a1a0a';

const die = (message) => {
	console.error(`embed_icon: ${message}`);
	process.exit(1);
};

const png = readFileSync(join(root, ICON));
if (png.subarray(0, 8).toString('hex') !== PNG_MAGIC) die(`${ICON} is not a PNG`);

const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);
if (width !== height) console.warn(`embed_icon: ${ICON} is ${width}x${height}, not square`);
if (width < 48) console.warn(`embed_icon: ${ICON} is ${width}px, the plugin browser draws it at 48px`);

const url = `data:image/png;base64,${png.toString('base64')}`;
const line = `const PLUGIN_ICON = '${url}';`;

const pluginPath = join(root, PLUGIN);
const source = readFileSync(pluginPath, 'utf8');
let out;

if (ICON_LINE.test(source)) {
	out = source.replace(ICON_LINE, line);
} else {
	const tag = source.match(TAG_LINE);
	if (!tag) die(`could not find the TAG line in ${PLUGIN} to insert after`);
	out = source.replace(
		TAG_LINE,
		`${tag[0]}\n// 48x48 PNG from ${ICON}, inlined by scripts/embed_icon.mjs so the plugin stays\n// one file. Regenerate with "npm run icon" after changing the PNG, do not edit by hand.\n${line}`
	);
}

if (out === source) {
	console.log(`embed_icon: already current (${png.length} bytes of PNG, ${url.length} of data URL)`);
} else {
	writeFileSync(pluginPath, out);
	console.log(`embed_icon: embedded ${ICON} (${width}x${height}, ${png.length} bytes -> ${url.length} char data URL)`);
}
