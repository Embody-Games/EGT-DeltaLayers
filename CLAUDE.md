# Delta Layers — notes for Claude

Blockbench plugin that keeps a texture's layer stack alive across saves by writing a
sidecar beside the texture PNG. `README.md` explains what it does and how a user
installs it. `RELEASING.md` is the authority on cutting a release, including how to
push from a Cowork session. Read that before releasing anything; this file is
orientation.

## Shape of the repo

There is **no build step**. The plugin is one hand-written file that ships as-is.

| Path | What it is |
|---|---|
| `delta_layers.js` | The entire plugin. `const PLUGIN_VERSION` near the top is the only place the version lives. |
| `changelog.json` | Blockbench's changelog format. **The only place release notes are written.** |
| `CHANGELOG.md` | Generated. Never hand-edit it; run `npm run changelog`. |
| `delta_layers_icon.png` | Source for the icon inlined in the plugin. Re-inline with `npm run icon`. |
| `test/` | CommonJS suites. `npm test` runs `run_tests.js` and `run_tests_52.js`. |
| `scripts/` | `release.mjs`, `changelog.mjs`, `discord_notify.mjs`, `icon.mjs`. |

## Releasing

```sh
npm run release -- patch --title "Short name" --fixed "What the user sees."
```

**Pushing the tag is the button.** That command tests, bumps, writes the changelog
entry, commits, tags and pushes. Everything after that is automatic.

Repo-only changes — CI, README, scripts, this file — get a plain commit. No version
bump, no tag, no changelog entry. The version belongs to the plugin, not the repo.

## What happens once the tag lands

`.github/workflows/release.yml`, on a GitHub runner:

1. Reruns the suites.
2. Refuses if the tag disagrees with `PLUGIN_VERSION`.
3. Publishes the GitHub release. Body is that version's `changelog.json` entry,
   with `delta_layers.js` and `changelog.json` attached.
4. Posts that same entry to Discord.
5. Ends. Nothing stays running.

## The Discord post

There is **no bot**. No hosted process, nothing invited to the server, nothing
listening. Step 4 above is a single HTTP POST to a Discord webhook, and then the
workflow exits. Discord labels webhook messages **APP**, which is not a bot account.

`scripts/discord_notify.mjs` reads the version's `changelog.json` entry and posts it
as an embed. Configuration is the `env:` block at the top of `release.yml`:

| Variable | Why |
|---|---|
| `PLUGIN_FILE` | Reads the version out of it; also builds the install link. |
| `PLUGIN_NAME` | The name the message posts under. |
| `PLUGIN_ICON_URL` | The avatar the message posts under. |
| `PLUGIN_COLOR` | Embed stripe colour, hex without the `#`. |
| `DISCORD_THREAD_ID` | The forum post it goes into. **`1545338449211559976` for this plugin.** |

The webhook URL is the repo/org secret `DISCORD_WEBHOOK_URL`. It is never in the
repo. All four plugin repos can read it.

Every plugin posts through **one** webhook on the `#addons` forum channel and lands
in its own thread via `?thread_id=`. Each post overrides `username` and
`avatar_url`, so it arrives as the plugin rather than as one shared identity.

Preview a post without sending anything:

```sh
PLUGIN_NAME="Delta Layers" PLUGIN_FILE=delta_layers.js \
  GITHUB_REPOSITORY=Embody-Games/EGT-DeltaLayers \
  node scripts/discord_notify.mjs 1.5.1 --dry-run
```

The step is `continue-on-error`. A Discord outage must never fail a good release.

## Traps

- **The test suites are CommonJS.** Do not add `"type": "module"` to
  `package.json`; it breaks all four test files. The `.mjs` extensions already
  make the scripts ESM, so it buys nothing.
- The suites need the `canvas` devDependency. `npm install` first, or they fail
  with "Cannot find module 'canvas'".
- `release.mjs` keeps `package-lock.json`'s version in step with `package.json`.
  It used to not, and the lockfile silently sat at 1.3.0 for several releases.
- Renaming the plugin file changes the plugin id, because Blockbench derives the id
  from the filename. Repo name, filename and id are kept matching on purpose
  (`EGT-<Name>` / `<name>.js` / `<name>`) so the raw handout link reads cleanly.
- Users are given `https://raw.githubusercontent.com/Embody-Games/EGT-DeltaLayers/main/delta_layers.js`.
  Anything that reaches `main` reaches them immediately. There is no staging step.

## Changelog voice

Say what the user sees, not what the code did. "A texture holding a layer group
stopped saving its layers entirely" beats "fixed TypeError in writeSidecar".
Categories, in order: Added, Changed, Fixed, Removed, Safeguards.
