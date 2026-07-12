/**
 * Desktop extension panel projection types.
 */

export interface DesktopExtensionWebviewPanelPermissions {
  /** Allow scripts inside the panel iframe. Defaults to false. */
  enableScripts?: boolean
  /** Allow form submission inside the panel iframe. */
  forms?: boolean
  /** Allow popups from the panel iframe. */
  popups?: boolean
  /** Allow downloads from the panel iframe. */
  downloads?: boolean
  /** Allow same-origin iframe behavior. Only honored for URL panels. */
  sameOrigin?: boolean
}

/** Localhost port mapping for desktop webview panels. */
export interface DesktopExtensionWebviewPortMapping {
  /** Localhost port used by webview content. */
  webviewPort: number
  /** Destination localhost port on the extension host side. */
  extensionHostPort: number
}

/** Source for a desktop extension webview panel. */
export type DesktopExtensionWebviewPanelSource =
  | {
      type: 'native'
      /** Host-owned renderer capability; extensions cannot provide component code. */
      component: 'memory' | 'browser-preview'
    }
  | {
      type: 'url'
      url: string
      permissions?: DesktopExtensionWebviewPanelPermissions
      portMapping?: DesktopExtensionWebviewPortMapping[]
    }
  | {
      type: 'html'
      html: string
      baseUrl?: string
      permissions?: DesktopExtensionWebviewPanelPermissions
      portMapping?: DesktopExtensionWebviewPortMapping[]
    }

/** Desktop extension webview panel state projected to renderer. */
export interface DesktopExtensionWebviewPanel {
  /** Stable extension-provided panel id. */
  id: string
  /** Stable view type used for serializer-like restore flows. Defaults to the panel id. */
  viewType?: string
  /** User-visible tab title. */
  title: string
  /** Optional icon name understood by the desktop host. */
  icon?: string
  /** Optional order among extension-provided panels. */
  order?: number
  /** Keep the iframe alive when the panel tab is hidden. Defaults to false. */
  retainContextWhenHidden?: boolean
  /** Web content to render inside the panel. */
  source: DesktopExtensionWebviewPanelSource
}

/** Host-side resource made available to desktop webview panels through an opaque URI token. */
export interface DesktopExtensionWebviewResource {
  /** Opaque, unguessable resource token used in pi-webview-resource:// URLs. */
  token: string
  /** Absolute local file path. Kept in main/worker only; never needed by renderer. */
  path?: string
  /** Host-owned resource body. Used for built-in resources that must not go through the filesystem. */
  content?: string
  /** MIME for host-owned resource body. */
  contentType?: string
  /** Thread that registered this resource. */
  threadId: string
}

/** Desktop webview panel lifecycle event sent from host UI to extension runtime. */
export type DesktopExtensionPanelLifecycle =
  | {
      type: 'viewStateChanged'
      panelId: string
      visible: boolean
      active: boolean
    }
  | {
      type: 'disposed'
      panelId: string
      reason: 'removed' | 'rendererUnmount' | 'threadRestart' | 'userClosed'
    }

/** Desktop webview panel restore request sent from host UI to extension runtime. */
export interface DesktopExtensionPanelRestore {
  panelId: string
  viewType: string
  state: unknown
}

/** Desktop extension webview panel update patch. */
export type DesktopExtensionWebviewPanelPatch = Partial<Omit<DesktopExtensionWebviewPanel, 'id'>>

/** Desktop extension panel projection events. */
export type ExtensionPanelProjection =
  | {
      type: 'extensionPanel.registered'
      panel: DesktopExtensionWebviewPanel
    }
  | {
      type: 'extensionPanel.updated'
      panelId: string
      patch: DesktopExtensionWebviewPanelPatch
    }
  | {
      type: 'extensionPanel.message'
      panelId: string
      message: unknown
    }
  | {
      type: 'extensionPanel.removed'
      panelId: string
    }
  | {
      type: 'extensionPanel.stateUpdated'
      panelId: string
      state: unknown
    }
  | {
      type: 'extensionPanel.resourceRegistered'
      resource: DesktopExtensionWebviewResource
    }
