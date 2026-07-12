<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Code2,
  Crosshair,
  CircleAlert,
  LoaderCircle,
  Monitor,
  MonitorSmartphone,
  RefreshCw,
  RotateCw,
  Smartphone,
  X
} from 'lucide-vue-next'
import BaseIconButton from '@renderer/components/base/BaseIconButton.vue'
import { Input } from '@renderer/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import useWorkspaceSessionStore from '@renderer/stores/workspace-session'
import {
  validateBrowserPreviewEmulation,
  type BrowserPreviewDeviceEmulation
} from '@shared/browser-preview'

interface BrowserWebviewElement extends HTMLElement {
  src: string
  getURL(): string
  getTitle(): string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  stop(): void
  getWebContentsId(): number
  executeJavaScript<T>(code: string, userGesture?: boolean): Promise<T>
  capturePage(): Promise<{ toDataURL(): string }>
  openDevTools(): void
  closeDevTools(): void
  isDevToolsOpened(): boolean
}

type LogEntry = { level: string; message: string; source?: string; line?: number; time: string }
type BrowserCommand = {
  type: 'browser.command'
  requestId: string
  command: string
  payload?: unknown
}

type BrowserPageState = {
  browserId: string
  title: string
  url: string
  loading: boolean
  webContentsId?: number
}
type DevicePresetId = 'desktop' | 'responsive' | 'iphone-se' | 'iphone-15' | 'pixel-7' | 'ipad'

const IOS_USER_AGENT =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const ANDROID_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
const DEVICE_PRESETS: Record<DevicePresetId, BrowserPreviewDeviceEmulation> = {
  desktop: {
    enabled: false,
    width: 1280,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
    touch: false,
    orientation: 'landscape'
  },
  responsive: {
    enabled: true,
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    orientation: 'portrait',
    userAgent: IOS_USER_AGENT,
    platform: 'iPhone'
  },
  'iphone-se': {
    enabled: true,
    width: 375,
    height: 667,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    orientation: 'portrait',
    userAgent: IOS_USER_AGENT,
    platform: 'iPhone'
  },
  'iphone-15': {
    enabled: true,
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    mobile: true,
    touch: true,
    orientation: 'portrait',
    userAgent: IOS_USER_AGENT,
    platform: 'iPhone'
  },
  'pixel-7': {
    enabled: true,
    width: 412,
    height: 915,
    deviceScaleFactor: 2.625,
    mobile: true,
    touch: true,
    orientation: 'portrait',
    userAgent: ANDROID_USER_AGENT,
    platform: 'Android'
  },
  ipad: {
    enabled: true,
    width: 820,
    height: 1180,
    deviceScaleFactor: 2,
    mobile: true,
    touch: true,
    orientation: 'portrait',
    userAgent: IOS_USER_AGENT.replace('iPhone', 'iPad'),
    platform: 'iPad'
  }
}

function readStoredDevice(key: string): {
  preset: DevicePresetId
  emulation: BrowserPreviewDeviceEmulation
} {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '') as {
      preset?: DevicePresetId
      emulation?: BrowserPreviewDeviceEmulation
    }
    if (value.preset && value.preset in DEVICE_PRESETS && value.emulation) {
      return {
        preset: value.preset,
        emulation: validateBrowserPreviewEmulation(value.emulation)
      }
    }
  } catch {
    // Invalid persisted state falls back to Desktop.
  }
  return { preset: 'desktop', emulation: DEVICE_PRESETS.desktop }
}

const props = defineProps<{ browserId: string; initialUrl?: string }>()
const emit = defineEmits<{ state: [state: BrowserPageState] }>()
const store = useWorkspaceSessionStore()
const webview = ref<BrowserWebviewElement>()
const storageScope = props.browserId
const urlStorageKey = `meta-agent.browser-preview.url:${storageScope}`
const deviceStorageKey = `meta-agent.browser-preview.device:${storageScope}`
const deviceToolbarStorageKey = `meta-agent.browser-preview.device-toolbar:${storageScope}`
const initialUrl =
  props.initialUrl || localStorage.getItem(urlStorageKey) || 'http://127.0.0.1:3000'
