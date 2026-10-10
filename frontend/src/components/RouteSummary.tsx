import {
  AimOutlined,
  CarOutlined,
  ClockCircleOutlined,
  CloudOutlined,
  EditOutlined,
  EnvironmentOutlined,
  FieldTimeOutlined,
} from '@ant-design/icons'
import {
  Alert,
  Button,
  Card,
  Col,
  Flex,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Tag,
  TimePicker,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useState } from 'react'
import type { DeliveryStop, RouteLeg, RouteResponse } from '../types'
import { LocationField } from './DeliveryForm'

const { Text, Title } = Typography

function priorityTag(priority: 1 | 2 | 3) {
  if (priority === 1) return <Tag color="red">Priority 1 · Highest</Tag>
  if (priority === 2) return <Tag color="orange">Priority 2 · Medium</Tag>
  return <Tag>Priority 3 · Lower</Tag>
}

function timeToMinutes(value?: string | null) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null
  return hours * 60 + minutes
}

type ScheduleStatus = {
  kind: 'late' | 'tight' | 'ok' | 'none'
  text: string
  detail: string
}

function getScheduleStatus(leg: RouteLeg, stop?: DeliveryStop): ScheduleStatus {
  if (leg.lateness_minutes > 0) {
    return {
      kind: 'late',
      text: `${Math.ceil(leg.lateness_minutes)} min projected late`,
      detail: stop?.window_end
        ? `ETA ${leg.eta} is after the ${stop.window_end} delivery window.`
        : `Expected arrival is ${leg.eta}.`,
    }
  }

  const eta = timeToMinutes(leg.eta)
  const windowEnd = timeToMinutes(stop?.window_end)
  if (eta != null && windowEnd != null) {
    let buffer = windowEnd - eta
    if (buffer < -720) buffer += 1440
    if (buffer >= 0 && buffer <= 15) {
      return {
        kind: 'tight',
        text: `Tight timing · ${buffer} min buffer`,
        detail: `ETA ${leg.eta}, delivery window ends ${stop?.window_end}.`,
      }
    }
    return {
      kind: 'ok',
      text: 'On schedule',
      detail: `ETA ${leg.eta}, delivery window ends ${stop?.window_end}.`,
    }
  }

  return {
    kind: 'none',
    text: 'On schedule',
    detail: `Expected arrival ${leg.eta}.`,
  }
}

function ParkingDetails({ leg }: { leg: RouteLeg }) {
  return (
    <div className="route-card-section">
      <Flex align="center" gap={8} wrap>
        <CarOutlined />
        <Text strong>Nearest parking</Text>
      </Flex>
      <Text className="route-card-primary">
        {leg.parking.address ?? leg.parking.carpark_no ?? 'Parking location unavailable'}
      </Text>
      <Text type="secondary" className="route-card-secondary">
        {leg.parking.carpark_no ? `${leg.parking.carpark_no} · ` : ''}
        {leg.parking.available_lots ?? '—'} / {leg.parking.total_lots ?? '—'} lots
        {leg.parking.distance_m != null ? ` · ${Math.round(leg.parking.distance_m)} m away` : ''}
      </Text>
    </div>
  )
}

interface Props {
  result: RouteResponse
  stops: DeliveryStop[]
  recalibratingStopId?: string | null
  updatingStopId?: string | null
  onSetCurrentLocation: (leg: RouteLeg) => void
  onUpdateStop: (stop: DeliveryStop) => Promise<boolean>
}

