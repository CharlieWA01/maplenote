# vendor-src: how `static/vendor/codemirror.js` is made

Maplenote uses [CodeMirror 6](https://codemirror.net/) for its editing area.
CodeMirror 6 is published as many small packages, so we bundle the parts we use
into one file, `static/vendor/codemirror.js`, and commit it. Running Maplenote
needs only Python; **this folder only matters when upgrading CodeMirror.**

To rebuild (needs Node.js):

```bash
cd vendor-src
npm ci          # installs the exact versions in package-lock.json
npm run build   # writes ../static/vendor/codemirror.js
```

To upgrade: change the versions in `package.json`, run `npm install`, then
`npm run build`, test, and commit `package.json`, `package-lock.json` and the
rebuilt bundle together.

- `codemirror-entry.js` lists which CodeMirror pieces are included; they
  appear on a global `CM` object (e.g. `CM.EditorView`).
- CodeMirror is MIT-licensed; see `static/vendor/LICENSE-codemirror.txt`.