const initialDevice = readStoredDevice(deviceStorageKey)
const urlInput = ref(initialUrl)
const devicePreset = ref<DevicePresetId>(initialDevice.preset)
const emulation = ref<BrowserPreviewDeviceEmulation>({ ...initialDevice.emulation })
const showDeviceToolbar = ref(localStorage.getItem(deviceToolbarStorageKey) === 'true')
const frameStyle = computed(() =>
  emulation.value.enabled
    ? { width: `${emulation.value.width}px`, height: `${emulation.value.height}px` }
    : { width: '100%', height: '100%' }
)
const currentUrl = ref('')
const title = ref('Browser')
const loading = ref(false)
const canGoBack = ref(false)
const canGoForward = ref(false)
const picking = ref(false)
const devToolsOpen = ref(false)
const capturing = ref(false)
const toolbarPointerInside = ref(false)
const error = ref('')
const failedUrl = ref('')
const logs = ref<LogEntry[]>([])
const selectedRef = ref('')

function allowedUrl(value: string): string {
  const parsed = new URL(value)
  if (!['http:', 'https:'].includes(parsed.protocol))
    throw new Error('Only HTTP(S) URLs are allowed')
  if (parsed.username || parsed.password) {
    throw new Error('URLs containing credentials are not allowed')
  }
  return parsed.toString()
}

function getGuestWebContentsId(): number | undefined {
  try {
    return webview.value?.getWebContentsId()
  } catch {
    return undefined
  }
}

async function loadGuestUrl(value: string): Promise<void> {
  const webContentsId = getGuestWebContentsId()
  if (!webContentsId) throw new Error('Browser view is not ready')
  await window.api.browserPreview.navigate({
    webContentsId,
    url: allowedUrl(value)
  })
}

async function applyEmulation(next = emulation.value): Promise<void> {
  const webContentsId = getGuestWebContentsId()
  if (!webContentsId) return
  const plainEmulation = { ...next }
  await window.api.browserPreview.setEmulation({
    webContentsId,
    emulation: plainEmulation
  })
  emulation.value = plainEmulation
  localStorage.setItem(
    deviceStorageKey,
    JSON.stringify({ preset: devicePreset.value, emulation: emulation.value })
  )
}

function toggleDeviceToolbar(): void {
  showDeviceToolbar.value = !showDeviceToolbar.value
  localStorage.setItem(deviceToolbarStorageKey, String(showDeviceToolbar.value))
}

async function selectDevicePreset(value?: unknown): Promise<void> {
  if (typeof value === 'string' && value in DEVICE_PRESETS) {
    devicePreset.value = value as DevicePresetId
  }
  await applyEmulation({ ...DEVICE_PRESETS[devicePreset.value] })
}

async function updateResponsiveSize(): Promise<void> {
  devicePreset.value = 'responsive'
  await applyEmulation({
    ...emulation.value,
    enabled: true,
    mobile: true,
    touch: true,
    width: Math.max(240, Math.min(2560, Math.round(emulation.value.width))),
    height: Math.max(240, Math.min(2560, Math.round(emulation.value.height)))
  })
}

async function rotateDevice(): Promise<void> {
  if (!emulation.value.enabled) return
  await applyEmulation({
    ...emulation.value,
    width: emulation.value.height,
    height: emulation.value.width,
    orientation: emulation.value.orientation === 'portrait' ? 'landscape' : 'portrait'
  })
}

async function navigate(): Promise<void> {
  try {
    error.value = ''
    failedUrl.value = ''
    await loadGuestUrl(urlInput.value)
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
    failedUrl.value = urlInput.value
  }
}

function pageScript(body: string, input: unknown = {}): string {
  return `(() => { const input = ${JSON.stringify(input)}; ${body} })()`
}

const resolveElementSource = `
  const refs = globalThis.__metaBrowserRefs ||= new Map();
  const resolve = (target) => refs.get(target) || document.querySelector(target);
  const describe = (el, id) => {
    if (!el) throw new Error('Element not found');
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return { ref: id, tagName: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || '').trim().slice(0, 500),
      attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])),
      bounds: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      accessibility: { role: el.getAttribute('role'), name: el.getAttribute('aria-label') || el.innerText?.trim().slice(0, 120) },
      styles: { display: style.display, position: style.position, color: style.color, backgroundColor: style.backgroundColor,
        fontSize: style.fontSize, overflow: style.overflow, zIndex: style.zIndex, opacity: style.opacity } };
  };
`

