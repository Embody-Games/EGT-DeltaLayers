# Releasing

The version lives in exactly one place, `const PLUGIN_VERSION` in
`embodygames_delta_layers.js`. Everything else is derived from it. There is no build
step, so cutting a release is the build.

## One command

```sh
npm run release -- <major|minor|patch> --title "Short release name" \
  --added "..." --fixed "..." --changed "..."
```

That runs both test suites, bumps the version in the plugin and in `package.json`, inserts the
`changelog.json` entry, commits `vX.Y.Z: <title>`, tags `vX.Y.Z` and pushes. Tests run before
anything is written, so a failing suite leaves the working tree untouched.

Flags: `--dry-run` to preview the commit and tag, `--no-push` to push by hand, `--notes
<file.json>` for long entries, and `--removed` / `--safeguards` alongside the other category
flags. All the category flags are repeatable.

Pushing the tag is what publishes. `.github/workflows/release.yml` reruns the suites, refuses
if the tag disagrees with `PLUGIN_VERSION`, then publishes a GitHub release whose body is that
version's `changelog.json` entry, with the plugin and `changelog.json` attached.

Bump by what changed: `patch` for a fix with no new behaviour, `minor` for new behaviour or a
new sidecar version, `major` only for a sidecar format older plugins cannot read. Repo-only
changes such as CI, README or scripts get a plain commit: no version, no tag, no changelog
entry. The version belongs to the plugin, not to the repo.

## Changelog voice

`changelog.json` is the only place release notes are written. Blockbench's Changelog tab and
the GitHub release page both render from it, so they cannot drift.

Say what the user sees, not what the code did. "A texture holding a layer group stopped saving
its layers entirely" beats "fixed TypeError in writeSidecar". Categories, in order: Added,
Changed, Fixed, Removed, Safeguards. Always mention a sidecar version change and whether older
sidecars still load.

## Pushing from a Claude session

Claude reaches this folder through the Cowork device bridge, a shell with network access but no
stored git credential of its own. A GitHub token scoped to this repository alone lives at
`.git/egt-push-token`, which is outside version control, so it is never committed or pushed.
Read it and use it inline:

```sh
TOKEN=$(tr -d '\r\n' < .git/egt-push-token)
git push --follow-tags "https://x-access-token:$TOKEN@github.com/Embody-Games/EGT-DeltaLayers.git" main
```

Never write that token into `.git/config`, into a tracked file, or anywhere that leaves the
machine.

**On a different computer** the file will not exist, because `.git` is per clone. Either put
the token there from a password manager, or push with that machine's own git credentials. The
token reaches this repository and nothing else, so it can be replaced at any time at
github.com/settings/personal-access-tokens without breaking anything else.

**Two quirks of the bridge.** The mounted folder denies `unlink`, so a commit made from a
Claude session leaves `.git/index.lock` and `HEAD.lock` behind, and those will block git on the
Windows side. Clear them afterwards:

```sh
find .git \( -name "*.lock" -o -name "tmp_obj_*" \) -delete
```

And the Linux side of the bridge cannot see Windows' global git config, so `user.name` and
`user.email` are set in this repo's own config instead.
