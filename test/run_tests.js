/*
 * Round-trip and edge-case tests for texture_layer_bridge.js, run against the mock
 * Blockbench environment with real files on disk.
 */
const { loadPlugin, resetProject, settle, Texture, Codec, fs, PathModule } = require('./mock_blockbench');
const { createCanvas } = require('canvas');

const PLUGIN_PATH = PathModule.resolve(__dirname, '..', 'embodygames_texture_layer_bridge.js');
const ROOT = PathModule.join(require('os').tmpdir(), 'lb_test');
const MODEL_DIR = PathModule.join(ROOT, 'Models', 'Knight');
const MODEL_PATH = PathModule.join(MODEL_DIR, 'Knight.blockymodel');
const TEXTURE_PATH = PathModule.join(MODEL_DIR, 'Texture.png');
const SIDECAR_PATH = PathModule.join(MODEL_DIR, 'Texture.layers.json');
const LAYERS_DIR = PathModule.join(MODEL_DIR, 'Texture.layers');

let passes = 0;
let failures = 0;

function check(label, condition, detail) {
	if (condition) {
		passes++;
		console.log('  ok   ' + label);
	} else {
		failures++;
		console.log('  FAIL ' + label + (detail !== undefined ? ('  -> ' + JSON.stringify(detail)) : ''));
	}
}
function section(name) {
	console.log('\n' + name);
}

function writePng(path, width, height, paint) {
	const canvas = createCanvas(width, height);
	paint(canvas.getContext('2d'));
	fs.writeFileSync(path, canvas.toDataURL('image/png').split(',')[1], { encoding: 'base64' });
}

function solidLayerCanvas(width, height, color) {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, width, height);
	return canvas;
}

function pixelAt(layer, x, y) {
	const data = layer.ctx.getImageData(x, y, 1, 1).data;
	return [data[0], data[1], data[2], data[3]];
}

// --- fixture ---------------------------------------------------------------
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(MODEL_DIR, { recursive: true });
fs.writeFileSync(MODEL_PATH, JSON.stringify({ nodes: [], format: 'character', lod: 'auto' }), 'utf-8');
writePng(TEXTURE_PATH, 32, 32, (ctx) => { ctx.fillStyle = '#123456'; ctx.fillRect(0, 0, 32, 32); });

// A stand-in for the Hytale codec: same shape, same discovery behaviour.
const blockymodel_codec = new Codec('blockymodel', {
	name: 'Hytale Blockymodel',
	extension: 'blockymodel',
	compile: () => JSON.stringify({ nodes: [] }),
	write(content, path) {
		fs.writeFileSync(path, content, 'utf-8');
		return path;
	},
	parse(model, path) {
		const dir = PathModule.dirname(path);
		const new_textures = [];
		for (const file_name of fs.readdirSync(dir)) {
			if (!/\.png$/i.test(file_name)) continue;
			const texture_path = PathModule.join(dir, file_name);
			let texture = Texture.all.find((t) => t.path === texture_path);
			if (!texture) {
				texture = new Texture().fromPath(texture_path);
				texture.add();
				new_textures.push(texture);
			}
		}
		return { new_groups: [], new_textures };
	},
});
// Blockbench's own project codec: already round-trips layers, must be left alone.
const project_codec = new Codec('project', {
	name: 'Blockbench Project',
	write(content, path) { fs.writeFileSync(path, content, 'utf-8'); },
	parse() { return {}; },
});

globalThis.Format.codec = blockymodel_codec;

const plugin = loadPlugin(PLUGIN_PATH).embodygames_texture_layer_bridge;
if (!plugin) {
	console.error('plugin did not register');
	process.exit(1);
}
plugin.onload();

