import { describe, expect, it } from 'vitest'
import { decideBrowserReveal } from '../browserRevealPolicy'

describe('browser tool reveal policy', () => {
  it('reveals the first open or navigate for the active thread', () => {
    expect(
      decideBrowserReveal({
        command: 'open',
        activeThread: true,
        browserVisible: false,
        panelOpen: false,
        autoRevealed: false,
        recentlyCollapsed: false
      })
    ).toBe('reveal')
    expect(
      decideBrowserReveal({
        command: 'navigate',
        activeThread: true,
        browserVisible: true,
        panelOpen: true,
        autoRevealed: true,
        recentlyCollapsed: false
      })
    ).toBe('background')
    expect(
      decideBrowserReveal({
        command: 'navigate',
        activeThread: true,
        browserVisible: false,
        panelOpen: false,
        autoRevealed: true,
        recentlyCollapsed: false
      })
    ).toBe('attention')
  })

  it('respects a recent manual collapse and marks visible operations for attention', () => {
    expect(
      decideBrowserReveal({
        command: 'navigate',
        activeThread: true,
        browserVisible: false,
        panelOpen: false,
        autoRevealed: false,
        recentlyCollapsed: true
      })
    ).toBe('attention')
    expect(
      decideBrowserReveal({
        command: 'action',
        activeThread: true,
        browserVisible: false,
        panelOpen: false,
        autoRevealed: true,
        recentlyCollapsed: false
      })
    ).toBe('attention')
    expect(
      decideBrowserReveal({
        command: 'set-viewport',
        activeThread: true,
        browserVisible: false,
        panelOpen: true,
        autoRevealed: true,
        recentlyCollapsed: false
      })
    ).toBe('reveal')
  })

  it('keeps read-only commands in the background and marks inactive threads', () => {
    for (const command of ['tabs', 'snapshot', 'inspect', 'logs', 'screenshot']) {
      expect(
        decideBrowserReveal({
          command,
          activeThread: true,
          browserVisible: false,
          panelOpen: false,
          autoRevealed: false,
          recentlyCollapsed: false
        })
      ).toBe('background')
    }
    expect(
      decideBrowserReveal({
        command: 'snapshot',
        activeThread: false,
        browserVisible: false,
        panelOpen: false,
        autoRevealed: false,
        recentlyCollapsed: false
      })
    ).toBe('attention')
  })

  it('marks a hidden Browser tab after the one-time reveal instead of going silent', () => {
    for (const panelOpen of [true, false]) {
      expect(
        decideBrowserReveal({
          command: 'navigate',
          activeThread: true,
          browserVisible: false,
          panelOpen,
          autoRevealed: true,
          recentlyCollapsed: false
        })
      ).toBe('attention')
    }
  })
})
