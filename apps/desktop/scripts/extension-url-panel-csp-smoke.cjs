/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports */
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')
const electronViteDir = path.dirname(require.resolve('electron-vite/package.json'))
const { buildSync } = require(require.resolve('esbuild', { paths: [electronViteDir] }))

const TIMEOUT_MS = 8_000
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-agent-url-panel-csp-'))

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address().port))
  })
}

function close(server) {
  return new Promise((resolve) => {
    server.close(resolve)
    server.closeAllConnections?.()
  })
}

async function waitFor(check, label) {
  const deadline = Date.now() + TIMEOUT_MS
  while (Date.now() < deadline) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(`Timed out waiting for ${label}`)
}

async function run() {
  const bundledDisplay = path.join(tempDir, 'extension-panel-display.cjs')
  let evilScriptExecutions = 0
  const allowedServerRequests = []
  let serverA
  let serverB
  let window

  try {
    buildSync({
      entryPoints: [
        path.join(
          __dirname,
          '..',
          'src',
          'renderer',
          'src',
          'components',
          'session',
          'panel',
          'tabs',
          'display',
          'extensionPanelDisplay.ts'
        )
      ],
      bundle: true,
      format: 'cjs',
      platform: 'node',
      outfile: bundledDisplay,
      logLevel: 'silent'
    })
    const { prepareExtensionPanelUrlHost } = require(bundledDisplay)

    serverB = http.createServer((request, response) => {
      if (request.url === '/executed') {
        evilScriptExecutions += 1
        response.writeHead(204).end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end('<script>fetch("/executed")</script><main>Evil redirect target</main>')
    })
    const portB = await listen(serverB)

    serverA = http.createServer((request, response) => {
      allowedServerRequests.push(request.url)
      if (request.url === '/redirect') {
        response.writeHead(302, { location: `http://127.0.0.1:${portB}/evil` }).end()
        return
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      response.end(`<!doctype html>
        <script>
          window.addEventListener('message', (event) => {
            if (event.source === parent && event.data?.type === 'host-ping') {
              parent.postMessage({ type: 'child-echo', value: event.data.value }, '*')
            }
          })
        </script>
        <main>Allowed panel</main>`)
    })
    const portA = await listen(serverA)

    const topHtml = `<!doctype html>
      <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'nonce-theme-init'; style-src 'self' 'unsafe-inline'; frame-src 'self' about: data: blob: https: http:">
      <iframe id="host" sandbox="allow-scripts allow-same-origin"></iframe>
      <script nonce="theme-init">
        window.smokeEvents = [];
        window.hostLoaded = false;
        const host = document.getElementById('host');
        host.addEventListener('load', () => { window.hostLoaded = true; });
        window.addEventListener('message', (event) => {
          window.smokeEvents.push({
            data: event.data,
            origin: event.origin,
            sourceIsHost: event.source === host.contentWindow
          });
        });
      </script>`
    const topPath = path.join(tempDir, 'top.html')
    fs.writeFileSync(topPath, topHtml)

    window = new BrowserWindow({
      show: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    })
    window.webContents.on('console-message', (event) => {
      process.stderr.write(`[renderer:${event.level}] ${event.message}\n`)
    })
    await window.loadFile(topPath)

    const allowedHost = prepareExtensionPanelUrlHost({
      id: 'allowed',
      title: 'Allowed',
      source: {
        type: 'url',
        url: `http://127.0.0.1:${portA}/panel`,
        permissions: { enableScripts: true, sameOrigin: true }
      }
    })
    await window.webContents.executeJavaScript(`
      window.hostLoaded = false;
      window.smokeEvents = [];
      document.getElementById('host').src =
        'data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(allowedHost)});
    `)
    await waitFor(
      () => window.webContents.executeJavaScript('window.hostLoaded === true'),
      'allowed URL host load'
    )
    await window.webContents.executeJavaScript(`
      document.getElementById('host').contentWindow.postMessage(
        { type: 'host-ping', value: 42 },
        '*'
      );
    `)
    try {
      await waitFor(
        () =>
          window.webContents.executeJavaScript(
            'window.smokeEvents.some((event) => event.sourceIsHost && event.origin === "null" && event.data?.type === "child-echo" && event.data.value === 42)'
          ),
        'URL host message round trip'
      )
    } catch (error) {
      const rendererState = await window.webContents.executeJavaScript(
        '({ hostLoaded: window.hostLoaded, smokeEvents: window.smokeEvents })'
      )
      throw new Error(
        `${error.message}; requests=${JSON.stringify(allowedServerRequests)}; renderer=${JSON.stringify(rendererState)}`
      )
    }

    const redirectedHost = prepareExtensionPanelUrlHost({
      id: 'redirected',
      title: 'Redirected',
      source: {
        type: 'url',
        url: `http://127.0.0.1:${portA}/redirect`,
        permissions: { enableScripts: true, sameOrigin: true }
      }
    })
    await window.webContents.executeJavaScript(`
      window.hostLoaded = false;
      document.getElementById('host').src =
        'data:text/html;charset=utf-8,' + encodeURIComponent(${JSON.stringify(redirectedHost)});
    `)
    await new Promise((resolve) => setTimeout(resolve, 1_000))
    if (evilScriptExecutions !== 0) {
      throw new Error('Cross-origin redirect target executed despite URL host CSP')
    }

    process.stdout.write(
      `${JSON.stringify({ allowedMessageRoundTrip: true, crossOriginRedirectExecuted: false })}\n`
    )
  } finally {
    window?.destroy()
    if (serverA) await close(serverA)
    if (serverB) await close(serverB)
    fs.rmSync(tempDir, { force: true, recursive: true })
  }
}

app
  .whenReady()
  .then(run)
  .then(
    () => app.exit(0),
    (error) => {
      console.error(error)
      app.exit(1)
    }
  )
