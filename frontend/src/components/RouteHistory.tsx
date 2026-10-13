import {
  CalendarOutlined,
  CarOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  HistoryOutlined,
  ReloadOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Empty,
  Flex,
  Modal,
  Popconfirm,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { RouteHistoryItem } from '../api/client'

const { Text, Title } = Typography

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

function modeLabel(mode?: string) {
  if (!mode) return 'Unknown data mode'
  if (mode === 'live') return 'Live data'
  if (mode === 'mixed') return 'Mixed data'
  if (mode === 'mock') return 'Fallback data'
  return mode
}

export function RouteHistory() {
  const [routes, setRoutes] = useState<RouteHistoryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<RouteHistoryItem | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [msg, contextHolder] = message.useMessage()

  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await api.routeHistory(50)
      setRoutes(data.routes ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load route history')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadHistory()
  }, [loadHistory])

  const openDetails = async (routeId: string) => {
    setDetailLoading(true)
    try {
      const item = await api.routeHistoryItem(routeId)
      setSelected(item)
    } catch (e) {
      void msg.error(e instanceof Error ? e.message : 'Unable to load route details')
    } finally {
      setDetailLoading(false)
    }
  }

  const deleteRoute = async (routeId: string) => {
    setDeletingId(routeId)
    try {
      await api.deleteRouteHistoryItem(routeId)
      setRoutes((current) => current.filter((item) => item.route_id !== routeId))
      if (selected?.route_id === routeId) setSelected(null)
      void msg.success('Saved route deleted')
    } catch (e) {
      void msg.error(e instanceof Error ? e.message : 'Unable to delete saved route')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <section className="route-history-page">
      {contextHolder}

      <Flex className="route-history-header" justify="space-between" align="flex-start" gap={16} wrap>
        <div>
          <div className="route-history-kicker"><HistoryOutlined /> SAVED DELIVERY RUNS</div>
          <Title level={3}>Route History</Title>
          <Text type="secondary">
            Review optimisation runs saved securely to your account. Only routes linked to your signed-in user are shown here.
          </Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => void loadHistory()} loading={loading}>
          Refresh
        </Button>
      </Flex>

      {error && (
        <Alert
          type="error"
          showIcon
          message="Unable to load route history"
          description={error}
          action={<Button size="small" onClick={() => void loadHistory()}>Try again</Button>}
        />
      )}

      {loading ? (
        <div className="route-history-loading"><Spin size="large" /><span>Loading saved routes…</span></div>
      ) : !error && routes.length === 0 ? (
        <Card className="panel-card route-history-empty" bordered={false}>
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="No saved routes yet. Optimise a route and it will appear here automatically."
          />
        </Card>
      ) : (
        <div className="route-history-grid">
          {routes.map((item) => {
            const result = item.result ?? {}
            return (
              <Card key={item.route_id} className="route-history-card" bordered={false}>
                <Flex justify="space-between" align="flex-start" gap={12} wrap>
                  <div className="route-history-card-title">
                    <span className="route-history-icon"><EnvironmentOutlined /></span>
                    <div>
                      <Title level={5}>{item.depot_name || 'Saved route'}</Title>
                      <Text type="secondary"><CalendarOutlined /> {singaporeDateTime(item.created_at)} SGT</Text>
                    </div>
                  </div>
                  <Tag className="route-history-mode-tag">{modeLabel(result.data_mode)}</Tag>
                </Flex>

                <div className="route-history-metrics">
                  <div><span>Stops</span><strong>{item.stop_count ?? 0}</strong></div>
                  <div><span>Distance</span><strong>{oneDecimal(result.total_distance_km)} km</strong></div>
                  <div><span>Travel</span><strong>{oneDecimal(result.total_travel_minutes)} min</strong></div>
                  <div><span>Departure</span><strong>{item.departure_time || '—'}</strong></div>
                </div>

                <Flex className="route-history-actions" justify="space-between" gap={10} wrap>
                  <Button
                    type="primary"
                    ghost
                    icon={<EyeOutlined />}
                    loading={detailLoading && selected?.route_id !== item.route_id}
                    onClick={() => void openDetails(item.route_id)}
                  >
                    View details
                  </Button>
                  <Popconfirm
                    title="Delete this saved route?"
                    description="This removes the route from your history and cannot be undone."
                    okText="Delete"
                    okButtonProps={{ danger: true }}
                    cancelText="Cancel"
                    onConfirm={() => void deleteRoute(item.route_id)}
                  >
                    <Button danger icon={<DeleteOutlined />} loading={deletingId === item.route_id}>
                      Delete
                    </Button>
                  </Popconfirm>
                </Flex>
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={Boolean(selected)}
        onCancel={() => setSelected(null)}
        footer={null}
        width={760}
        title="Saved route details"
        className="route-history-modal"
      >
        {selected && (
          <div className="route-history-detail">
            <div className="route-history-detail-heading">
              <span className="route-history-icon large"><CarOutlined /></span>
              <div>
                <Title level={4}>{selected.depot_name || 'Saved route'}</Title>
                <Text type="secondary">Created {singaporeDateTime(selected.created_at)} SGT</Text>
              </div>
            </div>

            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Departure">{selected.departure_time || '—'}</Descriptions.Item>
              <Descriptions.Item label="Stops">{selected.stop_count ?? 0}</Descriptions.Item>
              <Descriptions.Item label="Distance">{oneDecimal(selected.result?.total_distance_km)} km</Descriptions.Item>
              <Descriptions.Item label="Travel time">{oneDecimal(selected.result?.total_travel_minutes)} min</Descriptions.Item>
              <Descriptions.Item label="Service time">{selected.result?.total_service_minutes ?? '—'} min</Descriptions.Item>
              <Descriptions.Item label="Total lateness">{oneDecimal(selected.result?.total_lateness_minutes)} min</Descriptions.Item>
            </Descriptions>

            <div className="route-history-detail-section">
              <Title level={5}><ClockCircleOutlined /> Delivery sequence</Title>
              {selected.result?.legs?.length ? (
                <Timeline
                  items={[...selected.result.legs]
                    .sort((a, b) => a.sequence - b.sequence)
                    .map((leg) => ({
                      children: (
                        <div className="route-history-leg">
                          <Flex justify="space-between" gap={10} wrap>
                            <strong>{leg.sequence}. {leg.stop_name}</strong>
                            <Tag>ETA {leg.eta}</Tag>
                          </Flex>
                          <Text type="secondary">
                            {oneDecimal(leg.distance_km)} km · {oneDecimal(leg.travel_minutes)} min travel · {leg.service_minutes} min service · Priority {leg.cold_chain_priority}
                          </Text>
                          {(leg.weather?.forecast || leg.parking?.address) && (
                            <div className="route-history-leg-context">
                              {leg.weather?.forecast && <span>Weather: {leg.weather.forecast}</span>}
                              {leg.parking?.address && <span>Parking: {leg.parking.address}</span>}
                            </div>
                          )}
                        </div>
                      ),
                    }))}
                />
              ) : (
                <Text type="secondary">No stop-level details are available for this saved route.</Text>
              )}
            </div>
          </div>
        )}
      </Modal>
    </section>
  )
}
