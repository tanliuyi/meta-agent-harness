const SEARCH_URL = 'https://www.google.com/search'

function validateHttpUrl(url: URL): string {
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP(S) URLs are allowed')
  }
  if (url.username || url.password) {
    throw new Error('URLs containing credentials are not allowed')
  }
  return url.toString()
}

function looksLikeHost(value: string): boolean {
  const host = value.split(/[/?#]/, 1)[0]
  if (host.includes('@')) return false
  const hostname = host
    .replace(/^\[|\](?::\d+)?$/g, '')
    .replace(/:\d+$/, '')
    .toLowerCase()
  return (
    hostname === 'localhost' ||
    hostname.includes('.') ||
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
    host.startsWith('[')
  )
}

function usesLocalHttp(value: string): boolean {
  try {
    const hostname = new URL(`http://${value}`).hostname
    return (
      hostname === 'localhost' ||
      hostname === '[::1]' ||
      hostname === '0.0.0.0' ||
      /^127\./.test(hostname)
    )
  } catch {
    return false
  }
}

export function resolveBrowserAddress(value: unknown): string {
  const address = typeof value === 'string' ? value.trim() : ''
  if (!address) throw new Error('Enter a URL or search term')

  if (!/\s/.test(address) && looksLikeHost(address)) {
    const protocol = usesLocalHttp(address) ? 'http' : 'https'
    return validateHttpUrl(new URL(`${protocol}://${address}`))
  }

  if (/^[a-z][a-z\d+.-]*:/i.test(address)) {
    return validateHttpUrl(new URL(address))
  }

  const search = new URL(SEARCH_URL)
  search.searchParams.set('q', address)
  return search.toString()
}