async function waitForGuest(timeoutMs = 5000): Promise<BrowserWebviewElement> {
  const startedAt = Date.now()
  while (!webview.value || !getGuestWebContentsId()) {
    if (Date.now() - startedAt >= timeoutMs) throw new Error('Browser view is not ready')
    await new Promise((resolve) => window.setTimeout(resolve, 50))
  }
  await ensureGuestInitialized()
  return webview.value
}

async function executeCommand(message: BrowserCommand): Promise<unknown> {
  const guest = await waitForGuest()
  const payload = (message.payload || {}) as Record<string, unknown>
  switch (message.command) {
    case 'navigate':
      await loadGuestUrl(String(payload.url || ''))
      return { url: guest.getURL() }
    case 'snapshot': {
      const snapshot = await guest.executeJavaScript<Record<string, unknown>>(
        pageScript(`${resolveElementSource}
        refs.clear(); let index = 0;
        const interactive = [...document.querySelectorAll('a,button,input,textarea,select,[role],[tabindex]')].slice(0, 200).map(el => {
          const id = 'ref-' + (++index); refs.set(id, el); return describe(el, id);
        });
        return { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight, dpr: devicePixelRatio },
          touch: navigator.maxTouchPoints, userAgent: navigator.userAgent,
          text: document.body?.innerText?.slice(0, 12000) || '', interactive };
      `)
      )
      return { ...snapshot, emulation: { ...emulation.value }, preset: devicePreset.value }
    }
    case 'set-viewport': {
      const preset = payload.preset
      if (typeof preset === 'string' && preset in DEVICE_PRESETS) {
        devicePreset.value = preset as DevicePresetId
        await selectDevicePreset()
      } else {
        const width = Number(payload.width)
        const height = Number(payload.height)
        if (!Number.isFinite(width) || !Number.isFinite(height)) {
          throw new Error('A valid preset or width and height are required')
        }
        devicePreset.value = 'responsive'
        await applyEmulation({
          ...DEVICE_PRESETS.responsive,
          width: Math.round(width),
          height: Math.round(height),
          deviceScaleFactor:
            payload.deviceScaleFactor === undefined ? 2 : Number(payload.deviceScaleFactor),
          orientation: payload.orientation === 'landscape' ? 'landscape' : 'portrait'
        })
      }
      return { preset: devicePreset.value, ...emulation.value }
    }
    case 'inspect':
      return guest.executeJavaScript(
        pageScript(
          `${resolveElementSource}
        const target = String(input.target || ''); return describe(resolve(target), target);
      `,
          payload
        )
      )
    case 'action':
      return guest.executeJavaScript(
        pageScript(
          `${resolveElementSource}
        const action = String(input.action); const el = input.target ? resolve(String(input.target)) : document.scrollingElement;
        if (!el) throw new Error('Element not found');
        if (action === 'click') el.click();
        else if (action === 'hover') el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        else if (action === 'focus') el.focus();
        else if (action === 'type') { el.focus(); el.value = String(input.value || ''); el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: String(input.value || '') })); el.dispatchEvent(new Event('change', { bubbles: true })); }
        else if (action === 'press') el.dispatchEvent(new KeyboardEvent('keydown', { key: String(input.value || 'Enter'), bubbles: true }));
        else if (action === 'scroll') el.scrollBy({ left: Number(input.x || 0), top: Number(input.y || 0), behavior: 'instant' });
        return { action, target: input.target || 'page', url: location.href };
      `,
          payload
        ),
        true
      )
    case 'execute-js':
      return guest.executeJavaScript(
        pageScript(
          `${resolveElementSource}
        const $0 = input.target ? resolve(String(input.target)) : null;
        return eval(String(input.expression));
      `,
          payload
        ),
        true
      )
    case 'logs': {
      const value = JSON.parse(JSON.stringify(logs.value))
      if (payload.clear) logs.value = []
      return value
    }
    case 'screenshot': {
      const image = await guest.capturePage()
      return { dataUrl: image.toDataURL(), url: guest.getURL(), title: guest.getTitle() }
    }
    default:
      throw new Error(`Unsupported browser command: ${message.command}`)
  }
}

async function cancelElementPicker(): Promise<void> {
  const guest = webview.value
  if (!guest) return
  await guest.executeJavaScript(
    `globalThis.__metaBrowserPicker?.cancel(); delete globalThis.__metaBrowserPicker`
  )
}

