import { app } from 'electron'

// One binary, two roles: the app, or the web-preserve worker when the packaged runtime launches it with
// `--web-preserve` (compose from the repository starts the worker with Electron directly instead).
if (process.argv.includes('--web-preserve')) void import('./preserve-worker.ts')
else {
  // A development build keeps a profile of its own ("PIM Dev" beside the packaged app's "PIM"), so `npm run dev`
  // and PIM.app never open one vault with two cores. A gate run names its profile with --user-data-dir and keeps it.
  if (!app.isPackaged && !app.commandLine.hasSwitch('user-data-dir'))
    app.setPath('userData', `${app.getPath('userData')} Dev`)
  void import('./app.ts')
}
