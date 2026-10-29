import assert from 'node:assert/strict'
import test from 'node:test'
import { depotFromPlace, validDepot } from '../src/lib/depot.ts'

const place = {
  key: '018982|Marina Bay Financial Centre',
  name: 'Marina Bay Financial Centre',
  address: '12 Marina Blvd, 018982',
  postal: '018982',
  lng: 103.854,
  lat: 1.2793,
}
const sample = { id: 'D', name: 'Jurong Cold Store', address: '9 Fishery Port Rd, 619742', lng: 103.7205, lat: 1.3088 }

test('selected depot has its own road-matrix identity and retains OneMap coordinates', () => {
  const depot = depotFromPlace(place)
  assert.equal(depot.id, 'D:103.854000,1.279300')
  assert.notEqual(depot.id, 'D')
  assert.equal(depot.name, place.name)
  assert.equal(depot.address, place.address)
  assert.equal(depot.lng, place.lng)
  assert.equal(depot.lat, place.lat)
  assert.equal(validDepot(depot, sample), true)
  assert.equal(validDepot(sample, sample), true)
})

test('road-matrix identity changes with coordinates, but not the place label', () => {
  const original = depotFromPlace(place)
  assert.equal(depotFromPlace({ ...place, name: 'Renamed building' }).id, original.id)
  assert.notEqual(depotFromPlace({ ...place, lng: place.lng + 0.001 }).id, original.id)
})

test('invalid saved depot cannot silently replace the sample depot', () => {
  assert.equal(validDepot(null, sample), false)
  assert.equal(validDepot({ ...depotFromPlace(place), lat: 0 }, sample), false)
  assert.equal(validDepot({ ...depotFromPlace(place), name: '' }, sample), false)
  assert.equal(validDepot({ ...depotFromPlace(place), id: 'NUH' }, sample), false)
  assert.equal(validDepot({ ...depotFromPlace(place), id: 'D' }, sample), false)
  assert.equal(validDepot({ ...depotFromPlace(place), id: 'D:103.720500,1.308800' }, sample), false)
  assert.equal(validDepot({ ...depotFromPlace(place), id: 'D:NaN,NaN', lng: Number.NaN, lat: Number.NaN }, sample), false)
})
