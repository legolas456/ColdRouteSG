import {
  ApiOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  EnvironmentOutlined,
  InfoCircleOutlined,
  MoonOutlined,
  SunOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  Modal,
  Row,
  Segmented,
  Space,
  Steps,
  Switch,
  Tabs,
  Typography,
  message,
} from 'antd'
import { lazy, Suspense, useEffect, useState } from 'react'
import type { ThemeMode } from '../App'
import { api } from '../api/client'
import { defaultStops, sampleDepot, sampleStops } from '../data/sample'
import type { Coordinate, DeliveryStop, RouteLeg, RouteResponse } from '../types'

const { Text, Title } = Typography

const DeliveryForm = lazy(() => import('./DeliveryForm').then((module) => ({ default: module.DeliveryForm })))
const LiveDataPanel = lazy(() => import('./LiveDataPanel').then((module) => ({ default: module.LiveDataPanel })))
const RouteSummary = lazy(() => import('./RouteSummary').then((module) => ({ default: module.RouteSummary })))
const RouteMap = lazy(() => import('./RouteMap').then((module) => ({ default: module.RouteMap })))

type PlannerPage = 'setup' | 'route'

type DashboardProps = {
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}

function normalisePriority(value: number): 1 | 2 | 3 {
  if (value === 1 || value === 2 || value === 3) return value
  if (value >= 0 && value <= 1) {
    if (value >= 0.75) return 1
    if (value >= 0.40) return 2
    return 3
  }
  return 2
}

function currentSingaporeHHMM() {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

function formatSingaporeClock(date: Date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Singapore',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
}

function LiveSingaporeClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return <strong>{formatSingaporeClock(now)} SGT</strong>
}

function copyStops(stops: DeliveryStop[]) {
  return stops.map((stop) => ({ ...stop }))
}

