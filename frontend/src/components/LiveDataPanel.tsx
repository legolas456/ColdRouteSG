import { CameraOutlined, CarOutlined, CloudOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Empty, Flex, Image, Row, Skeleton, Statistic, Tag, Typography } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { ParkingSummary, TrafficFeed, WeatherFeed } from '../types'

const { Text, Title } = Typography

export function LiveDataPanel() {
  const [weather, setWeather] = useState<WeatherFeed | null>(null)
  const [parking, setParking] = useState<ParkingSummary | null>(null)
  const [traffic, setTraffic] = useState<TrafficFeed | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [w, p, t] = await Promise.all([api.weather(), api.parking(), api.trafficCameras()])
      setWeather(w)
      setParking(p)
      setTraffic(t)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unable to load public data')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  return (
    <Card className="panel-card" bordered={false}>
      <Flex justify="space-between" align="center" wrap gap={12}>
        <div>
          <Title level={4} style={{ margin: 0 }}>Public data monitor</Title>
          <Text type="secondary">Weather, parking availability and traffic-camera information from public data sources.</Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void refresh()}>Refresh</Button>
      </Flex>

      {error && <Alert type="error" message={error} showIcon style={{ marginTop: 12 }} />}
      {loading && !weather ? <Skeleton active style={{ marginTop: 20 }} /> : (
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} lg={8}>
            <Card title={<><CloudOutlined /> Weather forecast <Tag>{weather?.source ?? '—'}</Tag></>}>
              {weather?.warning && <Alert type="warning" showIcon message={weather.warning} style={{ marginBottom: 10 }} />}
              <div className="tag-cloud">
                {weather?.areas.slice(0, 12).map((area) => (
                  <Tag key={area.area} color={area.risk >= 0.7 ? 'red' : area.risk >= 0.4 ? 'orange' : 'blue'}>
                    {area.area}: {area.forecast}
                  </Tag>
                ))}
              </div>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title={<><CarOutlined /> HDB parking <Tag>{parking?.source ?? '—'}</Tag></>}>
              {parking?.warning && <Alert type="warning" showIcon message={parking.warning} style={{ marginBottom: 10 }} />}
              <Row gutter={[12, 12]}>
                <Col span={12}><Statistic title="Carparks" value={parking?.total_carparks ?? 0} /></Col>
                <Col span={12}><Statistic title="Available lots" value={parking?.available_lots ?? 0} /></Col>
                <Col span={24}><Statistic title="Network availability" value={(parking?.availability_ratio ?? 0) * 100} suffix="%" precision={1} /></Col>
              </Row>
            </Card>
          </Col>
          <Col xs={24} lg={8}>
            <Card title={<><CameraOutlined /> Traffic cameras <Tag>{traffic?.source ?? '—'}</Tag></>}>
              {traffic?.warning && <Alert type="warning" showIcon message={traffic.warning} style={{ marginBottom: 10 }} />}
              {!traffic?.cameras?.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No cameras returned" /> : (
                <div className="camera-grid">
                  {traffic.cameras.slice(0, 4).map((camera, index) => (
                    <div key={camera.camera_id ?? index} className="camera-tile">
                      {camera.image ? (
                        <Image src={camera.image} height={105} width="100%" style={{ objectFit: 'cover', borderRadius: 8 }} fallback="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='100'%3E%3Crect width='100%25' height='100%25' fill='%23e5e7eb'/%3E%3C/svg%3E" />
                      ) : <div className="camera-placeholder">Camera unavailable</div>}
                      <Text type="secondary" className="camera-label">Camera {camera.camera_id ?? index + 1}</Text>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </Col>
        </Row>
      )}
    </Card>
  )
}
