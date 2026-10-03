import type { Coordinate, DeliveryStop } from '../types'

export const sampleDepot: Coordinate = {
  lat: 1.3344,
  lng: 103.7437,
}

export const defaultStops: DeliveryStop[] = [
  {
    id: 'AMK',
    name: 'Ang Mo Kio Central',
    lat: 1.3691,
    lng: 103.8454,
    service_minutes: 8,
    cold_chain_priority: 2,
    window_end: '14:30',
  },
]

export const sampleStops: DeliveryStop[] = [
  {
    id: 'NUH',
    name: 'National University Hospital',
    lat: 1.2937,
    lng: 103.7831,
    service_minutes: 12,
    cold_chain_priority: 1,
    window_end: '10:00',
  },
  {
    id: 'MBFC',
    name: 'Marina Bay Financial Centre',
    lat: 1.2799,
    lng: 103.8545,
    service_minutes: 10,
    cold_chain_priority: 3,
    window_end: '11:30',
  },
  {
    id: 'TAMP',
    name: 'Tampines Regional Centre',
    lat: 1.3525,
    lng: 103.9446,
    service_minutes: 10,
    cold_chain_priority: 1,
    window_end: '12:30',
  },
  {
    id: 'WDL',
    name: 'Woodlands Health Campus',
    lat: 1.4270,
    lng: 103.7865,
    service_minutes: 15,
    cold_chain_priority: 1,
    window_end: '13:00',
  },
  {
    id: 'AMK',
    name: 'Ang Mo Kio Central',
    lat: 1.3691,
    lng: 103.8454,
    service_minutes: 8,
    cold_chain_priority: 2,
    window_end: '14:30',
  },
]
