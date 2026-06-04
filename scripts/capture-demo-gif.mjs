import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const url = process.env.DEMO_URL || 'http://127.0.0.1:1421/?demo=1'
const frameDir = resolve(repoRoot, 'docs/assets/demo-frames')
const userDataDir = join(tmpdir(), 'tauri-markdown-reader-chrome-demo-profile')
const viewport = { width: 1440, height: 960 }
const remotePort = Number(process.env.CHROME_REMOTE_PORT || '9333')

await rm(frameDir, { recursive: true, force: true })
await rm(userDataDir, { recursive: true, force: true })
await mkdir(frameDir, { recursive: true })
await mkdir(userDataDir, { recursive: true })

const chrome = spawn(chromePath, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  `--remote-debugging-port=${remotePort}`,
  `--user-data-dir=${userDataDir}`,
  `--window-size=${viewport.width},${viewport.height}`,
  'about:blank',
], { stdio: 'ignore' })

try {
  const page = await connectToPage()
  const cdp = createCdpClient(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.setViewport', viewport).catch(() => undefined)
  await cdp.send('Page.navigate', { url })
  await wait(1800)

  const frames = [
    async () => {},
    async () => typeSearch(cdp, 'SQL'),
    async () => clickText(cdp, 'SQL 排查速读'),
    async () => pressShortcut(cdp, 'p', true),
    async () => typeQuickOpen(cdp, 'export'),
    async () => clickQuickOpenText(cdp, '复制与导出检查'),
    async () => clickText(cdp, '源码'),
    async () => clickText(cdp, '编辑'),
    async () => clickText(cdp, '专注'),
  ]

  for (let index = 0; index < frames.length; index += 1) {
    await frames[index]()
    await wait(index === 0 ? 600 : 900)
    await screenshot(cdp, index)
  }
  await cdp.close()
} finally {
  chrome.kill()
}

async function connectToPage() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const pages = await fetch(`http://127.0.0.1:${remotePort}/json`).then((response) => response.json())
      const page = pages.find((entry) => entry.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {
      await wait(250)
    }
  }
  throw new Error('Chrome DevTools endpoint did not become available.')
}

function createCdpClient(wsUrl) {
  const socket = new WebSocket(wsUrl)
  let nextId = 1
  const pending = new Map()

  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    if (message.error) waiter.reject(new Error(message.error.message))
    else waiter.resolve(message.result)
  })

  return {
    open: () => new Promise((resolveOpen, rejectOpen) => {
      socket.addEventListener('open', resolveOpen, { once: true })
      socket.addEventListener('error', rejectOpen, { once: true })
    }),
    send(method, params = {}) {
      const id = nextId
      nextId += 1
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolveSend, rejectSend) => pending.set(id, { resolve: resolveSend, reject: rejectSend }))
    },
    close: () => socket.close(),
  }
}

async function screenshot(cdp, index) {
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  await writeFile(join(frameDir, `${String(index).padStart(2, '0')}.png`), Buffer.from(data, 'base64'))
}

async function typeSearch(cdp, value) {
  await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const input = document.querySelector('.sidebar .search-box input');
        input.focus();
        input.value = ${JSON.stringify(value)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `,
  })
}

async function typeQuickOpen(cdp, value) {
  await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const input = document.querySelector('.quick-open input');
        input.focus();
        input.value = ${JSON.stringify(value)};
        input.dispatchEvent(new Event('input', { bubbles: true }));
      })()
    `,
  })
}

async function pressShortcut(cdp, key, control = false) {
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    modifiers: control ? 2 : 0,
  })
  await cdp.send('Input.dispatchKeyEvent', {
    type: 'keyUp',
    key,
    code: `Key${key.toUpperCase()}`,
    windowsVirtualKeyCode: key.toUpperCase().charCodeAt(0),
    modifiers: control ? 2 : 0,
  })
}

async function clickText(cdp, text) {
  await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const needle = ${JSON.stringify(text)};
        const elements = Array.from(document.querySelectorAll('button, [role="button"], option'));
        const target = elements.find((element) => element.textContent && element.textContent.includes(needle));
        if (target) target.click();
      })()
    `,
  })
}

async function clickQuickOpenText(cdp, text) {
  await cdp.send('Runtime.evaluate', {
    expression: `
      (() => {
        const needle = ${JSON.stringify(text)};
        const elements = Array.from(document.querySelectorAll('.quick-open button'));
        const target = elements.find((element) => element.textContent && element.textContent.includes(needle));
        if (target) target.click();
      })()
    `,
  })
}

function wait(ms) {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms))
}