async function pickElement(): Promise<void> {
  const guest = webview.value
  if (!guest) return
  if (picking.value) {
    await cancelElementPicker()
    return
  }
  picking.value = true
  try {
    const selection = await guest.executeJavaScript<Record<string, unknown> | null>(
      pageScript(`${resolveElementSource}
    globalThis.__metaBrowserPicker?.cancel();
    return new Promise(resolvePick => {
      const overlay = document.createElement('div'); overlay.id = '__meta-browser-picker';
      Object.assign(overlay.style, { position:'fixed', pointerEvents:'none', boxSizing:'border-box', zIndex:'2147483647', border:'0', boxShadow:'inset 0 0 0 2px #16a34a', background:'rgba(22,163,74,.12)' });
      document.documentElement.appendChild(overlay);
      const previousCursor = document.documentElement.style.cursor;
      document.documentElement.style.cursor = 'crosshair';
      let settled = false;
      const targetFor = event => event.composedPath().find(node => node instanceof Element && node !== overlay);
      const highlight = event => {
        const target = targetFor(event); if (!target) return;
        const r = target.getBoundingClientRect();
        const left = Math.max(0, r.left); const top = Math.max(0, r.top);
        const right = Math.min(document.documentElement.clientWidth, r.right);
        const bottom = Math.min(document.documentElement.clientHeight, r.bottom);
        Object.assign(overlay.style, { display: right > left && bottom > top ? 'block' : 'none', left:left+'px', top:top+'px', width:Math.max(0, right-left)+'px', height:Math.max(0, bottom-top)+'px' });
      };
      const cleanup = () => {
        overlay.remove(); document.documentElement.style.cursor = previousCursor;
        document.removeEventListener('pointermove', highlight, true); document.removeEventListener('pointerover', highlight, true);
        document.removeEventListener('touchstart', highlight, true); document.removeEventListener('click', select, true);
        document.removeEventListener('keydown', key, true);
        if (globalThis.__metaBrowserPicker === controller) delete globalThis.__metaBrowserPicker;
      };
      const finish = value => { if (settled) return; settled = true; cleanup(); resolvePick(value); };
      const select = event => {
        const target = targetFor(event); if (!target) return;
        event.preventDefault(); event.stopImmediatePropagation();
        const pickedRefs = globalThis.__metaBrowserPickedRefs ||= new WeakMap();
        const id = pickedRefs.get(target) || 'ref-picked-' + Date.now();
        pickedRefs.set(target, id); refs.set(id, target); finish(describe(target, id));
      };
      const key = event => { if (event.key === 'Escape') { event.preventDefault(); finish(null); } };
      const controller = { cancel: () => finish(null) };
      globalThis.__metaBrowserPicker = controller;
      document.addEventListener('pointermove', highlight, true); document.addEventListener('pointerover', highlight, true);
      document.addEventListener('touchstart', highlight, true); document.addEventListener('click', select, true);
      document.addEventListener('keydown', key, true);
    });
  `),
      true
    )
    if (!selection) return
    selectedRef.value = String(selection.ref || '')
    const tagName = String(selection.tagName || 'element')
    const text = String(selection.text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 200)
    const descriptor = `[Browser tab ${props.browserId}, element ${selectedRef.value}: <${tagName}>${text ? ` ${text}` : ''}]`
    store.addComposerQuote({
      id: `browser-element-${crypto.randomUUID()}`,
      kind: 'browser-element',
      browserRef: selectedRef.value,
      tagName,
      label: text,
      messageId: `browser-element:${selectedRef.value}`,
      text: descriptor
    })
  } finally {
    picking.value = false
  }
}

function handleToolbarPointerLeave(event: MouseEvent): void {
  toolbarPointerInside.value = false
  const toolbar = event.currentTarget as HTMLElement
  for (const button of toolbar.querySelectorAll<HTMLButtonElement>('.base-icon-button')) {
    button.dispatchEvent(new MouseEvent('mouseleave'))
    button.blur()
  }
}

function updateNavigationState(): void {
  const guest = webview.value
  canGoBack.value = guest?.canGoBack() ?? false
  canGoForward.value = guest?.canGoForward() ?? false
}

function reloadOrStop(): void {
  if (loading.value) webview.value?.stop()
  else webview.value?.reload()
}

