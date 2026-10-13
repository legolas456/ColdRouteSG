import {
  CalendarOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  HistoryOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Empty,
  Flex,
  Modal,
  Space,
  Spin,
  Tag,
  Typography,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { RouteHistoryItem } from '../api/client'
import type { Coordinate, DeliveryStop } from '../types'

const { Text, Title } = Typography

export interface LoadedRoutePlan {
  depot: Coordinate
  depotName: string
  departureTime: string
  stops: DeliveryStop[]
  routeId: string
  createdAt: string
}

interface Props {
  open: boolean
  onClose: () => void
  onLoad: (plan: LoadedRoutePlan) => void
}

function singaporeDateTime(value?: string) {
  if (!value) return '—'
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(parsed)
}

function oneDecimal(value?: number) {
  return typeof value === 'number' ? value.toFixed(1) : '—'
}

function normalisePriority(value: number): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) return value
  if (value >= 0 && value <= 1) {
    if (value >= 0.75) return 1
    if (value >= 0.4) return 2
    return 3
  }
  return 2
}

function routeCanBeLoaded(item: RouteHistoryItem) {
  return Boolean(
    item.request?.depot
      && typeof item.request.depot.lat === 'number'
      && typeof item.request.depot.lng === 'number'
      && item.request?.stops?.length,
  )
}

export function LoadRouteHistoryModal({ open, onClose, onLoad }: Props) {
  const [routes, setRoutes] = useState<RouteHistoryItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingRouteId, setLoadingRouteId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await api.routeHistory(50)
      setRoutes(response.routes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load route history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadHistory()
  }, [open, loadHistory])

  const loadRoute = async (routeId: string) => {
    setLoadingRouteId(routeId)
    setError(null)
    try {
      const item = await api.routeHistoryItem(routeId)
      const request = item.request

      if (!request?.depot || !request.stops?.length) {
        throw new Error('This saved route does not contain the original editable location details.')
      }

      const stops: DeliveryStop[] = request.stops.map((stop, index) => ({
        id: stop.id || `HISTORY-${routeId}-${index + 1}`,
        name: stop.name || `Delivery ${index + 1}`,
        lat: Number(stop.lat),
        lng: Number(stop.lng),
        service_minutes: Math.min(180, Math.max(0, Number(stop.service_minutes ?? 0))),
        cold_chain_priority: normalisePriority(Number(stop.cold_chain_priority)),
        window_end: stop.window_end ?? null,
      }))

      onLoad({
        depot: {
          lat: Number(request.depot.lat),
          lng: Number(request.depot.lng),
        },
        depotName: request.depot_name || item.depot_name || 'Saved depot',
        departureTime: request.departure_time || item.departure_time || '08:00',
        stops,
        routeId: item.route_id,
        createdAt: item.created_at,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load the selected route')
    } finally {
      setLoadingRouteId(null)
    }
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={780}
      centered
      destroyOnClose
      title={(
        <Space size={8}>
          <HistoryOutlined />
          <span>Load from route history</span>
        </Space>
      )}
    >
      <Flex justify="space-between" align="flex-start" gap={12} wrap style={{ marginBottom: 16 }}>
        <div>
          <Title level={5} style={{ margin: 0 }}>Choose a previous delivery plan</Title>
          <Text type="secondary">
            The saved depot, departure time, locations, service times, delivery windows and priorities will be restored to the input form.
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void loadHistory()}>
          Refresh
        </Button>
      </Flex>

      {error && (
        <Alert
          type="error"
          showIcon
          closable
          message="Unable to load saved route"
          description={error}
          onClose={() => setError(null)}
          style={{ marginBottom: 16 }}
        />
      )}

      {loading ? (
        <Flex vertical align="center" justify="center" gap={12} style={{ minHeight: 220 }}>
          <Spin size="large" />
          <Text type="secondary">Loading your saved routes…</Text>
        </Flex>
      ) : routes.length === 0 ? (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="No saved routes are available yet."
        />
      ) : (
        <Space direction="vertical" size={12} style={{ width: '100%', maxHeight: '56vh', overflowY: 'auto', paddingRight: 4 }}>
          {routes.map((item) => {
            const canLoad = routeCanBeLoaded(item)
            return (
              <Card key={item.route_id} size="small" bordered>
                <Flex justify="space-between" align="center" gap={16} wrap>
                  <div style={{ flex: '1 1 420px', minWidth: 0 }}>
                    <Flex align="center" gap={8} wrap style={{ marginBottom: 6 }}>
                      <EnvironmentOutlined />
                      <Text strong>{item.request?.depot_name || item.depot_name || 'Saved route'}</Text>
                      <Tag>{item.stop_count ?? item.request?.stops?.length ?? 0} stops</Tag>
                    </Flex>
                    <Flex gap={16} wrap>
                      <Text type="secondary"><CalendarOutlined /> {singaporeDateTime(item.created_at)} SGT</Text>
                      <Text type="secondary"><ClockCircleOutlined /> Departure {item.request?.departure_time || item.departure_time || '—'}</Text>
                      <Text type="secondary">{oneDecimal(item.result?.total_distance_km)} km</Text>
                      <Text type="secondary">{oneDecimal(item.result?.total_travel_minutes)} min travel</Text>
                    </Flex>
                    {!canLoad && (
                      <Text type="warning" style={{ display: 'block', marginTop: 6 }}>
                        This older record does not contain the original editable location data.
                      </Text>
                    )}
                  </div>
                  <Button
                    type="primary"
                    disabled={!canLoad}
                    loading={loadingRouteId === item.route_id}
                    onClick={() => void loadRoute(item.route_id)}
                  >
                    Load this route
                  </Button>
                </Flex>
              </Card>
            )
          })}
        </Space>
      )}
    </Modal>
  )
}
