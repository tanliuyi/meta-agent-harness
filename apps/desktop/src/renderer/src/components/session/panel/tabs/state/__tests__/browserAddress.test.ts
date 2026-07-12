import { describe, expect, it } from 'vitest'
import { resolveBrowserAddress } from '../browserAddress'

describe('browser address bar', () => {
  it('keeps valid HTTP(S) URLs and trims surrounding whitespace', () => {
    expect(resolveBrowserAddress('  https://example.com/docs?q=browser  ')).toBe(
      'https://example.com/docs?q=browser'
    )
    expect(resolveBrowserAddress('http://example.com')).toBe('http://example.com/')
  })

  it('expands host-like input into a URL', () => {
    expect(resolveBrowserAddress('example.com/docs')).toBe('https://example.com/docs')
    expect(resolveBrowserAddress('localhost:5173/app')).toBe('http://localhost:5173/app')
    expect(resolveBrowserAddress('LOCALHOST:5173/app')).toBe('http://localhost:5173/app')
    expect(resolveBrowserAddress('127.0.0.1:3000')).toBe('http://127.0.0.1:3000/')
    expect(resolveBrowserAddress('[::1]:8080')).toBe('http://[::1]:8080/')
  })

  it('turns non-host input into a Google search', () => {
    expect(resolveBrowserAddress('browser preview interaction')).toBe(
      'https://www.google.com/search?q=browser+preview+interaction'
    )
    expect(resolveBrowserAddress('vue')).toBe('https://www.google.com/search?q=vue')
    expect(resolveBrowserAddress('user@example.com')).toBe(
      'https://www.google.com/search?q=user%40example.com'
    )
  })

  it('rejects empty, unsafe, and credentialed URLs', () => {
    expect(() => resolveBrowserAddress('   ')).toThrow('Enter a URL or search term')
    expect(() => resolveBrowserAddress('file:///tmp/example.html')).toThrow(
      'Only HTTP(S) URLs are allowed'
    )
    expect(() => resolveBrowserAddress('https://user:pass@example.com')).toThrow(
      'URLs containing credentials are not allowed'
    )
    expect(() => resolveBrowserAddress('https://user@example.com')).toThrow(
      'URLs containing credentials are not allowed'
    )
  })
})
