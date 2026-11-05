import { afterEach, describe, expect, it, vi } from 'vitest'

const amplify = vi.hoisted(() => ({
  configure: vi.fn(),
  signIn: vi.fn(),
  confirmSignIn: vi.fn(),
  signOut: vi.fn(),
  fetchAuthSession: vi.fn(),
}))
vi.mock('aws-amplify', () => ({ Amplify: { configure: amplify.configure } }))
vi.mock('aws-amplify/auth', () => ({
  signIn: amplify.signIn,
  confirmSignIn: amplify.confirmSignIn,
  signOut: amplify.signOut,
  fetchAuthSession: amplify.fetchAuthSession,
}))

/** auth.ts with or without a user pool in the build. */
async function load(withPool = true) {
  vi.resetModules()
  vi.stubEnv('VITE_COGNITO_USER_POOL_ID', withPool ? 'ap-southeast-1_test' : '')
  vi.stubEnv('VITE_COGNITO_CLIENT_ID', withPool ? 'client' : '')
  return import('../auth')
}

const session = (payload: Record<string, unknown>) =>
  amplify.fetchAuthSession.mockResolvedValue({ tokens: { idToken: { payload, toString: () => 'jwt' } } })

const named = (name: string, message = name) => Object.assign(new Error(message), { name })

afterEach(() => {
  vi.unstubAllEnvs()
  for (const fn of Object.values(amplify)) fn.mockReset()
})

describe('userFromClaims', () => {
  it('makes an admin of the admin group, and a dispatcher of everyone else', async () => {
    const { userFromClaims } = await load()
    expect(userFromClaims({ email: 'fiona.lim@coldroute.sg', 'cognito:groups': ['admin'] })).toEqual({
      name: 'Fiona Lim',
      initials: 'FL',
      role: 'Admin',
      email: 'fiona.lim@coldroute.sg',
      depot: '',
      account: 'cognito',
    })
    expect(userFromClaims({ email: 'driver@example.com' }).role).toBe('Dispatcher')
    expect(userFromClaims({ email: 'driver@example.com', 'cognito:groups': ['drivers'] }).role).toBe('Dispatcher')
  })

  it("prefers the account's own name", async () => {
    const { userFromClaims } = await load()
    expect(userFromClaims({ email: 'x@example.com', name: '  Tan Wei Ling ' })).toMatchObject({ name: 'Tan Wei Ling', initials: 'TW' })
  })

  it.each([
    ['tan.wei.ling@example.com', 'Tan Wei Ling'],
    ['e0000000@u.nus.edu', 'E0000000'],
    ['ops-team+sg@coldroute.sg', 'Ops Team Sg'],
    ['', ''],
  ])('names %s as %s', async (email, name) => {
    const { nameFromEmail } = await load()
    expect(nameFromEmail(email)).toBe(name)
  })
})

describe('signing in', () => {
  it('signs in and reads the user from the ID token', async () => {
    const { signInWithPassword } = await load()
    amplify.signOut.mockResolvedValue(undefined)
    amplify.signIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } })
    session({ email: 'manager@example.com', 'cognito:groups': ['admin'] })
    const result = await signInWithPassword(' manager@example.com ', 'Secret12345')
    expect(result).toEqual({ user: expect.objectContaining({ email: 'manager@example.com', role: 'Admin' }) })
    expect(amplify.signIn).toHaveBeenCalledWith({ username: 'manager@example.com', password: 'Secret12345' })
    // a session left from another account is ended first
    expect(amplify.signOut.mock.invocationCallOrder[0]).toBeLessThan(amplify.signIn.mock.invocationCallOrder[0])
  })

  it('asks for a new password on the first sign-in of an account an admin created', async () => {
    const { signInWithPassword, setNewPassword } = await load()
    amplify.signOut.mockResolvedValue(undefined)
    amplify.signIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED' } })
    expect(await signInWithPassword('new@example.com', 'Temp123456')).toEqual({ needsNewPassword: true })

    amplify.confirmSignIn.mockResolvedValue({ isSignedIn: true, nextStep: { signInStep: 'DONE' } })
    session({ email: 'new@example.com' })
    expect(await setNewPassword('Mine123456')).toEqual({ user: expect.objectContaining({ email: 'new@example.com', role: 'Dispatcher' }) })
    expect(amplify.confirmSignIn).toHaveBeenCalledWith({ challengeResponse: 'Mine123456' })
  })

  it('refuses a sign-in step the console cannot show', async () => {
    const { signInWithPassword } = await load()
    amplify.signOut.mockResolvedValue(undefined)
    amplify.signIn.mockResolvedValue({ isSignedIn: false, nextStep: { signInStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE' } })
    await expect(signInWithPassword('a@example.com', 'x')).rejects.toThrow(/does not support/)
  })

  it.each([
    [named('NotAuthorizedException', 'Incorrect username or password.'), 'Wrong email or password.'],
    [named('UserNotFoundException'), 'Wrong email or password.'],
    [named('InvalidPasswordException'), 'Choose a password of at least 10 characters with upper and lower case letters and a number.'],
    [named('PasswordResetRequiredException'), 'This account needs a password reset. Ask your admin for a new temporary password.'],
    [named('LimitExceededException'), 'Too many attempts. Wait a minute and try again.'],
    [new TypeError('Failed to fetch'), 'Could not reach the sign-in service. Check your connection.'],
  ])('explains %s', async (error, words) => {
    const { signInError } = await load()
    expect(signInError(error)).toBe(words)
  })
})

describe('without a user pool in the build', () => {
  it('stays on the demo account and never calls Cognito', async () => {
    const auth = await load(false)
    expect(auth.AUTH_ENABLED).toBe(false)
    expect(await auth.currentUser()).toBeNull()
    expect(await auth.idToken()).toBeNull()
    await auth.signOutUser()
    expect(amplify.configure).not.toHaveBeenCalled()
    expect(amplify.fetchAuthSession).not.toHaveBeenCalled()
    expect(amplify.signOut).not.toHaveBeenCalled()
  })

  it('configures Cognito once when the build has one', async () => {
    await load(true)
    expect(amplify.configure).toHaveBeenCalledWith({ Auth: { Cognito: { userPoolId: 'ap-southeast-1_test', userPoolClientId: 'client' } } })
  })

  it('treats a session that cannot be refreshed as signed out', async () => {
    const { currentUser } = await load()
    amplify.fetchAuthSession.mockRejectedValue(named('NotAuthorizedException', 'Refresh Token has expired'))
    expect(await currentUser()).toBeNull()
  })
})
