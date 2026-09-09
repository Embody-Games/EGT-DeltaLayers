/*
 * Delta Layers for Blockbench
 * ---------------------------
 * Keeps a texture's layer stack (per-layer image + blend mode + opacity + offset +
 * visibility + order) alive across a save/reload cycle for model formats whose file
 * has no concept of layers - Hytale's .blockymodel above all, but also Minecraft
 * Java/Bedrock and anything else that exports a flat texture.
 *
 * It does that without touching the model file at all: the layer stack is written to
 * a sidecar next to the texture PNG,
 *
 *     Texture.png                     <- the flat texture, unchanged, what the game reads
 *     Texture.layers.json             <- the stack: order, blend modes, opacity, offsets
 *     Texture.layers/                 <- one PNG per layer
 *       base-color_1a2b3c4d.png
 *       grime-overlay_9e8f7a6b.png
 *
 * and read back when the model (or just the texture) is opened again. Anything that
 * only cares about the clean model plus flat texture never sees it.
 *
 * Desktop app only - the whole approach needs real filesystem access.
 *
 * Author: David - Embody Games
 * License: do what you like with it.
 *
 * NOTE ON THE FILENAME: Blockbench derives a file-loaded plugin's id from its filename
 * (pathToName in plugin_loader.ts) and matches it against the id passed to
 * BBPlugin.register below. Rename this file and it will refuse to load with
 * "could not load plugin". Keep the two in sync.
 */