// --- helpers that drive the plugin ----------------------------------------
/** Everything Ctrl+S does, in the order Blockbench does it. */
function quickSave() {
	for (const texture of Texture.all) {
		if (!texture.saved) texture.save(); // saveTextures() runs first, synchronously
	}
	blockymodel_codec.write(blockymodel_codec.compile(), MODEL_PATH);
	globalThis.Blockbench.dispatchEvent('quick_save_model', {});
}

async function buildLayeredTexture() {
	// start from a clean slate so the plugin's own restore pass has nothing to reapply
	fs.rmSync(SIDECAR_PATH, { force: true });
	fs.rmSync(LAYERS_DIR, { recursive: true, force: true });
	const texture = new Texture().fromPath(TEXTURE_PATH);
	texture.add();
	await settle(20);
	texture.layers_enabled = true;
	const specs = [
		{ name: 'Base Color', color: '#ff0000', opacity: 100, blend_mode: 'default', offset: [0, 0], visible: true },
		{ name: 'Grime Overlay', color: '#00ff00', opacity: 80, blend_mode: 'multiply', offset: [4, 8], visible: true },
		{ name: 'Hidden Detail', color: '#0000ff', opacity: 55, blend_mode: 'screen', offset: [0, 0], visible: false },
	];
	for (const spec of specs) {
		const layer = new globalThis.TextureLayer({
			name: spec.name,
			opacity: spec.opacity,
			blend_mode: spec.blend_mode,
			offset: spec.offset,
			visible: spec.visible,
		}, texture);
		const size = spec.name === 'Grime Overlay' ? 16 : 32;
		layer.setSize(size, size);
		layer.ctx.drawImage(solidLayerCanvas(size, size, spec.color), 0, 0);
		texture.layers.push(layer);
	}
	texture.selected_layer = texture.layers[1];
	texture.updateLayerChanges(true);
	texture.saved = false;
	return { texture, specs };
}

/** Reopen the model from scratch, the way loading a .blockymodel does. */
async function reopenModel() {
	resetProject();
	globalThis.Format.codec = blockymodel_codec;
	blockymodel_codec.parse({ nodes: [] }, MODEL_PATH, {});
	await settle();
	return Texture.all.find((t) => t.path === TEXTURE_PATH);
}

