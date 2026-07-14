import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const electronViteCli = join(dirname(require.resolve('electron-vite/package.json')), 'bin/electron-vite.js')
const env = { ...process.env }

delete env.ELECTRON_RUN_AS_NODE

const child = spawn(
  process.execPath,
  [electronViteCli, 'dev', '--inspect=9223', '--remote-debugging-port=9222'],
  {
    env,
    stdio: 'inherit'
  }
)

child.on('error', (error) => {
  console.error(error)
  process.exitCode = 1
})

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exitCode = code ?? 1
})
