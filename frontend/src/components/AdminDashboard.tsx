import {
  AimOutlined,
  ArrowLeftOutlined,
  BarChartOutlined,
  CalendarOutlined,
  CarOutlined,
  CloudServerOutlined,
  EnvironmentOutlined,
  EyeOutlined,
  HistoryOutlined,
  LogoutOutlined,
  MoonOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SunOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UserOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Drawer,
  Empty,
  Flex,
  Input,
  Row,
  Space,
  Spin,
  Statistic,
  Switch,
  Table,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip as ChartTooltip,
} from 'chart.js'
import type { ChartOptions } from 'chart.js'
import { Bar, Doughnut } from 'react-chartjs-2'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ThemeMode } from '../App'
import { api } from '../api/client'
import type {
  AdminDriverPerformance,
  AdminPerformanceResponse,
  AdminRecentRoute,
  RouteHistoryItem,
} from '../api/client'

ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Legend,
  ChartTooltip,
)

const { Text, Title } = Typography

interface AdminDashboardProps {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
  username?: string
  onSignOut?: () => void
}

function formatNumber(value: number, maximumFractionDigits = 0) {
  return new Intl.NumberFormat('en-SG', { maximumFractionDigits }).format(value || 0)
}

function formatDateTime(value?: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
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

function prettifyLocalPart(value: string) {
  return value
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase())
}

function driverName(email?: string | null, driverId?: string | null) {
  const localPart = email?.split('@')[0]?.trim()
  if (localPart) return prettifyLocalPart(localPart)
  return driverId ? `Driver ${driverId.slice(0, 8)}` : 'Unknown driver'
}

function driverEmail(email?: string | null) {
  return email || 'Email unavailable'
}