async function captureForHuman(): Promise<void> {
  const guest = webview.value
  if (!guest || capturing.value) return
  capturing.value = true
  try {
    const image = await guest.capturePage()
    const link = document.createElement('a')
    link.href = image.toDataURL()
    link.download = `browser-${Date.now()}.png`
    link.click()
  } finally {
    capturing.value = false
  }
}

function toggleDevTools(): void {
  const guest = webview.value
  if (!guest) return
  if (guest.isDevToolsOpened()) guest.closeDevTools()
  else guest.openDevTools()
}

function appendLog(level: string, message: string, source?: string, line?: number): void {
  logs.value.push({ level, message, source, line, time: new Date().toISOString() })
  if (logs.value.length > 500) logs.value.splice(0, logs.value.length - 500)
}

let guestInitialization: Promise<void> | undefined

function ensureGuestInitialized(): Promise<void> {
  if (guestInitialization) return guestInitialization
  guestInitialization = applyEmulation()
    .then(async () => {
      if (webview.value?.getURL() === 'about:blank') await loadGuestUrl(initialUrl)
    })
    .catch((cause: unknown) => {
      guestInitialization = undefined
      throw cause
    })
  return guestInitialization
}

function emitState(): void {
  const guest = webview.value
  emit('state', {
    browserId: props.browserId,
    title: title.value,
    url: currentUrl.value || urlInput.value,
    loading: loading.value,
    webContentsId: guest ? getGuestWebContentsId() : undefined
  })
}

function onDomReady(): void {
  const guest = webview.value
  if (!guest || guest.getURL() === 'about:blank') return
  currentUrl.value = guest.getURL()
  urlInput.value = currentUrl.value
  title.value = guest.getTitle() || 'Browser'
  localStorage.setItem(urlStorageKey, currentUrl.value)
  updateNavigationState()
  loading.value = false
  error.value = ''
  failedUrl.value = ''
  emitState()
}

function attachGuestEvents(): void {
  const guest = webview.value
  if (!guest || guest.dataset.bound) return
  guest.dataset.bound = 'true'
  guest.addEventListener('dom-ready', () => {
    const operation = guest.getURL() === 'about:blank' ? ensureGuestInitialized() : applyEmulation()
    void operation
      .then(() => {
        if (guest.getURL() !== 'about:blank') onDomReady()
      })
      .catch((cause: unknown) => {
        error.value = cause instanceof Error ? cause.message : String(cause)
      })
  })
  guest.addEventListener('did-start-loading', () => {
    loading.value = true
    error.value = ''
    failedUrl.value = ''
    emitState()
  })
  guest.addEventListener('did-stop-loading', () => {
    loading.value = false
    updateNavigationState()
    emitState()
  })
  guest.addEventListener('did-fail-load', (event: Event) => {
    const detail = event as Event & {
      errorCode?: number
      errorDescription?: string
      validatedURL?: string
      isMainFrame?: boolean
    }
    if (detail.errorCode === -3 || detail.isMainFrame === false) return
    error.value = detail.errorDescription || 'Page failed to load'
    failedUrl.value = detail.validatedURL || urlInput.value
    appendLog('error', error.value, failedUrl.value)
    loading.value = false
  })
  guest.addEventListener('console-message', (event: Event) => {
    const detail = event as Event & {
      level?: number
      message?: string
      sourceId?: string
      line?: number
    }
    appendLog(
      ['debug', 'info', 'warning', 'error'][detail.level || 1] || 'info',
      detail.message || '',
      detail.sourceId,
      detail.line
    )
  })
  guest.addEventListener('did-navigate', onDomReady)
  guest.addEventListener('did-navigate-in-page', onDomReady)
  guest.addEventListener('devtools-opened', () => {
    devToolsOpen.value = true
  })
  guest.addEventListener('devtools-closed', () => {
    devToolsOpen.value = false
    void applyEmulation().catch((cause: unknown) => {
      error.value = cause instanceof Error ? cause.message : String(cause)
    })
  })
}

watch(webview, attachGuestEvents)

defineExpose({
  executeCommand,
  getWebContentsId: getGuestWebContentsId,
  stop: () => webview.value?.stop()
})

onBeforeUnmount(() => {
  void cancelElementPicker()
  webview.value?.stop()
})
</script>

