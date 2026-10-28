import { describe, expect, it } from 'vitest'
import { DEPARTURE, DEPOT, SAMPLE_STOPS } from '../../../frontend/src/data/sample'
import { MAX_STOPS, isBadRequest, parseRequest } from '../request'

const RUN = { depot: DEPOT, stops: SAMPLE_STOPS, departure: DEPARTURE, profile: 'pharma' }
const [nuh] = SAMPLE_STOPS

/** What parseRequest refuses `body` with. */
const refusal = (body: unknown) => {
  try {
    parseRequest(body)
  } catch (e) {
    expect(isBadRequest(e)).toBe(true)
    return (e as Error).message
  }
  throw new Error('accepted')
}

describe('parseRequest', () => {
  it('reads the sample run as the console sends it', () => {
    expect(parseRequest(JSON.parse(JSON.stringify(RUN)))).toEqual(RUN)
  })

  it('keeps what a stop and its carpark have, and drops the rest', () => {
    const parking = { ...nuh.parking, code: 'A1', agency: 'URA', live: { free: 12 }, estimated: false, photo: 'x' }
    const read = parseRequest({ ...RUN, stops: [{ ...nuh, parking, notes: 'x'.repeat(5000) }] })
    expect(read.stops[0]).toEqual({ ...nuh, parking: { ...nuh.parking, code: 'A1', agency: 'URA', live: { free: 12 }, estimated: false } })
  })

  it('says what is wrong with a run it cannot plan', () => {
    expect(refusal(null)).toBe('The run must be a JSON object.')
    expect(refusal({ ...RUN, depot: 'D' })).toBe('The run needs a depot.')
    expect(refusal({ ...RUN, stops: [] })).toBe(`The run needs 1 to ${MAX_STOPS} stops.`)
    expect(refusal({ ...RUN, stops: Array.from({ length: MAX_STOPS + 1 }, (_, i) => ({ ...nuh, id: `s${i}` })) })).toBe('The run needs 1 to 15 stops.')
    expect(refusal({ ...RUN, stops: [nuh, { ...SAMPLE_STOPS[1], id: nuh.id }] })).toBe('Every stop, and the depot, needs its own id.')
    expect(refusal({ ...RUN, stops: [{ ...nuh, id: DEPOT.id }] })).toBe('Every stop, and the depot, needs its own id.')
    expect(refusal({ ...RUN, stops: [{ ...nuh, lat: 3.1 }] })).toBe('Stop 1 latitude must be a number from 1.15 to 1.5.')
    expect(refusal({ ...RUN, stops: [nuh, { ...SAMPLE_STOPS[1], cargo: 'ICE' }] })).toBe('Stop 2 cargo must be one of PHARMA, FROZEN, CHILLED.')
    expect(refusal({ ...RUN, stops: [{ ...nuh, windowEnd: nuh.windowStart - 1 }] })).toBe('Stop 1 window end must be a number from 570 to 1440.')
    expect(refusal({ ...RUN, stops: [{ ...nuh, parking: undefined }] })).toBe('Stop 1 needs its parking.')
    expect(refusal({ ...RUN, stops: [{ ...nuh, parking: { ...nuh.parking, agency: 'HDB' } }] })).toBe('Stop 1 parking agency must be URA or LTA.')
    expect(refusal({ ...RUN, departure: '09:00' })).toBe('Departure must be a number from 0 to 1439.')
    expect(refusal({ ...RUN, departure: 24 * 60 })).toBe('Departure must be a number from 0 to 1439.')
    expect(refusal({ ...RUN, profile: 'slowest' })).toBe('Profile must be one of pharma, balanced, fastest.')
    expect(refusal({ ...RUN, profile: 'toString' })).toBe('Profile must be one of pharma, balanced, fastest.')
  })
})
