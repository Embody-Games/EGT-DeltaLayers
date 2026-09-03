/*
 * Layer group tests. Runs the same plugin against a Blockbench 5.2 shaped mock, and
 * flips the group classes off to stand in for 5.1, so the downgrade round trip can be
 * exercised for real.
 *
 * Stack under test (flat array, exactly as 5.2 stores it):
 *
 *   [0] Base Color                 (layer)
 *   [1] Freckles                   (layer, parent = Skin Details)
 *   [2] Blush                      (layer, parent = Skin Details)
 *   [3] Skin Details               (group)
 *   [4] Grime Overlay              (layer)
 */
const {
	loadPlugin, resetProject, settle, enableLayerGroups, disableLayerGroups,
	Texture, Codec, fs, PathModule,
} = require('./mock_blockbench');
const { createCanvas } = require('canvas');

const PLUGIN_PATH = PathModule.resolve(__dirname, '..', 'embodygames_texture_layer_bridge.js');
const ROOT = PathModule.join(require('os').tmpdir(), 'lb_test_52');
const MODEL_DIR = PathModule.join(ROOT, 'Models', 'Knight');
const MODEL_PATH = PathModule.join(MODEL_DIR, 'Knight.blockymodel');
const TEXTURE_PATH = PathModule.join(MODEL_DIR, 'Texture.png');
const SIDECAR_PATH = PathModule.join(MODEL_DIR, 'Texture.layers.json');
const LAYERS_DIR = PathModule.join(MODEL_DIR, 'Texture.layers');

let passes = 0;
let failures = 0;
function check(label, condition, detail) {
	if (condition) { passes++; console.log('  ok   ' + label); }
	else { failures++; console.log('  FAIL ' + label + (detail !== undefined ? ('  -> ' + JSON.stringify(detail)) : '')); }
}
const section = (name) => console.log('\n' + name);

function writePng(path, width, height, color) {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, width, height);
	fs.writeFileSync(path, canvas.toDataURL('image/png').split(',')[1], { encoding: 'base64' });
}
function solid(width, height, color) {
	const canvas = createCanvas(width, height);
	const ctx = canvas.getContext('2d');
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, width, height);
	return canvas;
}
function pixelAt(layer, x, y) {
	const d = layer.ctx.getImageData(x, y, 1, 1).data;
	return [d[0], d[1], d[2], d[3]];
}
function names(texture) { return texture.layers.map((l) => l.name).join('|'); }
function readSidecar() { return JSON.parse(fs.readFileSync(SIDECAR_PATH, 'utf-8')); }

// --- fixture ---------------------------------------------------------------
fs.rmSync(ROOT, { recursive: true, force: true });
fs.mkdirSync(MODEL_DIR, { recursive: true });
fs.writeFileSync(MODEL_PATH, '{}', 'utf-8');
writePng(TEXTURE_PATH, 32, 32, '#123456');

const codec = new Codec('blockymodel', {
	compile: () => '{}',
	write(content, path) { fs.writeFileSync(path, content, 'utf-8'); },
	parse(model, path) {
		const dir = PathModule.dirname(path);
		for (const file_name of fs.readdirSync(dir)) {
			if (!/\.png$/i.test(file_name)) continue;
			const texture_path = PathModule.join(dir, file_name);
			if (Texture.all.find((t) => t.path === texture_path)) continue;
			new Texture().fromPath(texture_path).add();
		}
		return { new_groups: [], new_textures: [] };
	},
});
globalThis.Format.codec = codec;

enableLayerGroups(); // start as 5.2
const plugin = loadPlugin(PLUGIN_PATH).embodygames_texture_layer_bridge;
plugin.onload();

function quickSave() {
	for (const t of Texture.all) if (!t.saved) t.save();
	codec.write(codec.compile(), MODEL_PATH);
	globalThis.Blockbench.dispatchEvent('quick_save_model', {});
}

function addLayer(texture, name, color, size = 32) {
	const layer = new globalThis.TextureLayer({ name }, texture);
	layer.setSize(size, size);
	layer.ctx.drawImage(solid(size, size, color), 0, 0);
	texture.layers.push(layer);
	return layer;
}

