import { Amplify } from 'aws-amplify'
import { confirmSignIn, fetchAuthSession, signIn, signOut } from 'aws-amplify/auth'
import type { User } from '../components/Account'

/**
 * Real sign-in with the Cognito user pool from infra/ (terraform output
 * frontend_env). Without these build settings the console keeps its demo
 * account only. An admin creates every account; there is no sign-up.
 */
const USER_POOL_ID = import.meta.env.VITE_COGNITO_USER_POOL_ID as string | undefined
const CLIENT_ID = import.meta.env.VITE_COGNITO_CLIENT_ID as string | undefined

export const AUTH_ENABLED = Boolean(USER_POOL_ID && CLIENT_ID)

if (AUTH_ENABLED) {
  Amplify.configure({ Auth: { Cognito: { userPoolId: USER_POOL_ID!, userPoolClientId: CLIENT_ID! } } })
}

/** "tan.wei.ling@example.com" -> "Tan Wei Ling", for accounts created without a name. */
export function nameFromEmail(email: string) {
  const local = email.split('@')[0] ?? ''
  const words = local.split(/[._\-+]+/).filter(Boolean)
  return words.length ? words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ') : email
}

/** The console's user from the ID token's claims. */
export function userFromClaims(claims: Record<string, unknown>): User {
  const email = typeof claims.email === 'string' ? claims.email : ''
  const name = typeof claims.name === 'string' && claims.name.trim() ? claims.name.trim() : nameFromEmail(email)
  const groups = Array.isArray(claims['cognito:groups']) ? claims['cognito:groups'] : []
  const initials =
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0].toUpperCase())
      .join('') || '?'
  return {
    name,
    initials,
    role: groups.includes('admin') ? 'Admin' : 'Dispatcher',
    email,
    depot: '',
    account: 'cognito',
  }
}

/** The signed-in user, or null without a valid (or refreshable) session. */
export async function currentUser(): Promise<User | null> {
  if (!AUTH_ENABLED) return null
  try {
    const { tokens } = await fetchAuthSession()
    return tokens?.idToken ? userFromClaims(tokens.idToken.payload) : null
  } catch {
    return null
  }
}

/** The ID token for API calls: it carries the email and groups the backend reads. */
export async function idToken(): Promise<string | null> {
  if (!AUTH_ENABLED) return null
  const { tokens } = await fetchAuthSession()
  return tokens?.idToken?.toString() ?? null
}

export type SignInResult = { user: User } | { needsNewPassword: true }

export async function signInWithPassword(email: string, password: string): Promise<SignInResult> {
  // a stale session from another account would make Cognito refuse the new one
  await signOut().catch(() => undefined)
  const { isSignedIn, nextStep } = await signIn({ username: email.trim(), password })
  return finish(isSignedIn, nextStep.signInStep)
}

/** First sign-in of an account an admin created: replace the temporary password. */
export async function setNewPassword(password: string): Promise<SignInResult> {
  const { isSignedIn, nextStep } = await confirmSignIn({ challengeResponse: password })
  return finish(isSignedIn, nextStep.signInStep)
}

async function finish(isSignedIn: boolean, step: string): Promise<SignInResult> {
  if (step === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') return { needsNewPassword: true }
  const user = isSignedIn ? await currentUser() : null
  if (!user) throw new Error(step === 'RESET_PASSWORD' ? 'PasswordResetRequiredException' : `Sign-in needs a step the console does not support (${step}).`)
  return { user }
}

export async function signOutUser() {
  if (AUTH_ENABLED) await signOut().catch(() => undefined)
}

/** Cognito's errors in plain words. */
export function signInError(error: unknown): string {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : String(error)
  if (name === 'NotAuthorizedException' || name === 'UserNotFoundException') return 'Wrong email or password.'
  if (name === 'InvalidPasswordException' || name === 'InvalidParameterException')
    return 'Choose a password of at least 10 characters with upper and lower case letters and a number.'
  if (name === 'PasswordResetRequiredException' || message === 'PasswordResetRequiredException')
    return 'This account needs a password reset. Ask your admin for a new temporary password.'
  if (name === 'LimitExceededException' || name === 'TooManyRequestsException') return 'Too many attempts. Wait a minute and try again.'
  if (name === 'NetworkError' || /network|fetch/i.test(message)) return 'Could not reach the sign-in service. Check your connection.'
  return message || 'Sign-in failed.'
}
