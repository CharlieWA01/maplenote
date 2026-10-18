// The parts of CodeMirror 6 that Maplenote uses. Bundled into one file,
// static/vendor/codemirror.js, which puts them on a global called `CM`.
export { EditorState, Compartment } from "@codemirror/state";
export {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection,
} from "@codemirror/view";
export { history, historyKeymap, defaultKeymap, indentWithTab } from "@codemirror/commands";
export { search, searchKeymap, openSearchPanel, highlightSelectionMatches } from "@codemirror/search";