<template>
  <section class="browser-preview" role="tabpanel">
    <div
      class="browser-preview__toolbar"
      :class="{ 'is-pointer-inside': toolbarPointerInside }"
      @mouseenter="toolbarPointerInside = true"
      @mouseleave="handleToolbarPointerLeave"
    >
      <div class="browser-preview__primary-controls">
        <BaseIconButton label="Back" size="small" :disabled="!canGoBack" @click="webview?.goBack()">
          <ArrowLeft :size="12" />
        </BaseIconButton>
        <BaseIconButton
          label="Forward"
          size="small"
          :disabled="!canGoForward"
          @click="webview?.goForward()"
        >
          <ArrowRight :size="12" />
        </BaseIconButton>
        <BaseIconButton
          :label="loading ? 'Stop loading' : 'Reload'"
          size="small"
          :active="loading"
          @click="reloadOrStop"
        >
          <X v-if="loading" :size="12" />
          <RefreshCw v-else :size="12" />
        </BaseIconButton>
        <form @submit.prevent="navigate">
          <Input
            v-model="urlInput"
            class="browser-preview__url-input"
            aria-label="Preview URL"
            :spellcheck="false"
          />
        </form>
        <BaseIconButton label="Pick element" size="small" :active="picking" @click="pickElement">
          <Crosshair :size="12" />
        </BaseIconButton>
        <BaseIconButton
          label="Toggle DevTools"
          size="small"
          :active="devToolsOpen"
          @click="toggleDevTools"
        >
          <Code2 :size="12" />
        </BaseIconButton>
        <BaseIconButton
          :label="showDeviceToolbar ? 'Hide device toolbar' : 'Show device toolbar'"
          size="small"
          :active="showDeviceToolbar"
          @click="toggleDeviceToolbar"
        >
          <MonitorSmartphone :size="12" />
        </BaseIconButton>
        <BaseIconButton
          label="Capture screenshot"
          size="small"
          :active="capturing"
          :disabled="capturing"
          @click="captureForHuman"
        >
          <LoaderCircle v-if="capturing" class="browser-preview__spin" :size="12" />
          <Camera v-else :size="12" />
        </BaseIconButton>
      </div>
      <div v-if="showDeviceToolbar" class="browser-preview__device-controls">
        <Monitor v-if="!emulation.enabled" aria-hidden="true" :size="12" />
        <Smartphone v-else aria-hidden="true" :size="12" />
        <Select :model-value="devicePreset" @update:model-value="selectDevicePreset">
          <SelectTrigger
            class="browser-preview__device-select"
            size="sm"
            aria-label="Device emulation"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="desktop">Desktop</SelectItem>
              <SelectItem value="responsive">Responsive</SelectItem>
              <SelectItem value="iphone-se">iPhone SE</SelectItem>
              <SelectItem value="iphone-15">iPhone 15</SelectItem>
              <SelectItem value="pixel-7">Pixel 7</SelectItem>
              <SelectItem value="ipad">iPad</SelectItem>
            </SelectGroup>
          </SelectContent>
        </Select>
        <template v-if="emulation.enabled">
          <Input
            v-model="emulation.width"
            class="browser-preview__viewport-input"
            type="number"
            min="240"
            max="2560"
            aria-label="Viewport width"
            @change="updateResponsiveSize"
          />
          <span aria-hidden="true">×</span>
          <Input
            v-model="emulation.height"
            class="browser-preview__viewport-input"
            type="number"
            min="240"
            max="2560"
            aria-label="Viewport height"
            @change="updateResponsiveSize"
          />
          <span class="browser-preview__device-meta">DPR {{ emulation.deviceScaleFactor }}</span>
          <span v-if="emulation.touch" class="browser-preview__device-meta">Touch</span>
          <BaseIconButton label="Rotate device" size="small" @click="rotateDevice">
            <RotateCw :size="12" />
          </BaseIconButton>
        </template>
      </div>
    </div>
    <div
      class="browser-preview__surface"
      :class="{ 'browser-preview__surface--emulating': emulation.enabled }"
    >
      <div class="browser-preview__device-frame" :style="frameStyle">
        <div v-if="loading" class="browser-preview__progress" aria-label="Page loading" />
        <webview
          ref="webview"
          allowpopups
          partition="browser-preview"
          webpreferences="contextIsolation=yes,sandbox=yes"
          src="about:blank"
        />
        <div v-if="!loading && error" class="browser-preview__failure" role="alert">
          <CircleAlert aria-hidden="true" />
          <h2>Page unavailable</h2>
          <p>{{ error }}</p>
          <code v-if="failedUrl">{{ failedUrl }}</code>
          <button type="button" @click="navigate"><RefreshCw /> Retry</button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped lang="scss">