export function AdminDashboard({
  themeMode,
  onThemeModeChange,
  username,
  onSignOut,
}: AdminDashboardProps) {
  const [data, setData] = useState<AdminPerformanceResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [driverSearch, setDriverSearch] = useState('')
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [selectedDriver, setSelectedDriver] = useState<AdminDriverPerformance | null>(null)
  const [driverRoutes, setDriverRoutes] = useState<RouteHistoryItem[]>([])
  const [driverRoutesLoading, setDriverRoutesLoading] = useState(false)
  const [driverRoutesError, setDriverRoutesError] = useState<string | null>(null)
  const [selectedRoute, setSelectedRoute] = useState<RouteHistoryItem | null>(null)
  const [msg, contextHolder] = message.useMessage()

  const loadPerformance = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true)
    else setLoading(true)
    setError(null)

    try {
      const response = await api.adminPerformance()
      setData(response)
      setLastUpdatedAt(new Date())
      if (manual) void msg.success('Admin dashboard refreshed')
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Unable to load admin performance data.'
      setError(messageText)
      if (manual) void msg.error('Unable to refresh dashboard')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [msg])

  useEffect(() => {
    void loadPerformance(false)
  }, [loadPerformance])

  const isDark = themeMode === 'dark'
  const chartPalette = useMemo(() => ({
    text: isDark ? '#e8f1f7' : '#334155',
    muted: isDark ? '#a7bac7' : '#64748b',
    grid: isDark ? 'rgba(140, 175, 197, 0.14)' : 'rgba(148, 163, 184, 0.20)',
    teal: isDark ? '#2dd4bf' : '#0f766e',
    amber: isDark ? '#fbbf24' : '#d97706',
    slate: isDark ? '#476174' : '#cbd5e1',
  }), [isDark])

  const drivers = data?.drivers ?? []
  const filteredDrivers = useMemo(() => {
    const query = driverSearch.trim().toLowerCase()
    if (!query) return drivers
    return drivers.filter((driver) => {
      const haystack = `${driverName(driver.email, driver.driver_id)} ${driver.email} ${driver.driver_id}`.toLowerCase()
      return haystack.includes(query)
    })
  }, [driverSearch, drivers])

  const topDrivers = useMemo(
    () => [...drivers].sort((a, b) => b.routes - a.routes).slice(0, 8),
    [drivers],
  )

  const routeActivityData = useMemo(() => ({
    labels: topDrivers.map((driver) => driverName(driver.email, driver.driver_id)),
    datasets: [
      {
        label: 'Saved routes',
        data: topDrivers.map((driver) => driver.routes),
        backgroundColor: chartPalette.teal,
        borderRadius: 8,
        borderSkipped: false as const,
        maxBarThickness: 28,
      },
    ],
  }), [chartPalette.teal, topDrivers])

  const routeActivityOptions = useMemo<ChartOptions<'bar'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    indexAxis: 'y',
    plugins: {
      legend: { display: false },
      tooltip: {
        backgroundColor: isDark ? '#112231' : '#0f172a',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        padding: 12,
        displayColors: false,
      },
    },
    scales: {
      x: {
        beginAtZero: true,
        ticks: { color: chartPalette.muted, precision: 0 },
        grid: { color: chartPalette.grid },
        border: { display: false },
      },
      y: {
        ticks: { color: chartPalette.text },
        grid: { display: false },
        border: { display: false },
      },
    },
  }), [chartPalette.grid, chartPalette.muted, chartPalette.text, isDark])

  const totalStops = data?.summary.total_delivery_stops ?? 0
  const highPriority = data?.summary.high_priority_deliveries ?? 0
  const standardPriority = Math.max(totalStops - highPriority, 0)

  const priorityMixData = useMemo(() => ({
    labels: ['Priority 1', 'Priority 2–3'],
    datasets: [
      {
        data: [highPriority, standardPriority],
        backgroundColor: [chartPalette.amber, chartPalette.slate],
        borderWidth: 0,
        hoverOffset: 5,
      },
    ],
  }), [chartPalette.amber, chartPalette.slate, highPriority, standardPriority])

  const priorityMixOptions = useMemo<ChartOptions<'doughnut'>>(() => ({
    responsive: true,
    maintainAspectRatio: false,
    cutout: '72%',
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          color: chartPalette.text,
          usePointStyle: true,
          pointStyle: 'circle',
          padding: 18,
        },
      },
      tooltip: {
        backgroundColor: isDark ? '#112231' : '#0f172a',
        titleColor: '#ffffff',
        bodyColor: '#ffffff',
        padding: 12,
      },
    },
  }), [chartPalette.text, isDark])

  const openDriver = useCallback(async (driver: AdminDriverPerformance) => {
    setSelectedDriver(driver)
    setSelectedRoute(null)
    setDriverRoutes([])
    setDriverRoutesError(null)
    setDriverRoutesLoading(true)

    try {
      const response = await api.adminDriverRoutes(driver.driver_id, 100)
      setDriverRoutes(response.routes ?? [])
    } catch (err) {
      setDriverRoutesError(err instanceof Error ? err.message : 'Unable to load driver route history.')
    } finally {
      setDriverRoutesLoading(false)
    }
  }, [])

  const closeDriver = () => {
    setSelectedDriver(null)
    setSelectedRoute(null)
    setDriverRoutes([])
    setDriverRoutesError(null)
  }

  const driverColumns: ColumnsType<AdminDriverPerformance> = [
    {
      title: 'Driver',
      key: 'driver',
      width: 250,
      render: (_, driver) => (
        <Space size={10}>
          <Avatar className="admin-driver-avatar" icon={<UserOutlined />} />
          <div className="admin-driver-identity">
            <strong>{driverName(driver.email, driver.driver_id)}</strong>
            <span className="admin-driver-email">{driverEmail(driver.email)}</span>
          </div>
        </Space>
      ),
    },
    {
      title: 'Routes',
      dataIndex: 'routes',
      sorter: (a, b) => a.routes - b.routes,
      width: 90,
      align: 'right',
    },
    {
      title: 'Stops',
      dataIndex: 'stops',
      sorter: (a, b) => a.stops - b.stops,
      width: 90,
      align: 'right',
    },
    {
      title: 'Avg stops / route',
      dataIndex: 'average_stops_per_route',
      sorter: (a, b) => a.average_stops_per_route - b.average_stops_per_route,
      width: 145,
      align: 'right',
      render: (value: number) => value.toFixed(1),
    },
    {
      title: 'Priority 1',
      dataIndex: 'high_priority_deliveries',
      sorter: (a, b) => a.high_priority_deliveries - b.high_priority_deliveries,
      width: 105,
      align: 'right',
      render: (value: number) => value > 0 ? <Tag color="gold">{value}</Tag> : '0',
    },
    {
      title: 'Planned distance',
      dataIndex: 'total_distance_km',
      sorter: (a, b) => a.total_distance_km - b.total_distance_km,
      width: 145,
      align: 'right',
      render: (value: number) => `${formatNumber(value, 1)} km`,
    },
    {
      title: 'Last route',
      dataIndex: 'last_route_at',
      sorter: (a, b) => String(a.last_route_at ?? '').localeCompare(String(b.last_route_at ?? '')),
      width: 180,
      render: (value?: string | null) => formatDateTime(value),
    },
    {
      title: '',
      key: 'view',
      width: 120,
      fixed: 'right',
      render: (_, driver) => (
        <Button type="link" icon={<EyeOutlined />} onClick={() => void openDriver(driver)}>
          View routes
        </Button>
      ),
    },
  ]

  const recentColumns: ColumnsType<AdminRecentRoute> = [
    {
      title: 'Driver',
      key: 'driver',
      render: (_, route) => (
        <div className="admin-driver-identity compact">
          <strong>{driverName(route.email, route.driver_id)}</strong>
          <span className="admin-driver-email">{driverEmail(route.email)}</span>
        </div>
      ),
    },
    {
      title: 'Saved',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 175,
      render: (value?: string | null) => formatDateTime(value),
    },
    {
      title: 'Depot',
      dataIndex: 'depot_name',
      key: 'depot_name',
      ellipsis: true,
    },
    {
      title: 'Stops',
      dataIndex: 'stop_count',
      key: 'stop_count',
      width: 80,
      align: 'right',
    },
    {
      title: 'Distance',
      dataIndex: 'distance_km',
      key: 'distance_km',
      width: 110,
      align: 'right',
      render: (value: number) => `${formatNumber(value, 1)} km`,
    },
  ]

  return (
    <div className="dashboard-shell admin-dashboard-shell">
      {contextHolder}

      <div className="hero-bar admin-hero-bar">
        <Space align="center" size={12}>
          <div className="hero-icon"><CloudServerOutlined /></div>
          <div>
            <Title level={2} className="app-title">ColdRoute SG</Title>
            <Text type="secondary">Fleet administration</Text>
          </div>
        </Space>

        <Flex gap={10} align="center" wrap className="hero-actions">
          <Tag className="admin-role-tag" icon={<SafetyCertificateOutlined />}>Administrator</Tag>
          <Switch
            aria-label="Toggle dark mode"
            checked={themeMode === 'dark'}
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
            onChange={(checked) => onThemeModeChange(checked ? 'dark' : 'light')}
          />
          {(username || onSignOut) && (
            <div className="user-account-control">
              {username && (
                <div className="user-account-pill" title={username}>
                  <UserOutlined />
                  <span>{username}</span>
                </div>
              )}
              {onSignOut && (
                <Button className="sign-out-button" icon={<LogoutOutlined />} onClick={onSignOut}>
                  Sign out
                </Button>
              )}
            </div>
          )}
        </Flex>
      </div>

      <Flex className="admin-page-heading" justify="space-between" align="flex-start" gap={16} wrap>
        <div>
          <div className="route-history-kicker"><BarChartOutlined /> OPERATIONS OVERVIEW</div>
          <Title level={3}>Driver activity</Title>
          <Text type="secondary">
            Review saved route-planning activity across drivers and drill into each driver's delivery runs.
          </Text>
        </div>
        <Flex gap={12} align="center" wrap>
          <div className="admin-last-refreshed">
            <span>Last refreshed</span>
            <strong>{lastUpdatedAt ? `${formatDateTime(lastUpdatedAt.toISOString())} SGT` : '—'}</strong>
          </div>
          <Button
            icon={<ReloadOutlined spin={refreshing} />}
            loading={refreshing}
            onClick={() => void loadPerformance(true)}
          >
            Refresh
          </Button>
        </Flex>
      </Flex>

      <Alert
        className="admin-scope-alert"
        type="info"
        showIcon
        message="Planning metrics"
        description={data?.metric_scope || 'This dashboard reflects saved route-planning activity. Actual completed-delivery performance is not yet tracked.'}
      />

      {loading ? (
        <div className="component-loading-state admin-loading-state"><Spin size="large" /> Loading admin dashboard…</div>
      ) : error ? (
        <Card className="panel-card" bordered={false}>
          <Alert
            type="error"
            showIcon
            message="Unable to load admin performance data"
            description={error}
            action={<Button onClick={() => void loadPerformance(false)}>Try again</Button>}
          />
        </Card>
      ) : data ? (
        <>
          <Row gutter={[16, 16]} className="admin-kpi-grid">
            <Col xs={24} sm={12} xl={6}>
              <Card className="panel-card admin-kpi-card" bordered={false}>
                <div className="admin-kpi-icon teal"><TeamOutlined /></div>
                <Statistic title="Drivers" value={data.summary.total_drivers} />
                <span className="admin-kpi-footnote">Drivers with saved routes</span>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card className="panel-card admin-kpi-card" bordered={false}>
                <div className="admin-kpi-icon blue"><CarOutlined /></div>
                <Statistic title="Saved routes" value={data.summary.total_routes} />
                <span className="admin-kpi-footnote">Across all drivers</span>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card className="panel-card admin-kpi-card" bordered={false}>
                <div className="admin-kpi-icon cyan"><EnvironmentOutlined /></div>
                <Statistic title="Delivery stops" value={data.summary.total_delivery_stops} />
                <span className="admin-kpi-footnote">Planned delivery locations</span>
              </Card>
            </Col>
            <Col xs={24} sm={12} xl={6}>
              <Card className="panel-card admin-kpi-card" bordered={false}>
                <div className="admin-kpi-icon amber"><ThunderboltOutlined /></div>
                <Statistic title="Priority 1" value={data.summary.high_priority_deliveries} />
                <span className="admin-kpi-footnote">Highest-priority stops</span>
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} className="admin-secondary-kpis">
            <Col xs={24} md={8}>
              <Card className="panel-card admin-mini-kpi" bordered={false}>
                <AimOutlined />
                <div><span>Total planned distance</span><strong>{formatNumber(data.summary.total_planned_distance_km, 1)} km</strong></div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="panel-card admin-mini-kpi" bordered={false}>
                <HistoryOutlined />
                <div><span>Average stops per route</span><strong>{formatNumber(data.summary.average_stops_per_route, 1)}</strong></div>
              </Card>
            </Col>
            <Col xs={24} md={8}>
              <Card className="panel-card admin-mini-kpi" bordered={false}>
                <BarChartOutlined />
                <div><span>Total planned service time</span><strong>{formatNumber(data.summary.total_planned_service_minutes, 1)} min</strong></div>
              </Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} className="admin-chart-grid">
            <Col xs={24} xl={14}>
              <Card
                className="panel-card admin-chart-card"
                bordered={false}
                title={<div className="admin-card-heading"><strong>Routes by driver</strong><span>Saved route activity by driver</span></div>}
              >
                {topDrivers.length ? (
                  <div className="admin-chart admin-chart-tall"><Bar data={routeActivityData} options={routeActivityOptions} /></div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No driver activity yet" />}
              </Card>
            </Col>
            <Col xs={24} xl={10}>
              <Card
                className="panel-card admin-chart-card"
                bordered={false}
                title={<div className="admin-card-heading"><strong>Delivery priority mix</strong><span>Priority 1 compared with other planned stops</span></div>}
              >
                {totalStops > 0 ? (
                  <div className="admin-chart admin-chart-doughnut">
                    <Doughnut data={priorityMixData} options={priorityMixOptions} />
                    <div className="admin-doughnut-centre"><strong>{totalStops}</strong><span>stops</span></div>
                  </div>
                ) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No delivery stops yet" />}
              </Card>
            </Col>
          </Row>

          <Card
            className="panel-card admin-table-card"
            bordered={false}
            title={(
              <div className="admin-table-title">
                <div className="admin-card-heading">
                  <strong>Drivers</strong>
                  <span>Select a driver to review their saved route history</span>
                </div>
                <Input.Search
                  allowClear
                  placeholder="Search driver name or email"
                  value={driverSearch}
                  onChange={(event) => setDriverSearch(event.target.value)}
                  className="admin-driver-search"
                />
              </div>
            )}
          >
            <Table
              rowKey="driver_id"
              columns={driverColumns}
              dataSource={filteredDrivers}
              pagination={{ pageSize: 8, showSizeChanger: false }}
              scroll={{ x: 1160 }}
              locale={{ emptyText: 'No driver route activity available' }}
              rowClassName="admin-driver-row"
              onRow={(driver) => ({ onDoubleClick: () => void openDriver(driver) })}
            />
          </Card>

          <Card
            className="panel-card admin-table-card admin-recent-card"
            bordered={false}
            title={<div className="admin-card-heading"><strong>Recent route activity</strong><span>Latest saved routes across the fleet</span></div>}
          >
            <Table
              rowKey={(route) => route.route_id || `${route.driver_id}-${route.created_at}`}
              columns={recentColumns}
              dataSource={data.recent_routes}
              pagination={false}
              scroll={{ x: 760 }}
              locale={{ emptyText: 'No recent routes available' }}
            />
          </Card>
        </>
      ) : null}

      <Drawer
        open={Boolean(selectedDriver)}
        onClose={closeDriver}
        width={760}
        className="admin-driver-drawer"
        title={selectedDriver ? (
          <div className="admin-driver-drawer-title">
            <Avatar className="admin-driver-avatar" icon={<UserOutlined />} />
            <div>
              <strong>{driverName(selectedDriver.email, selectedDriver.driver_id)}</strong>
              <span>{driverEmail(selectedDriver.email)}</span>
            </div>
          </div>
        ) : 'Driver routes'}
      >
        {selectedDriver && !selectedRoute && (
          <>
            <div className="admin-driver-summary-strip">
              <div><span>Routes</span><strong>{selectedDriver.routes}</strong></div>
              <div><span>Stops</span><strong>{selectedDriver.stops}</strong></div>
              <div><span>Priority 1</span><strong>{selectedDriver.high_priority_deliveries}</strong></div>
              <div><span>Distance</span><strong>{formatNumber(selectedDriver.total_distance_km, 1)} km</strong></div>
            </div>

            <Flex className="admin-drawer-section-heading" justify="space-between" align="center" gap={12} wrap>
              <div>
                <Title level={4}>Saved routes</Title>
                <Text type="secondary">Select a route to view the full delivery sequence and context.</Text>
              </div>
            </Flex>

            {driverRoutesLoading ? (
              <div className="route-history-loading"><Spin size="large" /><span>Loading driver routes…</span></div>
            ) : driverRoutesError ? (
              <Alert type="error" showIcon message="Unable to load driver routes" description={driverRoutesError} />
            ) : driverRoutes.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No saved routes for this driver" />
            ) : (
              <div className="admin-driver-route-list">
                {driverRoutes.map((item) => (
                  <Card key={item.route_id} className="route-history-card admin-driver-route-card" bordered={false}>
                    <Flex justify="space-between" align="flex-start" gap={12} wrap>
                      <div className="route-history-card-title">
                        <span className="route-history-icon"><EnvironmentOutlined /></span>
                        <div>
                          <Title level={5}>{item.depot_name || 'Saved route'}</Title>
                          <Text type="secondary"><CalendarOutlined /> {formatDateTime(item.created_at)} SGT</Text>
                        </div>
                      </div>
                      <Tag className="route-history-mode-tag">{modeLabel(item.result?.data_mode)}</Tag>
                    </Flex>
                    <div className="route-history-metrics">
                      <div><span>Stops</span><strong>{item.stop_count ?? 0}</strong></div>
                      <div><span>Distance</span><strong>{oneDecimal(item.result?.total_distance_km)} km</strong></div>
                      <div><span>Travel</span><strong>{oneDecimal(item.result?.total_travel_minutes)} min</strong></div>
                      <div><span>Departure</span><strong>{item.departure_time || '—'}</strong></div>
                    </div>
                    <Button type="primary" ghost icon={<EyeOutlined />} onClick={() => setSelectedRoute(item)}>
                      View route details
                    </Button>
                  </Card>
                ))}
              </div>
            )}
          </>
        )}

        {selectedDriver && selectedRoute && (
          <div className="admin-route-detail-view">
            <Button className="admin-route-back" icon={<ArrowLeftOutlined />} onClick={() => setSelectedRoute(null)}>
              Back to {driverName(selectedDriver.email, selectedDriver.driver_id)}'s routes
            </Button>

            <div className="route-history-detail-heading">
              <span className="route-history-icon large"><CarOutlined /></span>
              <div>
                <Title level={4}>{selectedRoute.depot_name || 'Saved route'}</Title>
                <Text type="secondary">Created {formatDateTime(selectedRoute.created_at)} SGT</Text>
              </div>
            </div>

            <Descriptions bordered size="small" column={{ xs: 1, sm: 2 }}>
              <Descriptions.Item label="Departure">{selectedRoute.departure_time || '—'}</Descriptions.Item>
              <Descriptions.Item label="Stops">{selectedRoute.stop_count ?? 0}</Descriptions.Item>
              <Descriptions.Item label="Distance">{oneDecimal(selectedRoute.result?.total_distance_km)} km</Descriptions.Item>
              <Descriptions.Item label="Travel time">{oneDecimal(selectedRoute.result?.total_travel_minutes)} min</Descriptions.Item>
              <Descriptions.Item label="Service time">{selectedRoute.result?.total_service_minutes ?? '—'} min</Descriptions.Item>
              <Descriptions.Item label="Total lateness">{oneDecimal(selectedRoute.result?.total_lateness_minutes)} min</Descriptions.Item>
            </Descriptions>

            <div className="route-history-detail-section">
              <Title level={5}>Delivery sequence</Title>
              {selectedRoute.result?.legs?.length ? (
                <Timeline
                  items={[...selectedRoute.result.legs]
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
      </Drawer>
    </div>
  )
}
