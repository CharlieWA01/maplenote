# vendor-src: how the files in `static/vendor/` are made

Maplenote uses two JavaScript libraries, bundled into single files and
committed so the app works offline with no build step:

| Bundle | Library | Global | Used for |
|---|---|---|---|
| `static/vendor/codemirror.js` | [CodeMirror 6](https://codemirror.net/) | `CM` | the editing area |
| `static/vendor/markdown-it.js` | [markdown-it](https://github.com/markdown-it/markdown-it) | `MD` | the Markdown preview |

Running Maplenote needs only Python; **this folder only matters when
upgrading a library.**

To rebuild (needs Node.js):

```bash
cd vendor-src
npm ci          # installs the exact versions in package-lock.json
npm run build   # writes both bundles into ../static/vendor/
```

To upgrade: change the versions in `package.json` (prefer releases that have
been out for a couple of weeks), run `npm install`, then `npm run build`,
test, and commit `package.json`, `package-lock.json` and the rebuilt bundles
together. If a bundled package was added or removed, update
`static/vendor/THIRD-PARTY-LICENSES.txt` too.

- `codemirror-entry.js` and `markdown-entry.js` list what goes into each
  bundle.
- License texts for everything bundled: `static/vendor/THIRD-PARTY-LICENSES.txt`
  (all MIT, except `entities`, which is BSD-2-Clause).
