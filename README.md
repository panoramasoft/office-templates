# Office templates

Reviewed templates for **Virtual Office**, the app where you start an office and hire AI employees. Each template is a ready-made team: who they are, what they are told, starter files and suggested schedules (always off). The app lists them under **More templates online**.

Everything here is public domain under [CC0 1.0](LICENSE).

## How the app trusts this repository

You can't run anything from a template: it is text an employee reads. Even so, the app accepts only what a person here reviewed:

1. **A signed list.** `index.json` lists the templates. The maintainer signs it on their own Mac with an Ed25519 key (`index.json.sig`). The app holds the public key and refuses a list whose signature doesn't verify over its exact bytes.
2. **No going back.** Each list has a `serial` that only goes up, and an `expires` date at most 90 days after signing. The app refuses a list older than one it has seen, and an expired one.
3. **Pinned files.** Each entry names a full 40-character commit and the SHA-256 of `built/<id>.json` at that commit. The app fetches that exact file from this repository (the repository name is fixed in the app) and refuses it if one byte differs.

A stolen GitHub login can't change what the app accepts: it would need the signing key, which never leaves the maintainer's Mac and is never in this repository or in CI.

## Layout

| Path | What |
|---|---|
| `templates/<id>/manifest.json` | The template: name, description, purpose, audience, roles and their instructions, schedules |
| `templates/<id>/files/` | Its starter files (plain text) |
| `built/<id>.json` | One self-contained file per template, built from the two above. This is what the app fetches |
| `index.json`, `index.json.sig` | The signed list (made by the maintainer after a merge) |
| `keys/public-keys.txt` | The public keys the list may be signed with (the same ones as the app) |
| `checker/` | The app's own template rules, copied from the app at commit `befc25d` (`server/template.ts` and the files it imports). Update by copying again; don't edit here |
| `scripts/` | build, check, make-index, keygen, sign, verify |

## Adding a template

1. Make an office in the app, then use **Save as template**, or write `templates/<id>/manifest.json` by hand. `<id>` is lower-case letters, digits and dashes.
2. Put starter files in `templates/<id>/files/`.
3. Run `npm ci --ignore-scripts` once, then `node scripts/build.ts` and `node scripts/check.ts` (Node 22.18 or newer).
4. Open a pull request and tick the checklist.

**Content rules:**
- No real person's or company's name.
- No customer data, and no text you didn't write.
- Starter files are short and original.
- `purpose` and `audience` are filled in.

The check refuses characters you can't see. It also prints every address in the template and any line asking the AI to ignore instructions, hide things from the boss, act without asking or pass on a password. A reviewer reads all of it before merging.

## Publishing (the maintainer, on their own Mac)

Once, to make the key:

```sh
node scripts/keygen.ts
```

It writes the private key to `~/.office-templates-key/signing-key.pem` (mode 600, outside this repository) and prints the public key. Add the public key to `keys/public-keys.txt`, and send it to the app team for the app's key slot. Back up the private key offline.

After each reviewed merge to `main`, and at least every 60 days:

```sh
git checkout main && git pull
node scripts/make-index.ts     # pins HEAD; serial + 1; expires in 60 days
node scripts/sign.ts           # writes index.json.sig
git add index.json index.json.sig && git commit -m "Index <serial>" && git push
```

To withdraw a template: delete its folder and built file, merge, then make and sign a new index. The higher serial means no app goes back to the list that still had it.

## Index format

`index.json` is `virtual-office-gallery-index@1`:

```json
{
  "format": "virtual-office-gallery-index@1",
  "serial": 1,
  "signedAt": "2026-11-04T12:00:00.000Z",
  "expires": "2027-01-03T12:00:00.000Z",
  "entries": [
    {
      "id": "job-search",
      "name": "…",
      "description": "…",
      "version": "1.0.0",
      "industry": "…",
      "author": "…",
      "commit": "<40 hex>",
      "path": "built/job-search.json",
      "sha256": "<64 hex>",
      "roleCount": 3,
      "fileCount": 4,
      "scheduleCount": 1
    }
  ]
}
```

`industry` and `author` are optional. No other keys are allowed. `path` is always `built/<id>.json`. `index.json.sig` is the base64 Ed25519 signature of the exact bytes of `index.json`.
