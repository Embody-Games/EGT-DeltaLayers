/* How many files does one Ctrl+S actually touch? Count them. */
const { loadPlugin, resetProject, settle, Texture, Codec, fs, PathModule } = require('./mock_blockbench');
const { createCanvas } = require('canvas');

const ROOT = PathModule.join(require('os').tmpdir(), 'lb_count');
const DIR = PathModule.join(ROOT, 'Models', 'Knight');
const MODEL = PathModule.join(DIR, 'Knight.blockymodel');
const TEX = PathModule.join(DIR, 'Texture.png');

fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(MODEL, '{}', 'utf-8');
const c = createCanvas(64, 64);
c.getContext('2d').fillRect(0, 0, 64, 64);
fs.writeFileSync(TEX, c.toDataURL('image/png').split(',')[1], { encoding: 'base64' });

const codec = new Codec('blockymodel', {
	compile: () => '{}',
	write(content, path) { fs.writeFileSync(path, content, 'utf-8'); },
	parse() { return {}; },
});
globalThis.Format.codec = codec;

// Count every file write the plugin makes, and how many times the sync pass runs.
let writes = [];
const real_write = fs.writeFileSync;
fs.writeFileSync = function (path, ...rest) {
	writes.push(String(path));
	return real_write.call(fs, path, ...rest);
};

const plugin = loadPlugin(PathModule.resolve(__dirname, '..', 'delta_layers.js')).delta_layers;
plugin.onload();

function quickSave() {
	for (const t of Texture.all) if (!t.saved) t.save();
	codec.write(codec.compile(), MODEL);
	globalThis.Blockbench.dispatchEvent('quick_save_model', {});
}

function report(label) {
	const layer_pngs = writes.filter((p) => p.includes('.layers' + PathModule.sep) && p.endsWith('.png'));
	const jsons = writes.filter((p) => p.endsWith('.layers.json'));
	const flat = writes.filter((p) => p === TEX);
	console.log('\n' + label);
	console.log('  flat Texture.png rewritten : ' + flat.length);
	console.log('  layer PNGs written         : ' + layer_pngs.length);
	console.log('  sidecar JSON written       : ' + jsons.length);
	console.log('  total plugin file writes   : ' + (layer_pngs.length + jsons.length));
	writes = [];
}

(async function () {
	resetProject();
	const texture = new Texture().fromPath(TEX);
	texture.add();
	await settle(20);
	texture.layers_enabled = true;
	for (const name of ['Base', 'Grime', 'Detail']) {
		const layer = new globalThis.TextureLayer({ name }, texture);
		layer.setSize(64, 64);
		texture.layers.push(layer);
	}
	texture.updateLayerChanges(true);
	texture.saved = false;

	quickSave();
	await settle();
	report('Ctrl+S #1 (3 layers, texture dirty)');

	// Nothing changed at all. Save again.
	quickSave();
	await settle();
	report('Ctrl+S #2 (nothing changed since #1)');

	// Now with three collections/attachments, so the Hytale plugin writes 3 extra files
	// during the same Ctrl+S. Does that multiply the sidecar work?
	globalThis.Blockbench.on('quick_save_model', () => {
		for (let i = 0; i < 3; i++) {
			codec.write(codec.compile(), PathModule.join(DIR, 'Hat' + i + '.blockymodel'));
		}
	});
	quickSave();
	await settle();
	report('Ctrl+S #3 (same save also writes 3 collection files)');

	// fs.watch keeps the event loop alive, so end explicitly
	process.exit(0);
})();
