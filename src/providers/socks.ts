import {
  getGlobalDispatcher,
  setGlobalDispatcher,
  Socks5ProxyAgent,
  type Dispatcher,
} from 'undici'

export function normalizeSocksProxyUrl(proxyUrl: string): string {
  return proxyUrl.replace(/^socks5h:\/\//i, 'socks5://')
}

export function getProxyUrlFromEnv(env: Record<string, string | undefined>): string | undefined {
  return env.SOCKS5_PROXY || env.SOCKS_PROXY || env.ALL_PROXY
}

export async function withOptionalSocksProxy<T>(proxyUrl: string | undefined, run: () => Promise<T>): Promise<T> {
  if (!proxyUrl) {
    return run()
  }

  const previousDispatcher: Dispatcher = getGlobalDispatcher()
  const agent = new Socks5ProxyAgent(normalizeSocksProxyUrl(proxyUrl))
  setGlobalDispatcher(agent)

  try {
    return await run()
  } finally {
    setGlobalDispatcher(previousDispatcher)
    await agent.close()
  }
}