export function RouteSummary({
  result,
  stops,
  recalibratingStopId,
  updatingStopId,
  onSetCurrentLocation,
  onUpdateStop,
}: Props) {
  const [editingStopId, setEditingStopId] = useState<string | null>(null)
  const [draftStop, setDraftStop] = useState<DeliveryStop | null>(null)

  const stopLookup = new Map(stops.map((stop) => [stop.id, stop]))
  const timingRisks = result.legs
    .map((leg) => ({ leg, status: getScheduleStatus(leg, stopLookup.get(leg.stop_id)) }))
    .filter(({ status }) => status.kind === 'late' || status.kind === 'tight')
  const hasLateStop = timingRisks.some(({ status }) => status.kind === 'late')

  const beginEdit = (leg: RouteLeg) => {
    const stop = stopLookup.get(leg.stop_id)
    if (!stop) return
    setDraftStop({ ...stop })
    setEditingStopId(leg.stop_id)
  }

  const cancelEdit = () => {
    setEditingStopId(null)
    setDraftStop(null)
  }

  const saveEdit = async () => {
    if (!draftStop) return
    const saved = await onUpdateStop(draftStop)
    if (saved) cancelEdit()
  }

  return (
    <div className="route-summary-stack">
      <Card className="panel-card route-overview-card" bordered={false}>
        <Flex justify="space-between" align="flex-start" wrap gap={12}>
          <div>
            <Title level={4} style={{ margin: 0 }}>Optimised route</Title>
            <Text type="secondary">Stops are ordered using travel time, weather, parking, cold-chain priority and delivery windows.</Text>
          </div>
          <Tag color={result.data_mode === 'live' ? 'green' : result.data_mode === 'mixed' ? 'orange' : 'blue'}>
            {result.data_mode.toUpperCase()} DATA
          </Tag>
        </Flex>

        <Row gutter={[12, 12]} className="route-stat-grid">
          <Col xs={12} sm={6}><Statistic title="Distance" value={result.total_distance_km} suffix="km" precision={1} /></Col>
          <Col xs={12} sm={6}><Statistic title="Driving" value={result.total_travel_minutes} suffix="min" precision={0} /></Col>
          <Col xs={12} sm={6}><Statistic title="Service" value={result.total_service_minutes} suffix="min" /></Col>
          <Col xs={12} sm={6}><Statistic title="Late time" value={result.total_lateness_minutes} suffix="min" precision={0} /></Col>
        </Row>

        {timingRisks.length > 0 && (
          <Alert
            className="route-timing-alert"
            type={hasLateStop ? 'error' : 'warning'}
            showIcon
            message={hasLateStop ? 'Delivery timing alert' : 'Tight delivery timing'}
            description={timingRisks.map(({ leg, status }) => `${leg.stop_name}: ${status.text}`).join(' · ')}
            style={{ marginTop: 14 }}
          />
        )}

        {result.warnings.map((warning) => (
          <Alert key={warning} type="warning" showIcon message={warning} style={{ marginTop: 10 }} />
        ))}
      </Card>

      {result.legs.map((leg) => {
        const stop = stopLookup.get(leg.stop_id)
        const schedule = getScheduleStatus(leg, stop)
        const editing = editingStopId === leg.stop_id && draftStop?.id === leg.stop_id
        const busy = Boolean(recalibratingStopId || updatingStopId)

        return (
          <Card
            key={leg.stop_id}
            className={`panel-card route-stop-card schedule-${schedule.kind}`}
            bordered={false}
            title={(
              <Flex align="center" gap={10} wrap>
                <div className="route-sequence-badge">{leg.sequence}</div>
                <div className="route-stop-title-wrap">
                  <Text strong className="route-stop-title">{leg.stop_name}</Text>
                  <Text type="secondary">ETA {leg.eta}</Text>
                </div>
              </Flex>
            )}
            extra={priorityTag(leg.cold_chain_priority)}
          >
            {schedule.kind === 'late' && (
              <Alert
                className="stop-late-alert"
                type="error"
                showIcon
                message="This delivery is projected to miss its time window"
                description={schedule.detail}
                style={{ marginBottom: 12 }}
              />
            )}
            {schedule.kind === 'tight' && (
              <Alert
                className="stop-late-alert"
                type="warning"
                showIcon
                message="This delivery has very little timing buffer"
                description={schedule.detail}
                style={{ marginBottom: 12 }}
              />
            )}

            <div className="route-card-grid">
              <div className="route-card-section">
                <Flex align="center" gap={8}>
                  <ClockCircleOutlined />
                  <Text strong>Journey</Text>
                </Flex>
                <Text className="route-card-primary">{leg.travel_minutes.toFixed(1)} min · {leg.distance_km.toFixed(1)} km</Text>
                <Text type="secondary" className="route-card-secondary">Service time: {leg.service_minutes} min</Text>
              </div>

              <div className="route-card-section">
                <Flex align="center" gap={8} wrap>
                  <CloudOutlined />
                  <Text strong>Weather</Text>
                </Flex>
                <Text className="route-card-primary">{leg.weather.forecast}</Text>
                <Text type="secondary" className="route-card-secondary">{leg.weather.area}</Text>
              </div>

              <ParkingDetails leg={leg} />

              <div className={`route-card-section schedule-panel schedule-panel-${schedule.kind}`}>
                <Flex align="center" gap={8}>
                  <FieldTimeOutlined />
                  <Text strong>Schedule</Text>
                </Flex>
                <Text className="route-card-primary">{schedule.text}</Text>
                <Text type="secondary" className="route-card-secondary">{schedule.detail}</Text>
              </div>
            </div>

            {editing && draftStop && (
              <div className="route-inline-editor">
                <Flex justify="space-between" align="center" gap={10} wrap className="inline-editor-heading">
                  <div>
                    <Text strong>Edit delivery information</Text>
                    <Text type="secondary" className="inline-editor-subtitle">Saving will automatically recalculate the remaining route using the current Singapore time.</Text>
                  </div>
                  <Tag color="cyan">Auto recalibrate</Tag>
                </Flex>

                <div className="inline-editor-grid">
                  <div className="inline-editor-field inline-editor-location">
                    <Text strong>Location</Text>
                    <LocationField
                      value={draftStop.name}
                      placeholder="Start typing a delivery location"
                      onTextChange={(name) => setDraftStop({ ...draftStop, name })}
                      onSelectLocation={(location) => setDraftStop({
                        ...draftStop,
                        name: location.name,
                        lat: location.lat,
                        lng: location.lng,
                      })}
                    />
                  </div>
                  <div className="inline-editor-field">
                    <Text strong>Service time</Text>
                    <InputNumber
                      className="service-minutes-input"
                      addonAfter="min"
                      value={draftStop.service_minutes === 0 ? undefined : draftStop.service_minutes}
                      placeholder="0 if blank"
                      controls={false}
                      precision={0}
                      min={0}
                      max={180}
                      onChange={(value) => setDraftStop({ ...draftStop, service_minutes: Math.min(180, Math.max(0, Number(value ?? 0))) })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div className="inline-editor-field">
                    <Text strong>Delivery window end</Text>
                    <TimePicker
                      value={draftStop.window_end ? dayjs(draftStop.window_end, 'HH:mm') : null}
                      format="HH:mm"
                      minuteStep={5}
                      allowClear
                      onChange={(value) => setDraftStop({ ...draftStop, window_end: value ? value.format('HH:mm') : null })}
                      style={{ width: '100%' }}
                    />
                  </div>
                  <div className="inline-editor-field">
                    <Text strong>Cold-chain priority</Text>
                    <Select
                      value={draftStop.cold_chain_priority}
                      onChange={(value: 1 | 2 | 3) => setDraftStop({ ...draftStop, cold_chain_priority: value })}
                      options={[
                        { value: 1, label: '1 — Highest priority' },
                        { value: 2, label: '2 — Medium priority' },
                        { value: 3, label: '3 — Lower priority' },
                      ]}
                      style={{ width: '100%' }}
                    />
                  </div>
                </div>

                <Flex justify="flex-end" gap={8} wrap className="inline-editor-actions">
                  <Button onClick={cancelEdit} disabled={updatingStopId === leg.stop_id}>Cancel</Button>
                  <Button type="primary" loading={updatingStopId === leg.stop_id} onClick={() => void saveEdit()}>
                    Save & recalibrate
                  </Button>
                </Flex>
              </div>
            )}

            <div className="route-rationale">
              <Text strong>Why this stop is here</Text>
              <Text type="secondary">{leg.rationale.join(' ')}</Text>
            </div>

            <Flex justify="space-between" align="center" gap={12} wrap className="route-card-actions">
              <Space size={6}>
                <EnvironmentOutlined />
                <Text type="secondary">Finished this stop?</Text>
              </Space>
              <Flex gap={8} wrap>
                <Button
                  icon={<EditOutlined />}
                  disabled={busy && updatingStopId !== leg.stop_id}
                  onClick={() => editing ? cancelEdit() : beginEdit(leg)}
                >
                  {editing ? 'Close editor' : 'Edit stop details'}
                </Button>
                <Button
                  type="primary"
                  ghost
                  icon={<AimOutlined />}
                  loading={recalibratingStopId === leg.stop_id}
                  disabled={Boolean(busy && recalibratingStopId !== leg.stop_id) || editing}
                  onClick={() => onSetCurrentLocation(leg)}
                >
                  Set current location here
                </Button>
              </Flex>
            </Flex>
          </Card>
        )
      })}
    </div>
  )
}