.base-icon-button {
  flex-shrink: 0;
}

.browser-preview {
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--color-surface);
}
.browser-preview__toolbar {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background);
}
.browser-preview__primary-controls {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  min-width: 0;
  overflow-x: auto;
}
.browser-preview__toolbar form {
  flex: 1 1 auto;
  min-width: 120px;
}
.browser-preview__url-input {
  flex: 1;
  width: 100%;
  height: 24px;
  padding: 0 6px;
  font-size: 11px;
}
.browser-preview__device-controls {
  display: flex;
  flex: none;
  justify-content: center;
  align-items: center;
  gap: var(--space-2);
  padding-top: 4px;
  overflow-x: auto;
  min-height: 24px;
  color: var(--color-muted-foreground);
  font-size: 11px;
  border-top: 1px solid var(--color-border);
}
.browser-preview__device-controls > svg {
  flex: none;
  width: 15px;
  height: 15px;
}
.browser-preview__device-select {
  width: 104px;
  height: 22px;
  min-height: 22px;
  padding: 0 5px;
  font-size: 11px;
}
.browser-preview__viewport-input {
  width: 82px;
  height: 22px;
  padding: 0 4px;
  font-size: 11px;
  text-align: center;
}
.browser-preview__device-meta {
  white-space: nowrap;
}
.browser-preview :deep(.base-icon-button svg) {
  width: 14px;
  height: 14px;
}
.browser-preview__toolbar:not(.is-pointer-inside) :deep(.base-icon-button:hover:not(.is-active)) {
  color: var(--color-text-muted);
  background: transparent;
  border-color: transparent;
}
.browser-preview__surface {
  position: relative;
  display: flex;
  flex: 1;
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
  overflow: auto;
}
.browser-preview__surface--emulating {
  padding: 16px;
  background: color-mix(in srgb, var(--color-muted) 48%, var(--color-surface));
}
.browser-preview__device-frame {
  position: relative;
  flex: none;
  min-width: 0;
  overflow: hidden;
  background: white;
}
.browser-preview__surface--emulating .browser-preview__device-frame {
  border: 1px solid var(--color-border);
  box-shadow: 0 2px 8px rgb(0 0 0 / 16%);
}
.browser-preview__progress {
  position: absolute;
  z-index: 3;
  top: 0;
  right: 0;
  left: 0;
  height: 2px;
  overflow: hidden;
  background: color-mix(in srgb, var(--color-primary) 18%, transparent);
}
.browser-preview__progress::after {
  position: absolute;
  width: 38%;
  height: 100%;
  background: var(--color-primary);
  content: '';
  animation: browser-progress 1.1s ease-in-out infinite;
}
.browser-preview__surface webview {
  display: flex;
  width: 100%;
  height: 100%;
}
.browser-preview__spin {
  width: 14px;
  animation: spin 1s linear infinite;
}
.browser-preview__failure {
  position: absolute;
  z-index: 2;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: var(--space-6);
  color: var(--color-foreground);
  background: var(--color-surface);
  text-align: center;
}
.browser-preview__failure > svg {
  width: 28px;
  height: 28px;
  color: var(--color-destructive);
}
.browser-preview__failure h2,
.browser-preview__failure p {
  margin: 0;
}
.browser-preview__failure h2 {
  font-size: 15px;
}
.browser-preview__failure p,
.browser-preview__failure code {
  max-width: min(100%, 560px);
  color: var(--color-muted-foreground);
  font-size: 12px;
  overflow-wrap: anywhere;
}
.browser-preview__failure button {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  margin-top: var(--space-2);
  padding: 6px 10px;
  border: 1px solid var(--color-border);
  border-radius: 5px;
  color: var(--color-foreground);
  background: var(--color-background);
}
.browser-preview__failure button:hover {
  background: var(--color-muted);
}
.browser-preview__failure button svg {
  width: 14px;
  height: 14px;
}
.browser-preview__selection {
  padding: 4px 10px;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-muted-foreground);
  font-size: 12px;
}
@keyframes browser-progress {
  from {
    transform: translateX(-110%);
  }
  to {
    transform: translateX(300%);
  }
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