export function Dashboard({ themeMode, onThemeModeChange }: DashboardProps) {
  const [view, setView] = useState<'planner' | 'feeds'>('planner')
  const [plannerPage, setPlannerPage] = useState<PlannerPage>('setup')
  const [depot, setDepot] = useState<Coordinate>({ ...sampleDepot })
  const [depotName, setDepotName] = useState('Jurong Cold Storage Depot')
  const [departureTime, setDepartureTime] = useState(() => currentSingaporeHHMM())
  const [stops, setStops] = useState<DeliveryStop[]>(copyStops(defaultStops))
  const [result, setResult] = useState<RouteResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [recalibratingStopId, setRecalibratingStopId] = useState<string | null>(null)
  const [updatingStopId, setUpdatingStopId] = useState<string | null>(null)
  const [apiError, setApiError] = useState<string | null>(null)
  const [mapOpen, setMapOpen] = useState(false)
  const [infoOpen, setInfoOpen] = useState(false)
  const [recalibrationNote, setRecalibrationNote] = useState<string | null>(null)
  const [routeComplete, setRouteComplete] = useState(false)
  const [msg, contextHolder] = message.useMessage()


  const loadSample = () => {
    setDepot({ ...sampleDepot })
    setDepotName('Jurong Cold Storage Depot')
    setDepartureTime(currentSingaporeHHMM())
    setStops(copyStops(sampleStops))
    setResult(null)
    setRouteComplete(false)
    setRecalibrationNote(null)
  }

  const runOptimization = async (
    nextDepot: Coordinate,
    nextDepotName: string,
    nextDepartureTime: string,
    nextStops: DeliveryStop[],
  ) => {
    if (!nextStops.length) {
      void msg.warning('Add at least one delivery stop.')
      return null
    }

    const cleanStops = nextStops.map((stop) => ({
      ...stop,
      cold_chain_priority: normalisePriority(Number(stop.cold_chain_priority)),
    }))

    return api.optimize({
      depot: nextDepot,
      depot_name: nextDepotName,
      departure_time: nextDepartureTime,
      stops: cleanStops,
    })
  }

  const optimize = async () => {
    setLoading(true)
    setApiError(null)
    setRouteComplete(false)
    setRecalibrationNote(null)
    try {
      const data = await runOptimization(depot, depotName, departureTime, stops)
      if (!data) return
      setResult(data)
      setPlannerPage('route')
      void msg.success('Route optimised')
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Unable to optimise route')
    } finally {
      setLoading(false)
    }
  }

  const setCurrentLocation = async (leg: RouteLeg) => {
    const selectedStop = stops.find((stop) => stop.id === leg.stop_id)
    if (!selectedStop || !result) return

    const remainingIds = new Set(
      result.legs
        .filter((item) => item.sequence > leg.sequence)
        .map((item) => item.stop_id),
    )
    const remainingStops = stops.filter((stop) => remainingIds.has(stop.id))
    const nowTime = currentSingaporeHHMM()

    setRecalibratingStopId(leg.stop_id)
    setApiError(null)

    try {
      setDepot({ lat: selectedStop.lat, lng: selectedStop.lng })
      setDepotName(selectedStop.name)
      setDepartureTime(nowTime)
      setStops(remainingStops)

      if (!remainingStops.length) {
        setResult(null)
        setRouteComplete(true)
        setRecalibrationNote(`Current location updated to ${selectedStop.name} at ${nowTime}. All planned deliveries are complete.`)
        void msg.success('All deliveries completed')
        return
      }

      const nextResult = await runOptimization(
        { lat: selectedStop.lat, lng: selectedStop.lng },
        selectedStop.name,
        nowTime,
        remainingStops,
      )
      if (!nextResult) return

      setResult(nextResult)
      setRouteComplete(false)
      setRecalibrationNote(`Route recalibrated from ${selectedStop.name} at ${nowTime} for ${remainingStops.length} remaining ${remainingStops.length === 1 ? 'stop' : 'stops'}.`)
      void msg.success('Remaining route recalibrated')
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Unable to recalibrate route')
    } finally {
      setRecalibratingStopId(null)
    }
  }

  const updateStopAndRecalibrate = async (updatedStop: DeliveryStop): Promise<boolean> => {
    const nextStops = stops.map((stop) => stop.id === updatedStop.id ? updatedStop : stop)
    const nowTime = currentSingaporeHHMM()

    setUpdatingStopId(updatedStop.id)
    setApiError(null)
    try {
      const nextResult = await runOptimization(depot, depotName, nowTime, nextStops)
      if (!nextResult) return false
      setStops(nextStops)
      setDepartureTime(nowTime)
      setResult(nextResult)
      setRouteComplete(false)
      setRecalibrationNote(`${updatedStop.name} was updated. The route was recalibrated automatically at ${nowTime}.`)
      void msg.success('Stop updated and route recalibrated')
      return true
    } catch (e) {
      setApiError(e instanceof Error ? e.message : 'Unable to update stop and recalibrate route')
      return false
    } finally {
      setUpdatingStopId(null)
    }
  }

  const goBackToInputs = () => {
    setMapOpen(false)
    setPlannerPage('setup')
    setApiError(null)
  }

  const plannerSteps = (
    <Steps
      size="small"
      current={plannerPage === 'setup' ? 0 : 1}
      items={[
        { title: 'Input locations' },
        { title: 'Route planner' },
      ]}
    />
  )

  return (
    <div className="dashboard-shell">
      {contextHolder}

      <div className="hero-bar">
        <Space align="center" size={12}>
          <div className="hero-icon"><CloudServerOutlined /></div>
          <div>
            <Title level={2} className="app-title">ColdRoute SG</Title>
            <Text type="secondary">Cold-chain delivery optimisation</Text>
          </div>
        </Space>

        <Flex gap={10} align="center" wrap className="hero-actions">
          <Segmented
            value={view}
            onChange={(value) => setView(value as 'planner' | 'feeds')}
            options={[
              { label: 'Route planner', value: 'planner', icon: <DashboardOutlined /> },
              { label: 'Live public feeds', value: 'feeds', icon: <ApiOutlined /> },
            ]}
          />
          <Button
            className="info-button"
            icon={<InfoCircleOutlined />}
            onClick={() => setInfoOpen(true)}
          >
            Info
          </Button>
          <Switch
            aria-label="Toggle dark mode"
            checked={themeMode === 'dark'}
            checkedChildren={<MoonOutlined />}
            unCheckedChildren={<SunOutlined />}
            onChange={(checked) => onThemeModeChange(checked ? 'dark' : 'light')}
          />
        </Flex>
      </div>

      {view === 'feeds' ? (
        <Suspense fallback={<div className="component-loading-state">Loading public feeds…</div>}>
          <LiveDataPanel />
        </Suspense>
      ) : (
        <>
          <Card className="planner-step-card" bordered={false}>{plannerSteps}</Card>
          {apiError && (
            <Alert
              type="error"
              showIcon
              closable
              message="Backend request failed"
              description={apiError}
              style={{ marginBottom: 16 }}
            />
          )}

          {plannerPage === 'setup' ? (
            <div className="setup-page">
              <Suspense fallback={<div className="component-loading-state">Loading delivery form…</div>}>
                <DeliveryForm
                  depot={depot}
                  depotName={depotName}
                  departureTime={departureTime}
                  stops={stops}
                  loading={loading}
                  onDepotChange={setDepot}
                  onDepotNameChange={setDepotName}
                  onDepartureTimeChange={setDepartureTime}
                  onStopsChange={setStops}
                  onLoadSample={loadSample}
                  onOptimize={() => void optimize()}
                />
              </Suspense>
            </div>
          ) : (
            <div className="route-page">
              <Flex className="route-page-toolbar" justify="space-between" align="center" gap={12} wrap>
                <div>
                  <Title level={3} style={{ margin: 0 }}>Route Planner</Title>
                  <Text type="secondary">Starting from {depotName} · route reference time {departureTime}</Text>
                </div>
                <Flex gap={10} align="center" wrap className="route-toolbar-actions">
                  <div className="current-time-pill">
                    <ClockCircleOutlined />
                    <div>
                      <span className="current-time-label">Current time</span>
                      <LiveSingaporeClock />
                    </div>
                  </div>
                  <Button onClick={goBackToInputs}>← Back to Input Locations</Button>
                </Flex>
              </Flex>

              {recalibrationNote && (
                <Alert type={routeComplete ? 'success' : 'info'} showIcon message={recalibrationNote} style={{ marginBottom: 16 }} />
              )}

              <div className="mobile-route-tabs">
                <Tabs
                  activeKey="route"
                  onChange={(key) => {
                    if (key === 'map') setMapOpen(true)
                  }}
                  items={[
                    { key: 'route', label: 'Route' },
                    { key: 'map', label: <span><EnvironmentOutlined /> Show map</span> },
                  ]}
                />
              </div>

              {routeComplete ? (
                <Card className="panel-card route-complete-card" bordered={false}>
                  <CheckCircleOutlined className="route-complete-icon" />
                  <Title level={3}>All deliveries completed</Title>
                  <Text type="secondary">There are no remaining delivery locations in this route.</Text>
                  <Button type="primary" style={{ marginTop: 18 }} onClick={goBackToInputs}>
                    Back to Input Locations
                  </Button>
                </Card>
              ) : result ? (
                <Row gutter={[16, 16]} align="top">
                  <Col xs={24} xl={13}>
                    <Suspense fallback={<div className="component-loading-state">Loading route results…</div>}>
                      <RouteSummary
                        result={result}
                        stops={stops}
                        recalibratingStopId={recalibratingStopId}
                        updatingStopId={updatingStopId}
                        onSetCurrentLocation={(leg) => void setCurrentLocation(leg)}
                        onUpdateStop={updateStopAndRecalibrate}
                      />
                    </Suspense>
                  </Col>
                  <Col xs={0} xl={11} className="desktop-map-column">
                    <Card className="panel-card map-card sticky-map-card" bordered={false}>
                      <Suspense fallback={<div className="map-loading-state">Loading map…</div>}>
                        <RouteMap depot={depot} depotName={depotName} stops={stops} result={result} />
                      </Suspense>
                    </Card>
                  </Col>
                </Row>
              ) : null}
            </div>
          )}
        </>
      )}

      <Modal
        open={infoOpen}
        onCancel={() => setInfoOpen(false)}
        footer={null}
        title={(
          <Space size={8}>
            <InfoCircleOutlined />
            <span>How to use ColdRoute SG</span>
          </Space>
        )}
        width={620}
        centered
        className="app-info-modal"
      >
        <Text type="secondary">
          ColdRoute SG helps plan cold-chain deliveries using route travel time, weather, parking availability, delivery priority and delivery windows.
        </Text>
        <Steps
          direction="vertical"
          size="small"
          current={-1}
          className="app-info-steps"
          items={[
            {
              title: 'Enter locations',
              description: 'Set the depot, add delivery stops and choose a cold-chain priority for each stop.',
            },
            {
              title: 'Set delivery details',
              description: 'Choose the departure time, service minutes and an optional delivery-window end time.',
            },
            {
              title: 'Optimise the route',
              description: 'ColdRoute recommends a delivery sequence and shows estimated timing, weather and nearby parking information.',
            },
            {
              title: 'Update while delivering',
              description: 'Edit a stop or mark the current location to automatically recalculate the remaining route using the current Singapore time.',
            },
          ]}
        />
      </Modal>

      <Modal
        open={mapOpen}
        onCancel={() => setMapOpen(false)}
        footer={null}
        width="100vw"
        title="Route map"
        rootClassName="fullscreen-map-modal"
        destroyOnClose
      >
        {mapOpen && (
          <Suspense fallback={<div className="map-loading-state fullscreen">Loading map…</div>}>
            <RouteMap depot={depot} depotName={depotName} stops={stops} result={result} fullScreen />
          </Suspense>
        )}
      </Modal>
    </div>
  )
}