(async function run() {
	// =====================================================================
	section('1. save writes a sidecar next to the texture');
	resetProject();
	const { texture: saved_texture, specs } = await buildLayeredTexture();
	quickSave();
	await settle();

	check('sidecar json exists', fs.existsSync(SIDECAR_PATH));
	check('layers folder exists', fs.existsSync(LAYERS_DIR));
	const sidecar = JSON.parse(fs.readFileSync(SIDECAR_PATH, 'utf-8'));
	check('version is 3', sidecar.version === 3, sidecar.version);
	check('every entry is typed as a layer', sidecar.layers.every((l) => l.type === 'layer'),
		sidecar.layers.map((l) => l.type));
	check('every layer records a file hash',
		sidecar.layers.every((l) => /^sha256:[0-9a-f]{64}$/.test(l.hash || '')),
		sidecar.layers.map((l) => l.hash));
	check('texture_file points at the flat png', sidecar.texture_file === 'Texture.png', sidecar.texture_file);
	check('canvas size recorded', sidecar.canvas.width === 32 && sidecar.canvas.height === 32, sidecar.canvas);
	check('source_hash is present and self-describing', /^sha256:[0-9a-f]{64}$/.test(sidecar.source_hash || ''), sidecar.source_hash);
	check('source_hash matches the png actually on disk',
		sidecar.source_hash === 'sha256:' + require('crypto').createHash('sha256').update(fs.readFileSync(TEXTURE_PATH)).digest('hex'));
	check('active_layer is the selected layer', sidecar.active_layer === saved_texture.layers[1].uuid);
	check('three layers recorded', sidecar.layers.length === 3, sidecar.layers.length);
	check('order is 0..n bottom-to-top', sidecar.layers.map((l) => l.order).join() === '0,1,2');
	check('names round-trip in stack order',
		sidecar.layers.map((l) => l.name).join('|') === specs.map((s) => s.name).join('|'),
		sidecar.layers.map((l) => l.name));
	check('opacity kept on Blockbench\'s 0-100 scale',
		sidecar.layers.map((l) => l.opacity).join() === '100,80,55', sidecar.layers.map((l) => l.opacity));
	check('blend modes round-trip',
		sidecar.layers.map((l) => l.blend_mode).join() === 'default,multiply,screen');
	check('offsets round-trip', JSON.stringify(sidecar.layers[1].offset) === '[4,8]', sidecar.layers[1].offset);
	check('visibility round-trips', sidecar.layers[2].visible === false);
	check('one png per layer on disk', fs.readdirSync(LAYERS_DIR).filter((f) => f.endsWith('.png')).length === 3,
		fs.readdirSync(LAYERS_DIR));
	check('layer files are inside the .layers subfolder, not loose beside the model',
		sidecar.layers.every((l) => l.file.startsWith('Texture.layers/')));
	check('no stray png landed next to the model (would be picked up as a texture)',
		fs.readdirSync(MODEL_DIR).filter((f) => f.endsWith('.png')).length === 1,
		fs.readdirSync(MODEL_DIR));
	check('texture was not marked dirty by the sidecar write', saved_texture.saved === true);

	// =====================================================================
	section('2. reopening the model rebuilds the stack');
	let texture = await reopenModel();
	check('texture rediscovered', !!texture);
	check('layers switched back on', texture.layers_enabled === true);
	check('all three layers back', texture.layers.length === 3, texture.layers.length);
	check('bottom-to-top order preserved',
		texture.layers.map((l) => l.name).join('|') === 'Base Color|Grime Overlay|Hidden Detail',
		texture.layers.map((l) => l.name));
	check('opacity restored', texture.layers.map((l) => l.opacity).join() === '100,80,55');
	check('blend modes restored', texture.layers.map((l) => l.blend_mode).join() === 'default,multiply,screen');
	check('offset restored', JSON.stringify(texture.layers[1].offset) === '[4,8]');
	check('visibility restored', texture.layers[2].visible === false);
	check('layer uuids preserved', texture.layers[0].uuid === sidecar.layers[0].id);
	check('active layer restored', texture.selected_layer && texture.selected_layer.uuid === sidecar.active_layer);
	check('per-layer canvas size restored', texture.layers[1].width === 16 && texture.layers[1].height === 16,
		[texture.layers[1].width, texture.layers[1].height]);
	check('layer pixels restored (bottom layer is red)',
		pixelAt(texture.layers[0], 1, 1).join() === '255,0,0,255', pixelAt(texture.layers[0], 1, 1));
	check('layer pixels restored (middle layer is green)',
		pixelAt(texture.layers[1], 1, 1).join() === '0,255,0,255', pixelAt(texture.layers[1], 1, 1));
	check('reopen did not mark the project dirty', globalThis.Project.saved === true);
	check('reopen did not mark the texture dirty', texture.saved === true);

	// =====================================================================
	section('3. a missing layer png degrades gracefully');
	const layer_files = fs.readdirSync(LAYERS_DIR).filter((f) => f.endsWith('.png')).sort();
	fs.unlinkSync(PathModule.join(LAYERS_DIR, layer_files[0]));
	texture = await reopenModel();
	check('the remaining layers still load', texture.layers.length === 2, texture.layers.length);
	check('the load was not aborted', texture.layers_enabled === true);
	check('the user is told something was missing',
		globalThis.Blockbench.messages.some((m) => /missing/i.test(m)), globalThis.Blockbench.messages);

	// =====================================================================
	section('4. flat png edited outside Blockbench');
	// rebuild a clean sidecar first
	resetProject();
	await buildLayeredTexture();
	quickSave();
	await settle();
	// somebody paints on Texture.png in another program
	writePng(TEXTURE_PATH, 32, 32, (ctx) => { ctx.fillStyle = '#ffcc00'; ctx.fillRect(0, 0, 32, 32); });

	globalThis.Blockbench.message_box_answer = 'keep_flat';
	texture = await reopenModel();
	check('the user is asked instead of silently overwritten',
		globalThis.Blockbench.message_box_calls.length === 1, globalThis.Blockbench.message_box_calls.length);
	check('"keep the file" leaves the texture flat', texture.layers.length === 0, texture.layers.length);
	check('"keep the file" does not delete the sidecar', fs.existsSync(SIDECAR_PATH));

	globalThis.Blockbench.message_box_answer = 'restore_and_keep';
	texture = await reopenModel();
	check('"keep as top layer" restores the stack plus the outside edit',
		texture.layers.length === 4, texture.layers.length);
	check('the outside edit is the top layer',
		texture.layers[3].name === 'Edited outside Blockbench', texture.layers[3].name);
	check('the outside edit kept its pixels',
		pixelAt(texture.layers[3], 1, 1).join() === '255,204,0,255', pixelAt(texture.layers[3], 1, 1));

	globalThis.Blockbench.message_box_answer = 'restore';
	texture = await reopenModel();
	check('"discard the edit" restores exactly the saved stack', texture.layers.length === 3, texture.layers.length);

	// =====================================================================
	section('5. layers collapsed back to one');
	// texture currently has a restored stack (state "applied")
	texture.layers.splice(0, texture.layers.length);
	texture.layers_enabled = false;
	texture.selected_layer = null;
	texture.saved = false;
	quickSave();
	await settle();
	check('stale sidecar json removed', !fs.existsSync(SIDECAR_PATH));
	check('stale layers folder removed', !fs.existsSync(LAYERS_DIR));

	// =====================================================================
	section('6. a sidecar we never applied is not deleted or overwritten');
	resetProject();
	await buildLayeredTexture();
	quickSave();
	await settle();
	check('sidecar written again', fs.existsSync(SIDECAR_PATH));
	// simulate: model opened, restore did not happen (e.g. file access denied), texture flat
	resetProject();
	globalThis.Format.codec = blockymodel_codec;
	const flat = new Texture().fromPath(TEXTURE_PATH);
	flat.__layer_bridge_state = 'skipped';
	globalThis.Project.textures.push(flat);
	await settle();
	flat.saved = false;
	quickSave();
	await settle();
	check('sidecar survives a save that could not see it', fs.existsSync(SIDECAR_PATH));

	// =====================================================================
	section('7. hand-edited sidecar cannot point outside the texture folder');
	const escaped = JSON.parse(fs.readFileSync(SIDECAR_PATH, 'utf-8'));
	fs.writeFileSync(PathModule.join(ROOT, 'outside.png'),
		fs.readFileSync(PathModule.join(LAYERS_DIR, fs.readdirSync(LAYERS_DIR)[0])));
	escaped.layers[0].file = '../../outside.png';
	delete escaped.source_hash;
	fs.writeFileSync(SIDECAR_PATH, JSON.stringify(escaped, null, 2), 'utf-8');
	texture = await reopenModel();
	check('the escaping layer is skipped, the rest load', texture.layers.length === 2, texture.layers.length);

	// =====================================================================
	section('8. codec handling');
	check('the bridged codec is wrapped', blockymodel_codec.__layer_bridge_wrapped === true);
	check('Blockbench\'s own project codec is left alone', project_codec.__layer_bridge_wrapped === undefined);
	// load-order safety net: a codec registered after onload
	const late_codec = new Codec('late_format', {
		write(content, path) { fs.writeFileSync(path, content, 'utf-8'); },
		parse() { return {}; },
	});
	check('a codec registered after onload is not wrapped yet', late_codec.__layer_bridge_wrapped === undefined);
	globalThis.Blockbench.dispatchEvent('quick_save_model', {});
	await settle();
	check('...and gets picked up on the next save', late_codec.__layer_bridge_wrapped === true);

	// =====================================================================
	section('9. temporary layers (a floating selection) are not persisted');
	resetProject();
	fs.rmSync(SIDECAR_PATH, { force: true });
	fs.rmSync(LAYERS_DIR, { recursive: true, force: true });
	const temp = new Texture().fromPath(TEXTURE_PATH);
	// pretend our load pass ran and found nothing, so a delete/write would be allowed
	temp.__layer_bridge_state = 'absent';
	globalThis.Project.textures.push(temp);
	await settle();
	// Blockbench turns layers on temporarily when you drag a selection around
	temp.layers_enabled = true;
	temp.flags.add('temporary_layers');
	const temp_layer = new globalThis.TextureLayer({ name: 'selection' }, temp);
	temp_layer.setSize(4, 4);
	temp.layers.push(temp_layer);
	temp.saved = false;
	quickSave();
	await settle();
	check('a floating selection does not get written as a layer stack', !fs.existsSync(SIDECAR_PATH));

	// and once it is resolved into a real stack, it does get written
	temp.flags.delete('temporary_layers');
	temp.saved = false;
	quickSave();
	await settle();
	check('a real stack on the same texture is written', fs.existsSync(SIDECAR_PATH));

	// =====================================================================
	section('11. unchanged layers are not rewritten');
	resetProject();
	const { texture: churn_texture } = await buildLayeredTexture();
	quickSave();
	await settle();
	const first_pass = fs.readdirSync(LAYERS_DIR).filter((f) => f.endsWith('.png'))
		.map((f) => fs.statSync(PathModule.join(LAYERS_DIR, f)).mtimeMs);
	const json_mtime = fs.statSync(SIDECAR_PATH).mtimeMs;
	await settle(20);
	quickSave(); // nothing touched since the last save
	await settle();
	const second_pass = fs.readdirSync(LAYERS_DIR).filter((f) => f.endsWith('.png'))
		.map((f) => fs.statSync(PathModule.join(LAYERS_DIR, f)).mtimeMs);
	check('no layer PNG rewritten on a no-op save', first_pass.join() === second_pass.join(),
		{ first_pass, second_pass });
	check('sidecar json not rewritten either', fs.statSync(SIDECAR_PATH).mtimeMs === json_mtime);

	// one layer actually changes
	churn_texture.layers[1].ctx.drawImage(solidLayerCanvas(16, 16, '#ff00ff'), 0, 0);
	churn_texture.updateLayerChanges(true);
	churn_texture.saved = false;
	await settle(20);
	quickSave();
	await settle();
	const third_pass = fs.readdirSync(LAYERS_DIR).filter((f) => f.endsWith('.png')).sort()
		.map((f) => fs.statSync(PathModule.join(LAYERS_DIR, f)).mtimeMs);
	const changed_count = third_pass.filter((m, i) => m !== second_pass.slice().sort()[i]).length;
	check('exactly one layer PNG rewritten when one layer changed', changed_count === 1, third_pass);

	// =====================================================================
	section('12. a layer PNG edited outside Blockbench is picked up live');
	resetProject();
	const live = (await buildLayeredTexture()).texture;
	quickSave();
	await settle(600); // clear the plugin's own post-save suppression window
	const watched_layer = live.layers[0];
	check('the layer knows which file it came from', !!watched_layer.__eg_file_name,
		watched_layer.__eg_file_name);
	check('a watcher is running', !!live.__eg_layer_watcher);

	live.saved = true; // pretend everything is in sync
	// somebody opens base-color_xxxx.png in Photoshop and saves it cyan
	writePng(PathModule.join(LAYERS_DIR, watched_layer.__eg_file_name), 32, 32,
		(ctx) => { ctx.fillStyle = '#00ffff'; ctx.fillRect(0, 0, 32, 32); });
	await settle(700);
	check('the layer picked up the new pixels',
		pixelAt(watched_layer, 1, 1).join() === '0,255,255,255', pixelAt(watched_layer, 1, 1));
	check('the texture is marked dirty so the flat PNG gets re-exported', live.saved === false);
	check('the user is told', globalThis.Blockbench.messages.some((m) => /Reloaded layer/i.test(m)),
		globalThis.Blockbench.messages);

	// =====================================================================
	section('13. our own save does not look like an outside edit');
	globalThis.Blockbench.messages = [];
	live.saved = false;
	quickSave();
	await settle(700);
	check('no reload triggered by our own write',
		!globalThis.Blockbench.messages.some((m) => /Reloaded layer/i.test(m)),
		globalThis.Blockbench.messages);

	// =====================================================================
	section('14. layer edited while the project was closed');
	resetProject();
	await buildLayeredTexture();
	quickSave();
	await settle();
	const closed_sidecar = JSON.parse(fs.readFileSync(SIDECAR_PATH, 'utf-8'));
	const edited_file = PathModule.basename(closed_sidecar.layers[2].file);
	// project is closed; someone edits a layer image
	writePng(PathModule.join(LAYERS_DIR, edited_file), 32, 32,
		(ctx) => { ctx.fillStyle = '#ff8800'; ctx.fillRect(0, 0, 32, 32); });
	texture = await reopenModel();
	check('the edited layer loads with its new pixels',
		pixelAt(texture.layers[2], 1, 1).join() === '255,136,0,255', pixelAt(texture.layers[2], 1, 1));
	check('the texture is dirty, so the stale flat PNG will be regenerated', texture.saved === false);
	check('the user is told which layers changed',
		globalThis.Blockbench.messages.some((m) => /changed on disk/i.test(m)),
		globalThis.Blockbench.messages);

	// =====================================================================
	section('15. watching can be turned off, and stops cleanly');
	check('watchers are tracked', !!texture.__eg_layer_watcher);
	globalThis.settings.embodygames_watch_layer_files.value = false;
	globalThis.settings.embodygames_watch_layer_files.onChange(false);
	check('turning the setting off closes them', !texture.__eg_layer_watcher);
	globalThis.settings.embodygames_watch_layer_files.value = true;

	// =====================================================================
	section('10. settings toggle and unload');
	globalThis.settings.embodygames_persist_texture_layers.value = false;
	resetProject();
	fs.rmSync(SIDECAR_PATH, { force: true });
	fs.rmSync(LAYERS_DIR, { recursive: true, force: true });
	await buildLayeredTexture();
	quickSave();
	await settle();
	check('nothing is written while the setting is off', !fs.existsSync(SIDECAR_PATH));
	globalThis.settings.embodygames_persist_texture_layers.value = true;

	const wrapped_write = blockymodel_codec.write;
	plugin.onunload();
	check('codec.write restored on unload', blockymodel_codec.write !== wrapped_write);
	check('wrap marker cleared', blockymodel_codec.__layer_bridge_wrapped === undefined);
	check('setting removed', globalThis.settings.embodygames_persist_texture_layers === undefined);
	check('menu entries removed', Texture.prototype.menu.structure.length === 0,
		Texture.prototype.menu.structure.length);
	check('watch setting removed', globalThis.settings.embodygames_watch_layer_files === undefined);
	resetProject();
	await buildLayeredTexture();
	fs.rmSync(SIDECAR_PATH, { force: true });
	quickSave();
	await settle();
	check('no sidecar written after unload', !fs.existsSync(SIDECAR_PATH));

	// =====================================================================
	console.log('\n' + passes + ' passed, ' + failures + ' failed');
	process.exit(failures ? 1 : 0);
})().catch((error) => {
	console.error('\nharness blew up:', error);
	process.exit(1);
});
