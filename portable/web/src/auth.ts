import Keycloak from 'keycloak-js'
import type { AppUser, AuthConfig } from './types'

export interface AuthController {
  config: AuthConfig
  user: AppUser | null
  token: () => Promise<string | undefined>
  login: () => Promise<void>
  logout: () => Promise<void>
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }))
    throw new Error(payload.error || 'Ошибка авторизации')
  }
  return response.json() as Promise<T>
}

export async function initializeAuth(): Promise<AuthController> {
  const config = await parseResponse<AuthConfig>(await fetch('/api/auth/config'))
  if (!config.enabled) {
    const user = await parseResponse<AppUser>(await fetch('/api/auth/me'))
    return { config, user, token: async () => undefined, login: async () => undefined, logout: async () => undefined }
  }
  if (!config.url || !config.realm || !config.clientId) throw new Error('Конфигурация Keycloak заполнена не полностью')

  const keycloak = new Keycloak({ url: config.url, realm: config.realm, clientId: config.clientId })
  const authenticated = await keycloak.init({
    onLoad: 'check-sso',
    pkceMethod: 'S256',
    checkLoginIframe: false,
    redirectUri: `${window.location.origin}${window.location.pathname}`,
  })
  const login = async () => {
    await keycloak.login({ redirectUri: `${window.location.origin}${window.location.pathname}` })
  }
  if (!authenticated || !keycloak.token) {
    return { config, user: null, token: async () => undefined, login, logout: async () => undefined }
  }

  const establishSession = async () => {
    if (!keycloak.token) throw new Error('Токен доступа отсутствует')
    return parseResponse<AppUser>(await fetch('/api/auth/session', {
      method: 'POST',
      headers: { Authorization: `Bearer ${keycloak.token}` },
    }))
  }
  const user = await establishSession()

  const token = async () => {
    try {
      await keycloak.updateToken(60)
      return keycloak.token
    } catch {
      await keycloak.login({ redirectUri: `${window.location.origin}${window.location.pathname}` })
      return undefined
    }
  }

  const refreshTimer = window.setInterval(() => {
    void token().then((value) => value ? establishSession() : undefined).catch(() => undefined)
  }, 60_000)

  const logout = async () => {
    window.clearInterval(refreshTimer)
    await fetch('/api/auth/logout', { method: 'POST', headers: keycloak.token ? { Authorization: `Bearer ${keycloak.token}` } : {} }).catch(() => undefined)
    await keycloak.logout({ redirectUri: window.location.origin })
  }

  return { config, user, token, login, logout }
}
