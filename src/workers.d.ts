// `worker:<path>` imports: scripts/build.mjs bundles that module on its own and inlines its code as a string, so a
// widget can start the worker from a blob without fetching another file (works cross-origin and after an app's
// bundler has moved the widget's files around).
declare module 'worker:*' {
  const code: string;
  export default code;
}
