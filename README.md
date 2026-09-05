# Delta Layers

Blockbench plugin. Keeps a texture's layer stack (per-layer image, blend mode, opacity, offset,
visibility, order, and groups) alive across a save and reload for model formats whose file has
no concept of layers, Hytale's `.blockymodel` above all. The model file is never touched. The
stack goes into a sidecar beside the texture PNG:

```
Knight.blockymodel
Texture.png                   <- the flat texture, unchanged, what the game reads
Texture.layers.json           <- the stack: type, parent, order, blend, opacity, hashes
Texture.layers/
  base-color_3f9a1b2c.png     <- one PNG per layer, editable in Photoshop or Aseprite
```

Desktop Blockbench only, 5.0.5 or newer. It needs real filesystem access. Layer groups (5.2)
are supported as of 1.3.0, and a stack made in 5.2 survives a round trip through 5.1.

## Install

Download `delta_layers.js` and `changelog.json` from the
[latest release](https://github.com/Embody-Games/EGT-DeltaLayers/releases/latest) into the
same folder, then in Blockbench: File > Plugins > Load Plugin From File.

Two rules about that folder:

- **Do not rename the .js.** Blockbench derives a file-loaded plugin's id from the filename and
  matches it against the id inside. Rename one without the other and it refuses to load.
- **Give it its own folder, with `changelog.json` beside it.** Blockbench resolves a plugin's
  changelog by stripping the filename off its path, so two file-loaded plugins in the same
  folder end up sharing one changelog.

Blockbench remembers the path it loaded from and reloads from there on every start, so put the
folder somewhere permanent.

## Layout

| Path | What it is |
|---|---|
| `delta_layers.js` | The whole plugin, plain JS, no build step |
| `changelog.json` | Blockbench's changelog format. Also the source of the GitHub release notes |
| `test/` | Two Node suites against a mock Blockbench built from the real source |
| `scripts/release.mjs` | Cuts a version: tests, bump, changelog, commit, tag, push |
| `scripts/release_notes.mjs` | Renders one version's changelog entry as markdown |
| `.github/workflows/` | Tests on every push, release published on every `v*` tag |

## Cutting a release

One command. It runs the suites first, so a failure leaves the tree untouched.

```sh
npm run release -- minor --title "Layer groups" \
  --added "Layer groups from Blockbench 5.2 survive a save and reload." \
  --fixed "A texture holding a group no longer stops saving its layers."
```

That bumps `PLUGIN_VERSION` in the plugin and the version in `package.json`, writes the
`changelog.json` entry, commits as `vX.Y.Z: <title>`, tags `vX.Y.Z` and pushes. The tag then
triggers the release workflow, which reruns the suites, checks the tag against the version in
the plugin, and publishes a GitHub release whose body is that changelog entry, with both files
attached.

`--added`, `--changed`, `--fixed`, `--removed` and `--safeguards` are repeatable and map onto
the changelog categories. Long notes are easier from a file: `--notes notes.json`. Add
`--dry-run` to see the commit and tag without writing anything, `--no-push` to push by hand.

The version lives in exactly one place, `const PLUGIN_VERSION` in the plugin file. Everything
else is derived from it.

More detail, including how pushing works from a Claude session, is in
[RELEASING.md](RELEASING.md).

## Tests

```sh
npm test          # run_tests.js (5.1 shaped) then run_tests_52.js (layer groups)
npm run writes    # writes per Ctrl+S, should be 0 for a no-op save
```

Real files, real PNG encode and decode, real compositing, real `fs.watch` events, Blockbench's
exact scoped-fs signatures, and a verbatim port of `solveLayerOrder`.
