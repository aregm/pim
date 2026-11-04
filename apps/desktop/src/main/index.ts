// One binary, two roles: the app, or the web-preserve worker when the packaged runtime launches it with
// `--web-preserve` (compose from the repository starts the worker with Electron directly instead).
if (process.argv.includes('--web-preserve')) void import('./preserve-worker.ts')
else void import('./app.ts')
