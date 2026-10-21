export * from './seed';
export * from './ids';
export * from './dashboard-content';
export * from './build-dataset';
export * from './mock-repository';
export * from './share-repository';
// NOTE: msw-handlers is deliberately NOT re-exported here.
//
// It imports `msw`, whose cookie store touches `localStorage` at module-init
// time. Re-exporting it meant every consumer of MockRepository (i.e. the web
// app) pulled MSW into the production bundle, and the app hard-crashed to a
// white screen inside ANY sandboxed iframe / embedded preview with:
//   "Failed to read the 'localStorage' property from 'Window': The document is
//    sandboxed and lacks the 'allow-same-origin' flag"
// ...before any of our own try/catch guards could run.
//
// The handlers are a dev/test-only illustration of the REST shape. Import them
// directly from './msw-handlers' if a test harness ever needs them.
