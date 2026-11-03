import { idToken } from './auth'

/**
 * Calls to our own API (infra/: API Gateway in front of the backend and the
 * cloud planner) as the signed-in user, with their Cognito ID token.
 */
export const API_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, '')

/** An API error in words: the backend's own detail when it sends one. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const expiredListeners = new Set<() => void>()

/**
 * Tell `listener` when the session has ended under the console: the API turned
 * the token down, or Cognito would not refresh it. The console then signs out
 * and asks to sign in again, keeping the plan on screen.
 */
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener)
  return () => {
    expiredListeners.delete(listener)
  }
}

function sessionExpired(message: string) {
  expiredListeners.forEach((l) => l())
  return new ApiError(message, 401)
}

interface CallOptions {
  /** what signing in again would let the user do, for the message when the token is missing or expired */
  signInTo?: string
  timeoutMs?: number
}

export async function api<T>(path: string, init: RequestInit = {}, { signInTo = 'use your saved runs', timeoutMs = 15_000 }: CallOptions = {}): Promise<T> {
  if (!API_URL) throw new ApiError('The ColdRoute API is not set up for this console.', 0)
  const signIn = `Sign in again to ${signInTo}.`
  let token: string | null
  try {
    token = await idToken()
  } catch (e) {
    // Cognito refused to refresh the session; anything else is the network
    if ((e as Error).name === 'NotAuthorizedException') throw sessionExpired(signIn)
    throw new ApiError('Could not reach the sign-in service. Check your connection.', 0)
  }
  if (!token) throw sessionExpired(signIn)
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      signal: ctl.signal,
      headers: { ...(init.body ? { 'content-type': 'application/json' } : {}), authorization: `Bearer ${token}` },
    })
    if (res.status === 204) return undefined as T
    const body = await res.json().catch(() => null)
    if (res.status === 401) throw sessionExpired(signIn)
    if (!res.ok) {
      const detail = body && typeof body.detail === 'string' ? body.detail : null
      throw new ApiError(detail ?? `The ColdRoute API answered ${res.status}.`, res.status)
    }
    return body as T
  } catch (e) {
    if (e instanceof ApiError) throw e
    throw new ApiError(ctl.signal.aborted ? 'The ColdRoute API did not answer in time.' : 'Could not reach the ColdRoute API.', 0)
  } finally {
    clearTimeout(timer)
  }
}