(function () {
'use strict';

// Must match the filename: delta_layers.js
const PLUGIN_ID = 'delta_layers';
const PLUGIN_VERSION = '1.5.1';
const SIDECAR_VERSION = 3; // v3 adds layer groups (type/parent/folded); v1 and v2 still load
const SETTING_ID = 'delta_layers_persist';
const WATCH_SETTING_ID = 'delta_layers_watch';
const TAG = '[delta-layers]'; // shorter than the id, this goes on every console line
// 48x48 PNG from delta_layers_icon.png, inlined by scripts/icon.mjs so the plugin stays
// one file. Regenerate with "npm run icon" after changing the PNG, do not edit by hand.
const PLUGIN_ICON = 'data:image/png;base64,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';

// Blockbench runs plugin code as new Function('requireNativeModule', 'require', code),
// so requireNativeModule is a parameter in our enclosing scope. Guard anyway so the
// file can also be evaluated outside that wrapper (dev tools, tests).
const requireModule =
	(typeof requireNativeModule === 'function') ? requireNativeModule :
	(typeof require === 'function') ? require : null;

// ---------------------------------------------------------------------------
// state / cleanup bookkeeping
// ---------------------------------------------------------------------------

let native_fs = null;          // scoped fs handed to us by Blockbench, once granted
let fs_permission_refused = false;
let deletables = [];           // event hooks, actions, settings - anything with .delete()
let wrapped_codecs = [];       // codecs whose write/parse we patched
let menu_entries = [];         // [menu, action] pairs we added
let sync_timer = null;
let layer_watchers = [];       // { texture, watcher, dir, timers }
let suppress_watch_until = 0;  // set around our own writes, so we don't chase our own tail

const log = (...args) => console.log(TAG, ...args);
const warn = (...args) => console.warn(TAG, ...args);
const fail = (...args) => console.error(TAG, ...args);

// ---------------------------------------------------------------------------
// native modules
// ---------------------------------------------------------------------------

/**
 * Blockbench hands plugins a *scoped* fs and shows a permission dialog the first time.
 * Pass prompt=false to ask "am I already allowed?" without putting a dialog in the
 * user's face - we only ever prompt at a moment where the user is knowingly loading or
 * saving a model of a format that needs the bridge.
 */
function getFS(prompt) {
	if (native_fs) return native_fs;
	if (!requireModule) return null;
	if (!prompt && fs_permission_refused) return null;
	try {
		const result = requireModule('fs', {
			message: 'Texture layer stacks are stored in a sidecar file next to each texture PNG. '
				+ 'File access is needed to read and write those.',
			show_permission_dialog: prompt ? undefined : false,
		});
		if (result) {
			native_fs = result;
			fs_permission_refused = false;
		} else if (prompt) {
			fs_permission_refused = true;
			warn('file access was not granted - texture layers will not be persisted');
		}
		return native_fs;
	} catch (error) {
		fail('could not get file access', error);
		return null;
	}
}

function getCrypto() {
	if (!requireModule) return null;
	try {
		return requireModule('crypto'); // a "safe" module in Blockbench - no dialog
	} catch (error) {
		return null;
	}
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function bridgeEnabled() {
	if (typeof isApp !== 'undefined' && !isApp) return false;
	const setting = (typeof settings !== 'undefined') && settings[SETTING_ID];
	return !setting || setting.value !== false;
}

function watchingEnabled() {
	if (!bridgeEnabled()) return false;
	const setting = (typeof settings !== 'undefined') && settings[WATCH_SETTING_ID];
	return !setting || setting.value !== false;
}

/** Is this texture still in an open project, and if so which one? */
function projectHolding(texture) {
	if (typeof Texture !== 'undefined' && Texture.all.includes(texture)) {
		return (typeof Project !== 'undefined') ? Project : null;
	}
	if (typeof ModelProject !== 'undefined' && ModelProject.all) {
		return ModelProject.all.find((project) => project.textures && project.textures.includes(texture)) || null;
	}
	return null;
}

/**
 * Blockbench's own .bbmodel codec (id 'project') already serializes texture.layers in
 * full, so it needs no help. Every other codec - blockymodel, Minecraft Java/Bedrock,
 * obj, ... - writes a flat texture at best. One rule, no format-specific checks.
 */
function codecNeedsLayerBridge(codec) {
	return !!codec && codec.id !== 'project';
}

/** Is this codec the one that actually stores the project's model? */
function isModelSaveCodec(codec) {
	if (!codecNeedsLayerBridge(codec)) return false;
	if (typeof Format !== 'undefined' && Format && Format.codec === codec) return true;
	if (typeof Project !== 'undefined' && Project && Project.export_codec === codec.id) return true;
	return false;
}

/** Does the *current project* save through a codec that loses layers? */
function projectUsesBridge() {
	if (typeof Project === 'undefined' || !Project) return false;
	if (typeof Format !== 'undefined' && codecNeedsLayerBridge(Format && Format.codec)) return true;
	if (typeof Codecs !== 'undefined' && codecNeedsLayerBridge(Codecs[Project.export_codec])) return true;
	return false;
}

/*
 * Blockbench 5.2 turned texture.layers into a flat list of TextureLayerItem, which can be
 * a TextureLayer (has a canvas) or a TextureLayerGroup (has none, just a name and a
 * folded flag). Nesting is expressed with parent_uuid, not by nesting the array. The base
 * class comment says text and fx layers may follow, so anything we do not recognise is
 * carried through untouched rather than dropped.
 */
function groupsSupported() {
	return typeof TextureLayerGroup !== 'undefined' && typeof TextureLayerGroup === 'function';
}

function isLayerGroup(item) {
	if (!item) return false;
	if (groupsSupported() && item instanceof TextureLayerGroup) return true;
	return item.type === 'layer_group';
}

/** A real, paintable layer: something with pixels we can write to a PNG. */
function isPaintableLayer(item) {
	return !!item && !isLayerGroup(item) && !!item.canvas && !!item.ctx;
}

function plural(count, noun) {
	return count + ' ' + noun + (count === 1 ? '' : 's');
}

function slugify(name) {
	const slug = String(name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40);
	return slug || 'layer';
}

function layerFileName(name, uuid) {
	return slugify(name) + '_' + String(uuid || '').replace(/[^a-z0-9]/gi, '').slice(0, 8) + '.png';
}

function sidecarPathsFor(texture) {
	const dir = PathModule.dirname(texture.path);
	const base = pathToName(texture.path, false);
	return {
		dir,
		base,
		json: PathModule.join(dir, base + '.layers.json'),
		layers_dir: PathModule.join(dir, base + '.layers'),
	};
}

/**
 * Hash of the flat PNG as it sits on disk, used purely as a staleness guard: if the
 * file changed since we wrote the sidecar, someone edited it outside Blockbench and we
 * must not silently throw their work away.
 *
 * Format is "<algo>:<hex>" so a sidecar written by an older/newer version still
 * compares correctly - we re-hash with whatever algorithm the file names.
 */
function hashFile(file_path, algo) {
	const fs = getFS();
	const crypto = getCrypto();
	if (!fs || !crypto) return null;
	const algorithm = algo || 'sha256';
	try {
		const hash = crypto.createHash(algorithm).update(fs.readFileSync(file_path)).digest('hex');
		return algorithm + ':' + hash;
	} catch (error) {
		warn('could not hash ' + file_path, error);
		return null;
	}
}

/** Same digest as hashFile, computed from base64 without decoding it ourselves. */
function hashBase64(base64, algo) {
	const crypto = getCrypto();
	if (!crypto || typeof base64 !== 'string') return null;
	const algorithm = algo || 'sha256';
	try {
		return algorithm + ':' + crypto.createHash(algorithm).update(base64, 'base64').digest('hex');
	} catch (error) {
		return null;
	}
}

/**
 * Digest of a layer's live pixels. Kept in memory only. Lets a save skip the PNG encode
 * entirely for layers nobody touched, which is the expensive half of writing a sidecar.
 */
function hashLayerPixels(layer) {
	const crypto = getCrypto();
	if (!crypto || !layer.canvas || !layer.canvas.width || !layer.canvas.height) return null;
	try {
		const image_data = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
		// image_data.data is a Uint8ClampedArray, which createHash accepts directly - no
		// need to reach for Buffer.
		return crypto.createHash('sha256')
			.update(layer.canvas.width + 'x' + layer.canvas.height + ':')
			.update(image_data.data)
			.digest('hex');
	} catch (error) {
		return null; // no pixel hash just means we fall back to always encoding
	}
}

/**
 * updateLayerChanges() refreshes the texture's own material, but a texture that is one
 * channel of a PBR material group also needs the group's combined material rebuilt -
 * Blockbench does this itself at the end of updateChangesAfterEdit(). We call
 * updateLayerChanges() directly, so we have to do the same.
 */
function refreshMaterialGroup(texture) {
	try {
		if (!texture.group) return;
		if (texture.pbr_channel !== 'mer' && texture.pbr_channel !== 'height') return;
		if (typeof BarItems === 'undefined' || !BarItems.view_mode || BarItems.view_mode.value !== 'material') return;
		const group = texture.getGroup && texture.getGroup();
		if (group && group.is_material && typeof group.updateMaterial === 'function') group.updateMaterial();
	} catch (error) {
		warn('could not refresh the material group for "' + texture.name + '"', error);
	}
}

function copyCanvas(source) {
	const canvas = document.createElement('canvas');
	canvas.width = source.width;
	canvas.height = source.height;
	canvas.getContext('2d').drawImage(source, 0, 0);
	return canvas;
}

function validBlendMode(mode) {
	const values = (typeof TextureLayer !== 'undefined'
		&& TextureLayer.properties
		&& TextureLayer.properties.blend_mode
		&& TextureLayer.properties.blend_mode.enum_values) || [];
	return values.includes(mode) ? mode : 'default';
}

function validVector2(value, fallback) {
	if (value instanceof Array && value.length >= 2
		&& typeof value[0] === 'number' && typeof value[1] === 'number'
		&& isFinite(value[0]) && isFinite(value[1])) {
		return [value[0], value[1]];
	}
	return fallback;
}

// ---------------------------------------------------------------------------
// SAVE: write the sidecar
// ---------------------------------------------------------------------------

/** Coalesce: one Ctrl+S can write the model file plus every collection file. */
function scheduleSidecarSync() {
	if (sync_timer) return;
	sync_timer = setTimeout(() => {
		sync_timer = null;
		try {
			syncAllSidecars();
		} catch (error) {
			fail('sidecar sync failed', error);
		}
	}, 0);
}

function syncAllSidecars() {
	if (!bridgeEnabled() || typeof Project === 'undefined' || !Project) return;
	if (!getFS(true)) return;
	for (const texture of Texture.all.slice()) {
		try {
			syncSidecarForTexture(texture);
		} catch (error) {
			fail('could not sync layers for "' + (texture && texture.name) + '"', error);
		}
	}
}

/**
 * Whether this session put the texture in the state it is in, and so may rewrite or remove
 * its sidecar. 'applied' means we restored the stack; 'absent' means there was nothing to
 * restore. Every other state - 'external', 'checking', 'pending', 'skipped', or no state at
 * all - means the stack on disk is somebody else's, either because the user kept the flat
 * texture, or because we could not read it, or because we never got that far.
 */
function sidecarIsOurs(texture) {
	const state = texture && texture.__delta_layers_state;
	return state === 'applied' || state === 'absent';
}

/** Said once per texture, because an automatic save is not a good place to nag. */
function announceUnownedSidecar(texture) {
	if (texture.__delta_layers_unowned_announced) return;
	texture.__delta_layers_unowned_announced = true;
	if (typeof Blockbench === 'undefined') return;
	if (Blockbench.showQuickMessage) {
		Blockbench.showQuickMessage('Layers for ' + texture.name + ' were not saved', 2500);
	}
	if (!Blockbench.showMessageBox) return;
	Blockbench.showMessageBox({
		title: 'Layers were not saved',
		icon: 'layers',
		message: '**' + texture.name + '** already has a saved layer stack that was not restored '
			+ 'this session, so saving the layers you have now would have replaced it.\n\n'
			+ 'The stack on disk has been left alone. Nothing you have painted is lost from the '
			+ 'project, but it is not in the sidecar either.\n\n'
			+ 'To take the stack on disk, use **Reload Delta Layers From Disk** on the texture. '
			+ 'To replace it with what you have now, use **Save Delta Layers Now**. Both are in '
			+ 'the texture\'s right-click menu.',
		buttons: ['OK'],
	});
}

function syncSidecarForTexture(texture) {
	const fs = getFS();
	if (!fs || !texture || !texture.path || !PathModule.isAbsolute(texture.path)) return;
	// No flat PNG on disk yet (texture never saved) - there is nothing to key the
	// staleness hash to, and no directory we can be confident about.
	if (!fs.existsSync(texture.path)) return;

	const paths = sidecarPathsFor(texture);
	const temporary = texture.flags && texture.flags.has && texture.flags.has('temporary_layers');
	const worth_saving = texture.layers_enabled && texture.layers.length > 0 && !temporary;

	if (worth_saving) {
		// The delete branch below refuses to touch a sidecar this session never applied,
		// on the grounds that it is not ours. The write has to refuse for exactly the same
		// reason, and used not to: writeSidecar rebuilds the index from the live layers and
		// then sweeps every layer PNG that is not in it. So a save while holding a stack we
		// never restored did not just shelve the old one, it deleted it.
		//
		// That is how "Keep the file as it is", whose own text promises the saved layers
		// stay on disk untouched, ended with them gone: keep the flat texture, turn layers
		// on, add one, save. Same from every other state we did not apply from - file access
		// refused, the readiness timeout, a sidecar we could not parse.
		//
		// Saving from the texture's own menu still writes, because that is someone asking
		// for it on purpose rather than a save doing it behind their back.
		if (!sidecarIsOurs(texture) && fs.existsSync(paths.json)) {
			warn('not saving layers for "' + texture.name + '": its sidecar was never applied '
				+ 'this session (' + (texture.__delta_layers_state || 'unknown') + '), so writing '
				+ 'over it would delete the stack that is on disk. Use Save Delta Layers Now from '
				+ 'the texture menu to overwrite it deliberately.');
			announceUnownedSidecar(texture);
			return;
		}
		writeSidecar(texture, paths);
		return;
	}

	// The stack is gone (merged down, or layers switched off). The old sidecar would be
	// reapplied on a future load, so it has to go - but only if we are the ones who put
	// this texture in its current state. If our load pass never ran or bailed out (file
	// access denied, layer PNGs missing, user kept an external edit), the sidecar is not
	// ours to delete.
	if (!fs.existsSync(paths.json)) return;
	if (sidecarIsOurs(texture)) {
		log('layers no longer present on "' + texture.name + '" - removing its sidecar');
		stopLayerWatcher(texture);
		removeSidecar(paths);
		texture.__delta_layers_state = 'absent';
	} else {
		warn('"' + texture.name + '" has a layer sidecar that was never applied this session - '
			+ 'leaving it alone rather than overwriting or deleting it');
	}
}

/**
 * Anything the previous sidecar knew about that this Blockbench cannot represent gets
 * re-emitted unchanged instead of being dropped. That is what lets you group layers in
 * 5.2, work on the same model in 5.1 where groups do not exist, save there as often as
 * you like, and still find your groups intact when you go back to 5.2.
 *
 * A missing plain layer is NOT carried: that one really was deleted by the user.
 */
function carryForwardMissingItems(entries, previous, live_ids, written_files) {
	if (!previous || !(previous.layers instanceof Array)) return;

	const missing = previous.layers.filter((entry) => {
		if (!entry || typeof entry.id !== 'string' || live_ids.has(entry.id)) return false;
		const type = entry.type || 'layer';
		if (type === 'layer_group') return !groupsSupported();
		return type !== 'layer'; // a kind we could not have created here either
	});
	if (!missing.length) return;

	function place(entry, index) {
		const copy = Object.assign({}, entry);
		if (index === -1) entries.push(copy);
		else entries.splice(index, 0, copy);
		// keep its image, if it has one, safe from the orphan sweep
		if (typeof copy.file === 'string') written_files.add(PathModule.basename(copy.file));
	}

	// Put each item back just above the last thing that still claims it as a parent, the
	// same way Blockbench itself inserts a new group. Repeat so nested groups settle once
	// their children have been placed. solveLayerOrder() normalises it all on load anyway.
	let remaining = missing.slice();
	while (remaining.length) {
		const deferred = [];
		let placed_any = false;
		for (const entry of remaining) {
			let last_child = -1;
			for (let i = 0; i < entries.length; i++) {
				if (entries[i].parent === entry.id) last_child = i;
			}
			if (last_child === -1) {
				deferred.push(entry);
				continue;
			}
			place(entry, last_child + 1);
			placed_any = true;
		}
		if (!placed_any) {
			// Nothing left has surviving children. Keep them anyway, at the top.
			for (const entry of deferred) place(entry, -1);
			break;
		}
		remaining = deferred;
	}
	log('carried ' + plural(missing.length, 'item')
		+ ' forward that this version of Blockbench cannot represent');
}

function writeSidecar(texture, paths, options) {
	const fs = getFS();
	if (!fs) return;

	// What is already on disk, so untouched layers can be left exactly as they are.
	const previous_by_id = {};
	const previous = readSidecarQuietly(paths);
	if (previous && previous.layers instanceof Array) {
		for (const entry of previous.layers) {
			if (entry && typeof entry.id === 'string') previous_by_id[entry.id] = entry;
		}
	}

	// A sidecar written by a newer version of this plugin may hold things this copy has no
	// idea about. Refuse rather than flatten it into something lossy.
	if (previous && typeof previous.version === 'number' && previous.version > SIDECAR_VERSION) {
		warn('"' + texture.name + '" has a sidecar from a newer version of this plugin (v'
			+ previous.version + ') - not overwriting it. Update the plugin.');
		return;
	}

	fs.mkdirSync(paths.layers_dir, { recursive: true });
	suppress_watch_until = Date.now() + 500; // our own writes must not look like outside edits

	const written_files = new Set();
	const layer_entries = [];
	const live_ids = new Set();
	let files_written = 0;
	// Layers whose PNG on disk is not the one we wrote, so somebody else has been at it.
	const kept_outside = [];
	const overwrite_outside = !!(options && options.overwrite_outside_edits);

	texture.layers.forEach((layer, index) => {
		live_ids.add(layer.uuid);
		const previous_for_item = previous_by_id[layer.uuid];
		// Where a version understands nesting, its live state is the truth - including a
		// parent the user just cleared. Only fall back to the last save on a version that
		// has no parent_uuid at all, which is what keeps a group alive through an edit in
		// 5.1. Getting this wrong resurrects parents the user deliberately removed.
		const parent = groupsSupported()
			? (layer.parent_uuid || null)
			: (layer.parent_uuid || (previous_for_item && previous_for_item.parent) || null);

		if (isLayerGroup(layer)) {
			layer_entries.push({
				type: 'layer_group',
				id: layer.uuid,
				name: layer.name,
				parent,
				folded: layer.folded === true,
				visible: layer.visible !== false,
				order: index,
			});
			return;
		}

		if (!isPaintableLayer(layer)) {
			// Some future layer kind we cannot serialise. Keep whatever the last save knew
			// about it instead of quietly losing it.
			if (previous_for_item) {
				layer_entries.push(Object.assign({}, previous_for_item, { order: index, parent }));
				if (typeof previous_for_item.file === 'string') {
					written_files.add(PathModule.basename(previous_for_item.file));
				}
			} else {
				warn('skipping "' + layer.name + '": not a layer type this plugin understands');
			}
			return;
		}

		const file_name = layerFileName(layer.name, layer.uuid);
		const file_path = PathModule.join(paths.layers_dir, file_name);
		const relative_file = paths.base + '.layers/' + file_name;
		const previous_entry = previous_by_id[layer.uuid];
		const pixel_hash = hashLayerPixels(layer);

		// The layer PNGs are an interchange surface - the README tells people to open them
		// in Photoshop or Aseprite - so the file on disk is only ours while it still holds
		// the bytes we wrote. This used to be taken on trust: the file was compared against
		// what the index recorded and what we remembered writing, but never against itself,
		// so an edit made in another program was overwritten without anyone looking.
		//
		// previous_entry.hash is what the index recorded. hashBase64 and hashFile are the
		// same digest over the same bytes, so the two compare directly. It costs one read
		// of a small PNG per layer, next to the canvas read hashLayerPixels already does.
		//
		// Normally the watcher has pulled an outside edit into the layer already and the
		// two agree by now. This is for when it has not: the watch setting was off, or the
		// watcher never installed, or the edit landed while the project was closed.
		const file_exists = fs.existsSync(file_path);
		const recorded = !!(previous_entry && previous_entry.hash);
		const on_disk = (recorded && file_exists) ? hashFile(file_path) : null;
		const file_is_ours = !!(on_disk && on_disk === previous_entry.hash);
		const changed_outside = !!(recorded && file_exists && on_disk && !file_is_ours);

		// Nothing about this layer's image changed since we last wrote it, and the file is
		// still where we put it with the bytes we put in it. Skip the PNG encode and the
		// write entirely.
		//
		// Never on a forced write. Asking to overwrite the outside edits means writing the
		// files from what is in Blockbench, and by then the index already records the
		// hashes of the files we left alone - so every layer would look untouched.
		const untouched = !overwrite_outside && !!(pixel_hash
			&& layer.__eg_pixel_hash === pixel_hash
			&& previous_entry
			&& previous_entry.file === relative_file
			&& previous_entry.hash === layer.__eg_file_hash
			&& file_is_ours);

		let file_hash;
		if (untouched) {
			file_hash = previous_entry.hash;
		} else if (changed_outside && !overwrite_outside) {
			// Leave the file alone and record what is actually in it, so the index
			// describes the files that exist rather than the ones we meant to write.
			//
			// Recording it is deliberate: a layer nobody touches again is then quietly
			// skipped on later saves instead of asking every time, and painting on that
			// layer afterwards does overwrite the file - by then the user has been told
			// and has chosen to go on working on it here.
			file_hash = on_disk;
			kept_outside.push({ name: layer.name, hash: on_disk });
		} else {
			// getSaveCopy() gives {name, offset, scale, opacity, visible, blend_mode,
			// width, height, data_url} - a ready-made snapshot of exactly what we need.
			const base64 = layer.getSaveCopy().data_url.split(',')[1];
			file_hash = hashBase64(base64);
			fs.writeFileSync(file_path, base64, { encoding: 'base64' });
			files_written++;
		}

		layer.__eg_pixel_hash = pixel_hash;
		layer.__eg_file_hash = file_hash;
		layer.__eg_file_name = file_name;
		written_files.add(file_name);

		layer_entries.push({
			type: 'layer',
			id: layer.uuid,
			name: layer.name,
			parent,
			file: relative_file, // always forward slashes, resolved on load
			// order 0 is the BOTTOM layer, ascending toward the top - the same direction as
			// texture.layers itself (mergeDown() treats the lower index as the layer
			// underneath). Do not reverse this on either side.
			order: index,
			offset: layer.offset.slice(),
			scale: layer.scale.slice(),
			opacity: layer.opacity, // 0-100, Blockbench's own range. Do not normalize to 0-1.
			visible: layer.visible,
			blend_mode: layer.blend_mode,
			width: layer.width,
			height: layer.height,
			hash: file_hash, // lets the next save skip this file, and spots outside edits
		});
	});

	carryForwardMissingItems(layer_entries, previous, live_ids, written_files);
	layer_entries.forEach((entry, index) => { entry.order = index; });

	pruneOrphanLayerFiles(paths.layers_dir, written_files);

	const sidecar = {
		version: SIDECAR_VERSION,
		texture_file: PathModule.basename(texture.path),
		generated_by: {
			plugin: PLUGIN_ID,
			plugin_version: PLUGIN_VERSION,
			blockbench_version: (typeof Blockbench !== 'undefined' && Blockbench.version) || null,
		},
		canvas: { width: texture.width, height: texture.height },
		source_hash: hashFile(texture.path),
		active_layer: (texture.selected_layer && texture.selected_layer.uuid) || null,
		layers: layer_entries,
	};

	// Don't rewrite an identical file - that only churns timestamps and version control.
	const json = JSON.stringify(sidecar, null, 2);
	let json_changed = true;
	try {
		json_changed = !fs.existsSync(paths.json) || fs.readFileSync(paths.json, 'utf-8') !== json;
	} catch (error) { /* unreadable: write it */ }
	if (json_changed) fs.writeFileSync(paths.json, json, 'utf-8');

	texture.__delta_layers_state = 'applied';
	startLayerWatcher(texture, paths);

	if (kept_outside.length) {
		warn('kept the version on disk for ' + plural(kept_outside.length, 'layer') + ' of "'
			+ texture.name + '" that had been edited outside Blockbench: '
			+ kept_outside.map((item) => '"' + item.name + '"').join(', '));
		promptOutsideLayerEdits(texture, paths, kept_outside);
	}

	if (files_written || json_changed) {
		log('saved ' + plural(layer_entries.length, 'layer') + ' for "' + texture.name + '" ('
			+ files_written + ' image' + (files_written === 1 ? '' : 's') + ' rewritten'
			+ (json_changed ? '' : ', index unchanged') + ')');
	}
}

/**
 * Some of this texture's layer PNGs had been changed outside Blockbench, so they were left
 * alone rather than overwritten. Which means what is in the project and what is in those
 * files now disagree, and only the user can say which one is right.
 *
 * Same shape as promptStaleSidecar, which asks the same question about the flat texture.
 */
function promptOutsideLayerEdits(texture, paths, kept) {
	if (typeof Blockbench === 'undefined' || !Blockbench.showMessageBox) return;
	const names = kept.map((item) => '- ' + item.name).join('\n');
	Blockbench.showMessageBox({
		title: 'Layer files changed outside Blockbench',
		icon: 'layers',
		message: 'These layers of **' + texture.name + '** have been edited in another program '
			+ 'since Blockbench last wrote them:\n\n' + names + '\n\nThe files have been left as '
			+ 'they are, so this save did not overwrite that work. What is in Blockbench for those '
			+ 'layers is not on disk.',
		commands: {
			keep_files: {
				text: 'Keep the files on disk',
				icon: 'folder',
				description: 'Reload Delta Layers From Disk on this texture brings them into the project.',
			},
			overwrite: {
				text: 'Overwrite them with what is in Blockbench',
				icon: 'save',
				description: 'Writes the layers as they are here. The outside edits are lost.',
			},
		},
		buttons: ['Cancel'],
		cancel: 0,
	}, (command) => {
		if (command !== 'overwrite') {
			log('kept the layer files on disk for "' + texture.name + '"');
			return;
		}
		try {
			writeSidecar(texture, paths, { overwrite_outside_edits: true });
			if (Blockbench.showQuickMessage) {
				Blockbench.showQuickMessage('Overwrote ' + plural(kept.length, 'layer file'), 1600);
			}
		} catch (error) {
			fail('could not overwrite the layer files', error);
		}
	});
}

/** Layer files left over from a previous save (renamed or deleted layers). */
function pruneOrphanLayerFiles(layers_dir, keep) {
	const fs = getFS();
	if (!fs) return;
	try {
		for (const file_name of fs.readdirSync(layers_dir)) {
			if (!/\.png$/i.test(file_name) || keep.has(file_name)) continue;
			fs.unlinkSync(PathModule.join(layers_dir, file_name));
		}
	} catch (error) {
		warn('could not clean up old layer files in ' + layers_dir, error);
	}
}

function removeSidecar(paths) {
	const fs = getFS();
	if (!fs) return;
	try {
		if (fs.existsSync(paths.json)) fs.unlinkSync(paths.json);
	} catch (error) {
		warn('could not remove ' + paths.json, error);
	}
	try {
		if (!fs.existsSync(paths.layers_dir)) return;
		for (const file_name of fs.readdirSync(paths.layers_dir)) {
			if (/\.png$/i.test(file_name)) {
				fs.unlinkSync(PathModule.join(paths.layers_dir, file_name));
			}
		}
		// Only remove the folder if nothing unexpected is left in it.
		if (fs.readdirSync(paths.layers_dir).length === 0) fs.rmdirSync(paths.layers_dir);
	} catch (error) {
		warn('could not remove ' + paths.layers_dir, error);
	}
}

// ---------------------------------------------------------------------------
// LOAD: rebuild the stack
// ---------------------------------------------------------------------------

/**
 * A texture created from a path populates its canvas asynchronously (img.onload sets
 * width/height and draws). Compositing or hashing before that is meaningless, so wait.
 */
function whenTextureReady(texture, callback, timeout_ms) {
	const deadline = Date.now() + (timeout_ms || 10000);
	(function check() {
		if (!texture.path) return;
		if (texture.width > 0 && texture.height > 0 && texture.img && texture.img.complete) {
			callback();
			return;
		}
		if (Date.now() > deadline) {
			warn('gave up waiting for "' + texture.name + '" to load; layers not restored');
			return;
		}
		setTimeout(check, 30);
	})();
}

function considerTexture(texture) {
	if (!bridgeEnabled() || !texture || texture.__delta_layers_state) return;
	if (!texture.path || !PathModule.isAbsolute(texture.path)) return;
	// Somebody else already owns this stack - a .bbmodel carries its layers itself.
	if (texture.layers_enabled && texture.layers.length) {
		texture.__delta_layers_state = 'external';
		return;
	}
	if (!projectUsesBridge()) return;

	texture.__delta_layers_state = 'checking';
	// Deferred on purpose: 'add_texture' fires in the middle of the codec's own parse()
	// run, and we would rather not ask for file access - or touch the texture - while
	// that is still going.
	setTimeout(() => {
		try {
			checkTextureForSidecar(texture);
		} catch (error) {
			fail('could not check layers for "' + texture.name + '"', error);
			texture.__delta_layers_state = 'skipped';
		}
	}, 0);
}

function checkTextureForSidecar(texture) {
	const fs = getFS(true);
	if (!fs) {
		texture.__delta_layers_state = 'skipped';
		return;
	}
	const paths = sidecarPathsFor(texture);
	if (!fs.existsSync(paths.json)) {
		texture.__delta_layers_state = 'absent';
		return;
	}
	texture.__delta_layers_state = 'pending';
	whenTextureReady(texture, () => restoreFromSidecar(texture, paths));
}

function considerAllTextures() {
	if (typeof Project === 'undefined' || !Project) return;
	for (const texture of Texture.all.slice()) {
		try {
			considerTexture(texture);
		} catch (error) {
			fail('could not check layers for "' + (texture && texture.name) + '"', error);
		}
	}
}

/** Plain read, no warnings and no version gate - used by the save path. */
function readSidecarQuietly(paths) {
	const fs = getFS();
	if (!fs) return null;
	try {
		if (!fs.existsSync(paths.json)) return null;
		return JSON.parse(fs.readFileSync(paths.json, 'utf-8'));
	} catch (error) {
		return null;
	}
}

function readSidecar(paths) {
	const fs = getFS();
	if (!fs) return null;
	let sidecar;
	try {
		sidecar = JSON.parse(fs.readFileSync(paths.json, 'utf-8'));
	} catch (error) {
		warn('could not read ' + paths.json, error);
		return null;
	}
	if (!sidecar || !(sidecar.layers instanceof Array) || !sidecar.layers.length) {
		warn(paths.json + ' has no layers in it');
		return null;
	}
	if (typeof sidecar.version === 'number' && sidecar.version > SIDECAR_VERSION) {
		warn(paths.json + ' was written by a newer version of this plugin (v'
			+ sidecar.version + ') - not touching it');
		return null;
	}
	return sidecar;
}

function restoreFromSidecar(texture, paths, force) {
	const sidecar = readSidecar(paths);
	if (!sidecar) {
		texture.__delta_layers_state = 'skipped';
		return;
	}

	const stored_hash = sidecar.source_hash;
	let current_hash = null;
	if (stored_hash && !force) {
		const algo = String(stored_hash).includes(':') ? String(stored_hash).split(':')[0] : 'sha1';
		current_hash = hashFile(texture.path, algo);
	}

	// Only treat it as stale if we actually managed to compute a comparable hash.
	if (stored_hash && !force && current_hash && current_hash !== stored_hash) {
		promptStaleSidecar(texture, sidecar, paths);
		return;
	}

	applyLayers(texture, sidecar, paths, false);
}

/**
 * The flat PNG changed on disk since the sidecar was written - someone painted on it in
 * another program. Reapplying the old stack would silently discard that, so ask.
 */
function promptStaleSidecar(texture, sidecar, paths) {
	texture.__delta_layers_state = 'skipped';
	Blockbench.showMessageBox({
		title: 'Texture changed outside Blockbench',
		icon: 'layers',
		message: '**' + PathModule.basename(texture.path) + '** has been edited since its layer stack '
			+ 'was saved (' + sidecar.layers.length + ' layers). Restoring the stack would replace '
			+ 'what is currently in the file.',
		commands: {
			keep_flat: {
				text: 'Keep the file as it is',
				icon: 'image',
				description: 'Work on the flat texture. The saved layers stay on disk, untouched.',
			},
			restore_and_keep: {
				text: 'Restore layers, keep the edited image on top',
				icon: 'layers',
				description: 'Nothing is lost: the outside edit comes back as an extra top layer you can merge or delete.',
			},
			restore: {
				text: 'Restore layers, discard the outside edit',
				icon: 'restore_page',
				description: 'Rebuild the stack exactly as it was saved.',
			},
		},
		buttons: ['Cancel'],
		cancel: 0,
	}, (command) => {
		if (command === 'restore') {
			applyLayers(texture, sidecar, paths, false);
		} else if (command === 'restore_and_keep') {
			applyLayers(texture, sidecar, paths, true);
		} else {
			log('kept the flat texture for "' + texture.name + '"; its sidecar was left untouched');
		}
	});
}

/** A sidecar entry becomes either a layer (async, needs its PNG) or a group (instant). */
function buildItem(texture, entry, dir) {
	if (entry && entry.type === 'layer_group') {
		// On 5.1 there is no such class. Skipping the group leaves its children at the top
		// level, which is the best that version can do, and the group survives on disk.
		if (!groupsSupported()) return null;
		try {
			return new TextureLayerGroup({
				name: typeof entry.name === 'string' ? entry.name : 'Layer Group',
				folded: entry.folded === true,
				visible: entry.visible !== false,
			}, texture, typeof entry.id === 'string' ? entry.id : undefined);
		} catch (error) {
			fail('could not rebuild layer group "' + (entry.name || entry.id) + '"', error);
			return null;
		}
	}
	return buildLayer(texture, entry, dir);
}

function buildLayer(texture, entry, dir) {
	return new Promise((resolve) => {
		const fs = getFS();
		if (!fs || !entry || typeof entry.file !== 'string') return resolve(null);

		const file_path = PathModule.resolve(dir, entry.file);
		// A hand-edited sidecar must not be able to point us outside the texture's folder.
		if (!PathModule.resolve(file_path).startsWith(PathModule.resolve(dir))) {
			warn('layer path escapes the texture folder, skipping: ' + entry.file);
			return resolve(null);
		}

		let data_url;
		let base64;
		try {
			if (!fs.existsSync(file_path)) throw new Error('file does not exist');
			base64 = fs.readFileSync(file_path, { encoding: 'base64' });
			data_url = 'data:image/png;base64,' + base64;
		} catch (error) {
			warn('layer image missing, skipping layer "' + (entry.name || entry.id) + '": ' + entry.file);
			return resolve(null);
		}

		const image = new Image();
		image.onload = () => {
			try {
				const layer = new TextureLayer({
					name: typeof entry.name === 'string' ? entry.name : 'layer',
					offset: validVector2(entry.offset, [0, 0]),
					scale: validVector2(entry.scale, [1, 1]),
					opacity: typeof entry.opacity === 'number'
						? Math.clamp(entry.opacity, 0, 100)
						: 100,
					visible: entry.visible !== false,
					blend_mode: validBlendMode(entry.blend_mode),
				}, texture, typeof entry.id === 'string' ? entry.id : undefined);

				layer.setSize(image.naturalWidth, image.naturalHeight);
				layer.ctx.drawImage(image, 0, 0);

				// Remember which file this layer came from and what was in it, so the watcher
				// can tell an outside edit from our own write, and so the next save can skip
				// re-encoding a layer nobody touched.
				layer.__eg_file_name = PathModule.basename(file_path);
				layer.__eg_file_hash = hashBase64(base64);
				layer.__eg_pixel_hash = hashLayerPixels(layer);
				// Did someone edit this file since the sidecar recorded it?
				layer.__eg_file_changed = !!(entry.hash && layer.__eg_file_hash && entry.hash !== layer.__eg_file_hash);

				resolve(layer);
			} catch (error) {
				fail('could not rebuild layer "' + (entry.name || entry.id) + '"', error);
				resolve(null);
			}
		};
		image.onerror = () => {
			warn('layer image could not be decoded, skipping: ' + entry.file);
			resolve(null);
		};
		image.src = data_url;
	});
}

function applyLayers(texture, sidecar, paths, keep_current_as_top_layer) {
	// Snapshot the flat image first if we are going to preserve it - installing the
	// stack overwrites texture.canvas.
	const flat_copy = keep_current_as_top_layer ? copyCanvas(texture.canvas) : null;

	// order 0 = bottom. Sort defensively in case the file was hand-edited or written
	// by something that emitted them out of order.
	const entries = sidecar.layers.slice().sort((a, b) => (a.order || 0) - (b.order || 0));

	Promise.all(entries.map((entry) => buildItem(texture, entry, paths.dir)))
		.then((built) => {
			const layers = built.filter(Boolean);
			if (!layers.length) {
				warn('none of the layers for "' + texture.name + '" could be restored');
				texture.__delta_layers_state = 'skipped';
				return;
			}

			// Only count a genuinely missing image as missing. A group we deliberately
			// skipped because this Blockbench has no groups is not a failure.
			const dropped = built.reduce((count, item, index) => {
				if (item) return count;
				return entries[index].type === 'layer_group' ? count : count + 1;
			}, 0);
			if (dropped) {
				Blockbench.showQuickMessage(
					plural(dropped, 'layer file') + ' missing for ' + texture.name, 2500);
			}

			// Everything exists now, so nesting can be hooked up. Parents pointing at a group
			// we skipped are left unset, which puts those layers at the top level.
			const by_id = {};
			built.forEach((item, index) => { if (item) by_id[entries[index].id] = item; });
			built.forEach((item, index) => {
				if (!item) return;
				const parent_id = entries[index].parent;
				if (parent_id && by_id[parent_id]) item.parent_uuid = parent_id;
			});

			if (flat_copy) {
				const top = new TextureLayer({ name: 'Edited outside Blockbench' }, texture);
				top.setSize(flat_copy.width, flat_copy.height);
				top.ctx.drawImage(flat_copy, 0, 0);
				layers.push(top);
			}

			// Layer images edited outside Blockbench while the project was closed. The stack
			// is correct, but the flat PNG next to it is not - it still shows the old
			// composite, so the texture has to count as dirty and be re-exported on save.
			const changed = layers.filter((layer) => layer.__eg_file_changed);
			installLayers(texture, layers, sidecar, changed.length > 0);
			if (changed.length) {
				log('layer images changed on disk since the last save: '
					+ changed.map((layer) => layer.name).join(', '));
				Blockbench.showQuickMessage(
					plural(changed.length, 'layer') + ' changed on disk - save to update ' + texture.name, 3000);
			}
		})
		.catch((error) => {
			fail('could not restore layers for "' + texture.name + '"', error);
			texture.__delta_layers_state = 'skipped';
		});
}

function installLayers(texture, layers, sidecar, force_dirty) {
	// Restoring a saved state is not an edit: don't let it mark the texture or the
	// project as having unsaved changes.
	const texture_was_saved = texture.saved;
	const project_was_saved = (typeof Project !== 'undefined' && Project) ? Project.saved : undefined;

	texture.layers_enabled = true;
	// Mutate the existing array rather than replacing it - the Layers panel is bound to
	// this exact array instance.
	texture.layers.splice(0, texture.layers.length, ...layers);

	// 5.2 keeps the hierarchy in a flat array and derives render order from parent_uuid.
	// Let Blockbench canonicalise it rather than trusting our insertion positions.
	if (typeof TextureLayerItem !== 'undefined' && typeof TextureLayerItem.solveLayerOrder === 'function') {
		try {
			const solved = TextureLayerItem.solveLayerOrder(texture.layers);
			if (solved && solved.length === texture.layers.length) {
				texture.layers.splice(0, texture.layers.length, ...solved);
			}
		} catch (error) {
			warn('could not normalise layer order, keeping the saved order', error);
		}
	}

	let active = sidecar.active_layer && texture.layers.find((layer) => layer.uuid === sidecar.active_layer);
	if (!active) active = texture.layers[texture.layers.length - 1];
	texture.selected_layer = active || null;

	// Composites bottom-to-top with the right blend modes and refreshes the material -
	// Blockbench does all of that, we just ask for it.
	texture.updateLayerChanges(true);
	refreshMaterialGroup(texture);

	if (typeof Texture !== 'undefined' && Texture.selected === texture) {
		if (active && typeof active.select === 'function') {
			try { active.select(); } catch (error) { /* UI not ready yet, harmless */ }
		}
		if (typeof Panels !== 'undefined' && Panels.layers && Panels.layers.inside_vue) {
			Panels.layers.inside_vue.layers = texture.layers;
		}
	}

	texture.saved = force_dirty ? false : texture_was_saved;
	if (project_was_saved !== undefined) Project.saved = project_was_saved;
	texture.__delta_layers_state = 'applied';
	startLayerWatcher(texture, sidecarPathsFor(texture));

	if (typeof updateInterfacePanels === 'function') updateInterfacePanels();
	if (typeof BARS !== 'undefined' && BARS.updateConditions) BARS.updateConditions();

	log('restored ' + plural(layers.length, 'layer') + ' on "' + texture.name + '"');
	Blockbench.showQuickMessage('Restored ' + plural(layers.length, 'layer') + ' on ' + texture.name, 1600);
}

// ---------------------------------------------------------------------------
// WATCH: pick up layer PNGs edited outside Blockbench
// ---------------------------------------------------------------------------

/*
 * Blockbench watches a normal texture's file and reloads it when an external editor
 * saves over it - but it gives up the moment layers are enabled (textures.js:
 * "if (scope.layers_enabled || scope.internal) return"). Since the layer images are the
 * files you would actually open in Photoshop or Aseprite, this does the same job for
 * them: one watcher per <texture>.layers/ folder, reloading just the layer whose file
 * changed.
 */
function startLayerWatcher(texture, paths) {
	stopLayerWatcher(texture);
	if (!watchingEnabled()) return;
	const fs = getFS();
	if (!fs || !fs.existsSync(paths.layers_dir)) return;

	const timers = {};
	let watcher;
	try {
		// Blockbench's scoped fs declares watch(path, options, listener) with fixed arity,
		// so unlike plain Node the options argument is NOT optional here.
		watcher = fs.watch(paths.layers_dir, {}, (event_type, file_name) => {
			if (!file_name || !/\.png$/i.test(file_name)) return;
			if (Date.now() < suppress_watch_until) return; // our own save, still in flight
			if (timers[file_name]) clearTimeout(timers[file_name]);
			// Editors often write in bursts, or to a temp file and rename. Settle first.
			timers[file_name] = setTimeout(() => {
				delete timers[file_name];
				try {
					onLayerFileChanged(texture, paths, file_name);
				} catch (error) {
					fail('could not reload layer file "' + file_name + '"', error);
				}
			}, 120);
		});
	} catch (error) {
		warn('could not watch ' + paths.layers_dir, error);
		return;
	}

	const record = { texture, watcher, dir: paths.layers_dir, timers };
	texture.__eg_layer_watcher = record;
	layer_watchers.push(record);
}

function stopLayerWatcher(texture) {
	const record = texture && texture.__eg_layer_watcher;
	if (!record) return;
	closeWatcherRecord(record);
	const index = layer_watchers.indexOf(record);
	if (index !== -1) layer_watchers.splice(index, 1);
	delete texture.__eg_layer_watcher;
}

function closeWatcherRecord(record) {
	try {
		for (const key in record.timers) clearTimeout(record.timers[key]);
		if (record.watcher && typeof record.watcher.close === 'function') record.watcher.close();
	} catch (error) {
		warn('could not close a layer watcher', error);
	}
}

function stopAllLayerWatchers() {
	for (const record of layer_watchers.slice()) {
		closeWatcherRecord(record);
		if (record.texture) delete record.texture.__eg_layer_watcher;
	}
	layer_watchers = [];
}

function onLayerFileChanged(texture, paths, file_name) {
	const project = projectHolding(texture);
	if (!project) {
		// The texture is gone - project closed, or the texture was deleted.
		stopLayerWatcher(texture);
		return;
	}

	const layer = texture.layers.find((candidate) => candidate.__eg_file_name === file_name);
	if (!layer) return; // a temp file, or a layer that no longer exists - not ours to touch

	const fs = getFS();
	const file_path = PathModule.join(paths.layers_dir, file_name);
	if (!fs || !fs.existsSync(file_path)) {
		warn('layer file "' + file_name + '" disappeared - keeping the layer as it is in Blockbench');
		return;
	}

	const hash = hashFile(file_path);
	if (hash && hash === layer.__eg_file_hash) return; // same bytes we wrote: nothing to do

	// Applying to a background project would composite against the wrong Format/UVEditor,
	// which is why Blockbench defers its own reloads the same way.
	if (typeof Project !== 'undefined' && project !== Project) {
		if (typeof project.whenNextOpen === 'function') {
			project.whenNextOpen(() => reloadLayerFromFile(texture, layer, file_path, hash));
		}
		return;
	}
	reloadLayerFromFile(texture, layer, file_path, hash);
}

function reloadLayerFromFile(texture, layer, file_path, hash) {
	const fs = getFS();
	if (!fs) return;
	let data_url;
	try {
		data_url = 'data:image/png;base64,' + fs.readFileSync(file_path, { encoding: 'base64' });
	} catch (error) {
		warn('could not read ' + file_path, error);
		return;
	}

	const image = new Image();
	image.onload = () => {
		try {
			// setSize clears the canvas on its own, so no leftovers from the old image.
			layer.setSize(image.naturalWidth, image.naturalHeight);
			layer.ctx.drawImage(image, 0, 0);
			layer.__eg_file_hash = hash || null;
			layer.__eg_pixel_hash = hashLayerPixels(layer);

			texture.updateLayerChanges(true);
			refreshMaterialGroup(texture);
			// The flat PNG on disk no longer matches the stack, so it has to be re-exported.
			texture.saved = false;

			if (typeof updateInterfacePanels === 'function') updateInterfacePanels();
			if (typeof UVEditor !== 'undefined' && UVEditor.vue && UVEditor.vue.$forceUpdate) {
				UVEditor.vue.$forceUpdate();
			}
			log('reloaded layer "' + layer.name + '" from disk');
			Blockbench.showQuickMessage('Reloaded layer "' + layer.name + '"', 1600);
		} catch (error) {
			fail('could not apply the reloaded image to layer "' + layer.name + '"', error);
		}
	};
	image.onerror = () => warn('layer file could not be decoded: ' + file_path);
	image.src = data_url;
}

// ---------------------------------------------------------------------------
// codec hooks
// ---------------------------------------------------------------------------

/**
 * Wrap write() and parse() on every codec that needs the bridge.
 *
 * write() is the one place every save path funnels through - Ctrl+S, "Export", and
 * per-collection/attachment writes all call it. parse() runs right after a model file
 * is read, which for the Hytale codec is also where textures get discovered, so it is
 * the moment to look for sidecars. (Note the base Codec dispatches a 'compile' event
 * but the blockymodel codec overrides compile() without dispatching, so that event is
 * not usable here.)
 *
 * Both wrappers are idempotent, so plugin load order does not matter: we re-run this
 * whenever there is a cheap excuse to.
 */
function wrapCodec(codec) {
	// The marker deliberately does NOT include the plugin id: if an older copy of this
	// plugin is still loaded under its previous name, we want it to stop us wrapping the
	// same codec twice rather than both of us writing the same sidecars on every save.
	if (!codec || codec.__delta_layers_wrapped || !codecNeedsLayerBridge(codec)) return;
	if (typeof codec.write !== 'function' || typeof codec.parse !== 'function') return;

	codec.__delta_layers_wrapped = true;
	codec.__delta_layers_write = codec.write;
	codec.__delta_layers_parse = codec.parse;
	wrapped_codecs.push(codec);

	const original_write = codec.write;
	codec.write = function (content, path) {
		const result = original_write.apply(this, arguments);
		try {
			// Textures are written by saveTextures() before the model file, synchronously,
			// so by now the flat PNG on disk is current and safe to hash.
			if (bridgeEnabled() && isModelSaveCodec(this)) scheduleSidecarSync();
		} catch (error) {
			fail('save hook failed', error);
		}
		return result;
	};

	const original_parse = codec.parse;
	codec.parse = function (model, path, args) {
		const result = original_parse.apply(this, arguments);
		try {
			if (bridgeEnabled()) {
				// The Hytale codec reuses an existing Texture object when one already has the
				// same path, in which case no 'add_texture' event fires - so sweep here too.
				considerAllTextures();
			}
		} catch (error) {
			fail('load hook failed', error);
		}
		return result;
	};
}

function wrapAllKnownCodecs() {
	if (typeof Codecs === 'undefined') return;
	for (const id in Codecs) {
		try {
			wrapCodec(Codecs[id]);
		} catch (error) {
			fail('could not hook codec "' + id + '"', error);
		}
	}
}

function unwrapAllCodecs() {
	for (const codec of wrapped_codecs) {
		try {
			if (codec.__delta_layers_write) codec.write = codec.__delta_layers_write;
			if (codec.__delta_layers_parse) codec.parse = codec.__delta_layers_parse;
			delete codec.__delta_layers_write;
			delete codec.__delta_layers_parse;
			delete codec.__delta_layers_wrapped;
		} catch (error) {
			fail('could not unhook a codec', error);
		}
	}
	wrapped_codecs = [];
}

// ---------------------------------------------------------------------------
// manual actions (escape hatches)
// ---------------------------------------------------------------------------

function contextTexture(context) {
	return (context instanceof Texture) ? context : Texture.selected;
}

function setupActions() {
	const save_action = new Action('delta_layers_save', {
		name: 'Save Delta Layers Now',
		description: 'Write this texture\'s layer stack to its sidecar file straight away',
		icon: 'save',
		category: 'textures',
		condition: () => {
			if (typeof isApp !== 'undefined' && !isApp) return false;
			const texture = Texture.selected;
			return !!(texture && texture.path && texture.layers_enabled && texture.layers.length);
		},
		click(event, context) {
			const texture = contextTexture(context);
			if (!texture || !texture.path) return;
			if (!getFS(true)) return;
			try {
				writeSidecar(texture, sidecarPathsFor(texture));
				Blockbench.showQuickMessage('Saved ' + plural(texture.layers.length, 'layer'), 1600);
			} catch (error) {
				fail('could not write the sidecar', error);
				Blockbench.showQuickMessage('Could not save layers - see the console', 2500);
			}
		},
	});

	const reload_action = new Action('delta_layers_reload', {
		name: 'Reload Delta Layers From Disk',
		description: 'Rebuild this texture\'s layer stack from its sidecar file, ignoring the staleness check',
		icon: 'layers',
		category: 'textures',
		condition: () => {
			if (typeof isApp !== 'undefined' && !isApp) return false;
			const texture = Texture.selected;
			const fs = getFS(false);
			if (!texture || !texture.path || !fs) return false;
			try {
				return fs.existsSync(sidecarPathsFor(texture).json);
			} catch (error) {
				return false;
			}
		},
		click(event, context) {
			const texture = contextTexture(context);
			if (!texture || !texture.path || !getFS(true)) return;
			restoreFromSidecar(texture, sidecarPathsFor(texture), true);
		},
	});

	const forget_action = new Action('delta_layers_delete', {
		name: 'Delete Saved Delta Layers',
		description: 'Remove this texture\'s sidecar file and its per-layer images',
		icon: 'delete',
		category: 'textures',
		condition: () => {
			if (typeof isApp !== 'undefined' && !isApp) return false;
			const texture = Texture.selected;
			const fs = getFS(false);
			if (!texture || !texture.path || !fs) return false;
			try {
				return fs.existsSync(sidecarPathsFor(texture).json);
			} catch (error) {
				return false;
			}
		},
		click(event, context) {
			const texture = contextTexture(context);
			if (!texture || !texture.path || !getFS(true)) return;
			Blockbench.showMessageBox({
				title: 'Delete saved texture layers',
				message: 'Delete the layer sidecar and per-layer images for **' + texture.name + '**? '
					+ 'The texture itself and the layers currently open in Blockbench are not touched.',
				buttons: ['Delete', 'Cancel'],
				confirm: 0,
				cancel: 1,
			}, (button) => {
				if (button !== 0) return;
				removeSidecar(sidecarPathsFor(texture));
				texture.__delta_layers_state = 'absent';
				Blockbench.showQuickMessage('Deleted saved layers for ' + texture.name, 1600);
			});
		},
	});

	deletables.push(save_action, reload_action, forget_action);

	if (typeof Texture !== 'undefined' && Texture.prototype.menu && Texture.prototype.menu.addAction) {
		for (const action of [save_action, reload_action, forget_action]) {
			Texture.prototype.menu.addAction(action);
			menu_entries.push([Texture.prototype.menu, action]);
		}
	}
}

function removeMenuEntries() {
	for (const [menu, action] of menu_entries) {
		try {
			if (menu.structure instanceof Array) {
				const index = menu.structure.indexOf(action);
				if (index !== -1) menu.structure.splice(index, 1);
			}
		} catch (error) {
			fail('could not remove a menu entry', error);
		}
	}
	menu_entries = [];
}

// ---------------------------------------------------------------------------
// plugin registration
// ---------------------------------------------------------------------------

BBPlugin.register(PLUGIN_ID, {
	title: 'Delta Layers',
	author: 'Embody Games',
	description: 'Embody Games internal tool. Keeps texture layers (image, blend mode, opacity, '
		+ 'order) alive across saves for formats that do not store them natively, such as Hytale\'s '
		+ '.blockymodel, by writing a sidecar file next to each texture.',
	icon: PLUGIN_ICON,
	version: PLUGIN_VERSION,
	tags: ['Texturing', 'Hytale', 'Embody Games'],
	variant: 'desktop', // needs real filesystem access
	min_version: '5.0.5',
	// Adds a Changelog tab in the plugin browser. Blockbench reads it from
	// this.path.replace(/\w+\.js$/, 'changelog.json') for a file-loaded plugin, so
	// changelog.json has to sit in the SAME FOLDER as this file.
	has_changelog: true,
	onload() {
		new Setting(SETTING_ID, {
			name: 'Delta Layers: persist texture layers',
			description: 'Save each texture\'s layer stack to a sidecar file on export, and restore it on load, '
				+ 'for formats that cannot store layers themselves.',
			category: 'export',
			value: true,
		});
		deletables.push(settings[SETTING_ID]);

		new Setting(WATCH_SETTING_ID, {
			name: 'Delta Layers: reload layer images edited outside Blockbench',
			description: 'Watch each texture\'s .layers folder and reload a layer as soon as another '
				+ 'program saves over its PNG, the way Blockbench does for unlayered textures.',
			category: 'export',
			value: true,
			onChange(value) {
				if (value) {
					considerAllTextures();
				} else {
					stopAllLayerWatchers();
				}
			},
		});
		deletables.push(settings[WATCH_SETTING_ID]);

		wrapAllKnownCodecs();
		setupActions();

		// Cheap, idempotent re-wraps so plugin load order is a non-issue.
		deletables.push(Blockbench.on('quick_save_model', () => {
			wrapAllKnownCodecs();
			if (bridgeEnabled() && projectUsesBridge()) scheduleSidecarSync();
		}));
		deletables.push(Blockbench.on('select_project', () => {
			wrapAllKnownCodecs();
		}));

		// Catches textures added outside a model load too - dropped in by hand, or via the
		// Hytale plugin's "load textures from folder".
		deletables.push(Blockbench.on('add_texture', (data) => {
			if (!bridgeEnabled()) return;
			try {
				considerTexture(data && data.texture);
			} catch (error) {
				fail('could not check layers for a new texture', error);
			}
		}));

		log('ready');
	},
	onunload() {
		if (sync_timer) {
			clearTimeout(sync_timer);
			sync_timer = null;
		}
		stopAllLayerWatchers();
		unwrapAllCodecs();
		removeMenuEntries();
		for (const deletable of deletables) {
			try {
				if (deletable && typeof deletable.delete === 'function') deletable.delete();
			} catch (error) {
				fail('cleanup problem', error);
			}
		}
		deletables = [];
		native_fs = null;
		log('unloaded');
	},
});

})();
