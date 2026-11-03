import { afterEach, describe, expect, it, vi } from 'vitest'
import { SEARCH_TIMEOUT_MS, searchPlaces } from '../places'

/** A fetch that never answers, but stops when its signal aborts. */
const hangingFetch = () =>
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    (_url, init) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal
        signal.addEventListener('abort', () => reject(signal.reason))
      }),
  )

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('searchPlaces', () => {
  it('gives up on a OneMap that does not answer', async () => {
    vi.useFakeTimers()
    hangingFetch()
    const search = searchPlaces('ion orchard')
    const failed = expect(search).rejects.toThrow('OneMap did not answer in time')
    await vi.advanceTimersByTimeAsync(SEARCH_TIMEOUT_MS)
    await failed
  })

  it('still rejects as an AbortError when a newer query cancels it', async () => {
    hangingFetch()
    const ctrl = new AbortController()
    const search = searchPlaces('ion orchard', ctrl.signal)
    ctrl.abort()
    await expect(search).rejects.toMatchObject({ name: 'AbortError' })
  })
})