async function buildGroupedTexture() {
	fs.rmSync(SIDECAR_PATH, { force: true });
	fs.rmSync(LAYERS_DIR, { recursive: true, force: true });
	const texture = new Texture().fromPath(TEXTURE_PATH);
	texture.add();
	await settle(20);
	texture.layers_enabled = true;

	addLayer(texture, 'Base Color', '#ff0000');
	const freckles = addLayer(texture, 'Freckles', '#00ff00');
	const blush = addLayer(texture, 'Blush', '#0000ff');
	const group = new globalThis.TextureLayerGroup({ name: 'Skin Details', folded: true }, texture);
	texture.layers.push(group);
	freckles.parent_uuid = group.uuid;
	blush.parent_uuid = group.uuid;
	addLayer(texture, 'Grime Overlay', '#ffff00');

	texture.selected_layer = texture.layers[0];
	texture.updateLayerChanges(true);
	texture.saved = false;
	return { texture, group };
}

async function reopen() {
	resetProject();
	globalThis.Format.codec = codec;
	codec.parse({}, MODEL_PATH, {});
	await settle();
	return Texture.all.find((t) => t.path === TEXTURE_PATH);
}

(async function run() {
	// =====================================================================
	section('1. saving a grouped stack on 5.2');
	resetProject();
	const { group } = await buildGroupedTexture();
	quickSave();
	await settle();

	let sidecar = readSidecar();
	check('sidecar is version 3', sidecar.version === 3, sidecar.version);
	check('all five items recorded', sidecar.layers.length === 5, sidecar.layers.length);
	const group_entry = sidecar.layers.find((e) => e.type === 'layer_group');
	check('the group is recorded as a group', !!group_entry, sidecar.layers.map((e) => e.type));
	check('the group keeps its name', group_entry && group_entry.name === 'Skin Details');
	check('the group keeps its folded state', group_entry && group_entry.folded === true);
	check('the group has no image file', group_entry && group_entry.file === undefined);
	check('children point at the group',
		sidecar.layers.filter((e) => e.parent === group.uuid).map((e) => e.name).join('|') === 'Freckles|Blush',
		sidecar.layers.map((e) => [e.name, e.parent]));
	check('top level layers have no parent',
		sidecar.layers.filter((e) => e.type === 'layer' && !e.parent).map((e) => e.name).join('|')
			=== 'Base Color|Grime Overlay');
	check('only real layers got image files',
		fs.readdirSync(LAYERS_DIR).filter((f) => f.endsWith('.png')).length === 4,
		fs.readdirSync(LAYERS_DIR));

	// =====================================================================
	section('2. reopening on 5.2 rebuilds the groups');
	let texture = await reopen();
	check('all five items back', texture.layers.length === 5, texture.layers.length);
	check('order preserved', names(texture) === 'Base Color|Freckles|Blush|Skin Details|Grime Overlay',
		names(texture));
	const restored_group = texture.layers.find((l) => l.type === 'layer_group');
	check('the group came back as a group', !!restored_group);
	check('the group kept its uuid', restored_group && restored_group.uuid === group.uuid);
	check('the group kept folded', restored_group && restored_group.folded === true);
	check('both children are inside it',
		restored_group && restored_group.children.map((l) => l.name).join('|') === 'Freckles|Blush',
		restored_group && restored_group.children.map((l) => l.name));
	check('layer pixels still correct',
		pixelAt(texture.layers[1], 1, 1).join() === '0,255,0,255', pixelAt(texture.layers[1], 1, 1));

	// =====================================================================
	section('3. opening the same file on 5.1, where groups do not exist');
	disableLayerGroups();
	texture = await reopen();
	check('the group is skipped', texture.layers.every((l) => l.type !== 'layer_group'),
		texture.layers.map((l) => l.type));
	check('all four real layers are there', texture.layers.length === 4, names(texture));
	check('they come back flat', texture.layers.every((l) => !l.parent_uuid));
	check('no "missing file" warning was shown',
		!globalThis.Blockbench.messages.some((m) => /missing/i.test(m)), globalThis.Blockbench.messages);

	// =====================================================================
	section('4. working and saving in 5.1, then going back to 5.2');
	// paint on a layer, the way you would after downgrading
	const edited = texture.layers.find((l) => l.name === 'Blush');
	edited.ctx.drawImage(solid(32, 32, '#ff00ff'), 0, 0);
	texture.updateLayerChanges(true);
	texture.saved = false;
	quickSave();
	await settle();

	sidecar = readSidecar();
	check('the group survived a save made on 5.1',
		sidecar.layers.some((e) => e.type === 'layer_group' && e.id === group.uuid),
		sidecar.layers.map((e) => e.type));
	check('group membership survived too',
		sidecar.layers.filter((e) => e.parent === group.uuid).map((e) => e.name).sort().join('|') === 'Blush|Freckles',
		sidecar.layers.map((e) => [e.name, e.parent]));

	enableLayerGroups();
	texture = await reopen();
	check('back on 5.2 the group is where it was', names(texture) === 'Base Color|Freckles|Blush|Skin Details|Grime Overlay',
		names(texture));
	const group_again = texture.layers.find((l) => l.type === 'layer_group');
	check('with both children still inside',
		group_again && group_again.children.map((l) => l.name).join('|') === 'Freckles|Blush',
		group_again && group_again.children.map((l) => l.name));
	check('and the edit made in 5.1 is intact',
		pixelAt(texture.layers[2], 1, 1).join() === '255,0,255,255', pixelAt(texture.layers[2], 1, 1));

	// =====================================================================
	section('5. a layer deleted on 5.1 really is deleted');
	disableLayerGroups();
	texture = await reopen();
	const doomed = texture.layers.findIndex((l) => l.name === 'Freckles');
	texture.layers.splice(doomed, 1);
	texture.updateLayerChanges(true);
	texture.saved = false;
	quickSave();
	await settle();
	sidecar = readSidecar();
	check('the deleted layer is gone from the sidecar',
		!sidecar.layers.some((e) => e.name === 'Freckles'), sidecar.layers.map((e) => e.name));
	check('its image file was cleaned up',
		!fs.readdirSync(LAYERS_DIR).some((f) => f.startsWith('freckles')), fs.readdirSync(LAYERS_DIR));
	check('but the group is still carried forward',
		sidecar.layers.some((e) => e.type === 'layer_group'), sidecar.layers.map((e) => e.type));

	enableLayerGroups();
	texture = await reopen();
	const shrunk = texture.layers.find((l) => l.type === 'layer_group');
	check('the group now has one child', shrunk && shrunk.children.length === 1,
		shrunk && shrunk.children.map((l) => l.name));

	// =====================================================================
	section('6. a layer created on 5.1 comes back at the top level');
	disableLayerGroups();
	texture = await reopen();
	addLayer(texture, 'New On 51', '#00ffff');
	texture.updateLayerChanges(true);
	texture.saved = false;
	quickSave();
	await settle();
	enableLayerGroups();
	texture = await reopen();
	const fresh = texture.layers.find((l) => l.name === 'New On 51');
	check('the new layer is there', !!fresh, names(texture));
	check('with no parent', fresh && !fresh.parent_uuid, fresh && fresh.parent_uuid);
	check('the group is still intact', texture.layers.some((l) => l.type === 'layer_group'));

	// =====================================================================
	section('7. a group deleted on 5.2 really is deleted');
	texture = await reopen();
	const group_index = texture.layers.findIndex((l) => l.type === 'layer_group');
	const removed_uuid = texture.layers[group_index].uuid;
	for (const layer of texture.layers) {
		if (layer.parent_uuid === removed_uuid) layer.parent_uuid = undefined;
	}
	texture.layers.splice(group_index, 1);
	texture.updateLayerChanges(true);
	texture.saved = false;
	quickSave();
	await settle();
	sidecar = readSidecar();
	check('the group is gone for good', !sidecar.layers.some((e) => e.type === 'layer_group'),
		sidecar.layers.map((e) => e.type));
	check('its former children survive at the top level',
		sidecar.layers.every((e) => !e.parent), sidecar.layers.map((e) => [e.name, e.parent]));

	// =====================================================================
	section('8. a sidecar from a newer plugin is never overwritten');
	const future = readSidecar();
	future.version = 99;
	fs.writeFileSync(SIDECAR_PATH, JSON.stringify(future, null, 2), 'utf-8');
	texture = await reopen();
	check('it refuses to load it', texture.layers.length === 0, texture.layers.length);
	texture.layers_enabled = true;
	addLayer(texture, 'Something', '#ffffff');
	texture.saved = false;
	quickSave();
	await settle();
	check('and refuses to overwrite it', readSidecar().version === 99, readSidecar().version);

	console.log('\n' + passes + ' passed, ' + failures + ' failed');
	process.exit(failures ? 1 : 0);
})().catch((error) => {
	console.error('\nharness blew up:', error);
	process.exit(1);
});
