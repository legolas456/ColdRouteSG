import { fetchAuthSession } from 'aws-amplify/auth'

/**
 * Fetch wrapper for API Gateway routes protected by the Cognito JWT authorizer.
 * It retrieves the current Cognito access token and sends it as a Bearer token.
 */
export async function authenticatedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const session = await fetchAuthSession()
  const accessToken = session.tokens?.accessToken?.toString()

  if (!accessToken) {
    throw new Error('User is not authenticated')
  }

  const headers = new Headers(init.headers)
  headers.set('Authorization', `Bearer ${accessToken}`)

  return fetch(input, {
    ...init,
    headers,
  })
}
