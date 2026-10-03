import {
  DeleteOutlined,
  EnvironmentOutlined,
  PlusOutlined,
  ReloadOutlined,
  RocketOutlined,
} from '@ant-design/icons'
import {
  AutoComplete,
  Button,
  Card,
  Divider,
  Flex,
  Input,
  InputNumber,
  Select,
  Space,
  Spin,
  Tag,
  TimePicker,
  Typography,
} from 'antd'
import dayjs from 'dayjs'
import { useRef, useState } from 'react'
import { api } from '../api/client'
import type { Coordinate, DeliveryStop, LocationSuggestion } from '../types'

const { Text, Title } = Typography

interface LocationFieldProps {
  value: string
  placeholder: string
  onTextChange: (value: string) => void
  onSelectLocation: (suggestion: LocationSuggestion) => void
}

export function LocationField({ value, placeholder, onTextChange, onSelectLocation }: LocationFieldProps) {
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([])
  const [searching, setSearching] = useState(false)
  const timerRef = useRef<number | null>(null)
  const requestRef = useRef(0)

  const search = (query: string) => {
    if (timerRef.current) window.clearTimeout(timerRef.current)
    if (query.trim().length < 2) {
      setSuggestions([])
      setSearching(false)
      return
    }

    const requestId = ++requestRef.current
    setSearching(true)
    timerRef.current = window.setTimeout(() => {
      void api.searchLocations(query)
        .then((response) => {
          if (requestId === requestRef.current) setSuggestions(response.results)
        })
        .catch(() => {
          if (requestId === requestRef.current) setSuggestions([])
        })
        .finally(() => {
          if (requestId === requestRef.current) setSearching(false)
        })
    }, 250)
  }

  const options = suggestions.map((suggestion) => ({
    value: suggestion.name,
    label: (
      <div className="location-option">
        <Text strong>{suggestion.name}</Text>
        {suggestion.label !== suggestion.name && <Text type="secondary">{suggestion.label.replace(`${suggestion.name} — `, '')}</Text>}
      </div>
    ),
  }))

  return (
    <AutoComplete
      value={value}
      options={options}
      onSearch={search}
      onChange={onTextChange}
      onSelect={(selectedName) => {
        const suggestion = suggestions.find((item) => item.name === selectedName)
        if (suggestion) onSelectLocation(suggestion)
        setSuggestions([])
      }}
      filterOption={false}
      style={{ width: '100%' }}
      notFoundContent={searching ? <Spin size="small" /> : null}
    >
      <Input prefix={<EnvironmentOutlined />} placeholder={placeholder} allowClear />
    </AutoComplete>
  )
}

interface Props {
  depot: Coordinate
  depotName: string
  departureTime: string
  stops: DeliveryStop[]
  loading: boolean
  onDepotChange: (value: Coordinate) => void
  onDepotNameChange: (value: string) => void
  onDepartureTimeChange: (value: string) => void
  onStopsChange: (value: DeliveryStop[]) => void
  onLoadSample: () => void
  onOptimize: () => void
}

export function DeliveryForm({
  depot,
  depotName,
  departureTime,
  stops,
  loading,
  onDepotChange,
  onDepotNameChange,
  onDepartureTimeChange,
  onStopsChange,
  onLoadSample,
  onOptimize,
}: Props) {
  const updateStop = (index: number, patch: Partial<DeliveryStop>) => {
    const next = [...stops]
    next[index] = { ...next[index], ...patch }
    onStopsChange(next)
  }

  const addStop = () => {
    const index = stops.length + 1
    onStopsChange([
      ...stops,
      {
        id: `STOP-${Date.now()}`,
        name: `Delivery ${index}`,
        lat: 1.3521,
        lng: 103.8198,
        service_minutes: 10,
        cold_chain_priority: 2,
        window_end: null,
      },
    ])
  }

  const removeStop = (index: number) => onStopsChange(stops.filter((_, i) => i !== index))

  return (
    <Card className="panel-card" bordered={false}>
      <Flex justify="space-between" align="center" gap={12} wrap>
        <div>
          <Title level={4} style={{ margin: 0 }}>Delivery locations</Title>
          <Text type="secondary">Enter the starting depot and delivery locations before building the route.</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={onLoadSample}>Load demo</Button>
      </Flex>

      <Divider orientation="left">Depot</Divider>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div>
          <Text strong>Location</Text>
          <LocationField
            value={depotName}
            placeholder="Start typing a depot or address"
            onTextChange={onDepotNameChange}
            onSelectLocation={(location) => {
              onDepotNameChange(location.name)
              onDepotChange({ lat: location.lat, lng: location.lng })
            }}
          />
          <Text type="secondary" className="field-hint">Select a suggested location so the route can be calculated accurately.</Text>
        </div>
        <Flex align="center" gap={10} wrap>
          <Text strong>Departure</Text>
          <TimePicker
            value={dayjs(departureTime, 'HH:mm')}
            format="HH:mm"
            minuteStep={5}
            onChange={(value) => value && onDepartureTimeChange(value.format('HH:mm'))}
          />
        </Flex>
      </Space>

      <Divider orientation="left">Delivery stops <Tag>{stops.length}</Tag></Divider>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        {stops.map((stop, index) => (
          <Card
            key={stop.id}
            size="small"
            title={<Text strong>{index + 1}. {stop.name}</Text>}
            extra={
              <Button
                type="text"
                danger
                icon={<DeleteOutlined />}
                disabled={stops.length <= 1}
                onClick={() => removeStop(index)}
              />
            }
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <div>
                <Text strong>Location</Text>
                <LocationField
                  value={stop.name}
                  placeholder="Start typing a delivery location"
                  onTextChange={(value) => updateStop(index, { name: value })}
                  onSelectLocation={(location) => updateStop(index, {
                    name: location.name,
                    lat: location.lat,
                    lng: location.lng,
                  })}
                />
              </div>

              <Flex gap={8} wrap>
                <InputNumber
                  min={0}
                  max={180}
                  style={{ flex: 1, minWidth: 140 }}
                  addonBefore="Service"
                  addonAfter="min"
                  value={stop.service_minutes}
                  onChange={(value) => updateStop(index, { service_minutes: Number(value ?? 10) })}
                />
                <TimePicker
                  style={{ flex: 1, minWidth: 140 }}
                  placeholder="Window end"
                  value={stop.window_end ? dayjs(stop.window_end, 'HH:mm') : null}
                  format="HH:mm"
                  minuteStep={5}
                  onChange={(value) => updateStop(index, { window_end: value ? value.format('HH:mm') : null })}
                  allowClear
                />
              </Flex>

              <Flex align="center" gap={10} wrap>
                <Text strong>Cold-chain priority</Text>
                <Select
                  style={{ minWidth: 180 }}
                  value={stop.cold_chain_priority}
                  onChange={(value: 1 | 2 | 3) => updateStop(index, { cold_chain_priority: value })}
                  options={[
                    { value: 1, label: '1 — Highest priority' },
                    { value: 2, label: '2 — Medium priority' },
                    { value: 3, label: '3 — Lower priority' },
                  ]}
                />
              </Flex>
            </Space>
          </Card>
        ))}
        <Button block dashed icon={<PlusOutlined />} onClick={addStop} disabled={stops.length >= 15}>Add delivery stop</Button>
      </Space>

      <Divider />
      <Button
        type="primary"
        size="large"
        block
        icon={<RocketOutlined />}
        loading={loading}
        onClick={onOptimize}
      >
        Continue to Route Planner
      </Button>
    </Card>
  )
}
