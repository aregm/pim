# Gate 0: everything connects

**Run:** 2026-11-03, on the reference Mac (Apple Silicon, macOS 27.0.1, Node 26.12.0, Python 3.12.2), commit: the initial commit.

| Check                                                                                        | Result                                                                                                                          |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `engine::workers::list` lists `parse`, `media` and, with the app running, `desktop`          | PASS: compose, configuration, desktop, iii-engine-functions, iii-observability, iii-telemetry, iii-worker-manager, media, parse |
| Engine port bound to loopback only                                                           | PASS: `127.0.0.1:49140` is the only listener                                                                                    |
| Telemetry off                                                                                | PASS: the engine process carries `III_TELEMETRY_ENABLED=false`                                                                  |
| `parse::health`, `media::health`, `kernel::ping`, `kernel::health` answer through the engine | PASS                                                                                                                            |
| `npm run lint`, `npm test`, contracts export committed, `npm run build -w apps/desktop`      | PASS                                                                                                                            |
| CI workflow on a macOS runner                                                                | NOT VERIFIED: no GitHub remote yet; the workflow file is in place                                                               |

Notes: port 49140 was chosen because 49134 on this machine belongs to another iii engine (`~/iii/learn-iii`), which PIM never touches. The Electron binary needed `node node_modules/electron/install.js` after `npm install`; `npm run setup` now runs it when missing.
