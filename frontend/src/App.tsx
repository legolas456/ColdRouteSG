import {
  ArrowRightOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  EnvironmentOutlined,
  MoonOutlined,
  SafetyCertificateOutlined,
  SunOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { Authenticator, useAuthenticator } from '@aws-amplify/ui-react'
import { fetchAuthSession } from 'aws-amplify/auth'
import '@aws-amplify/ui-react/styles.css'
import { Button, ConfigProvider, Modal, Result, Spin, notification, theme } from 'antd'
import type { ThemeConfig } from 'antd'
import { Component, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark'

const Dashboard = lazy(() =>
  import('./components/Dashboard').then((module) => ({ default: module.Dashboard })),
)

const AdminDashboard = lazy(() =>
  import('./components/AdminDashboard').then((module) => ({ default: module.AdminDashboard })),
)

type BoundaryProps = { children: ReactNode }
type BoundaryState = { hasError: boolean; message: string }

class AppErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false, message: '' }

  static getDerivedStateFromError(error: Error): BoundaryState {
    return {
      hasError: true,
      message: error?.message || 'Unexpected frontend error',
    }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ColdRoute frontend error:', error, info)
  }

  render() {
    if (this.state.hasError) {
      return (
        <Result
          status="error"
          title="ColdRoute could not load"
          subTitle={this.state.message}
          extra={(
            <Button type="primary" onClick={() => window.location.reload()}>
              Reload page
            </Button>
          )}
        />
      )
    }
    return this.props.children
  }
}

const modalAuthenticatorComponents = {
  Header() {
    return (
      <div className="auth-modal-heading">
        <div className="auth-modal-mark" aria-hidden="true">
          <CloudServerOutlined />
        </div>
        <div>
          <span className="auth-modal-eyebrow">COLDROUTE SG</span>
          <h2>Plan your next delivery run</h2>
          <p>Sign in or create an account to continue to the route planner.</p>
          <div className="auth-modal-meta">
            <span><SafetyCertificateOutlined /> Secure sign-in</span>
            <span>Private route history</span>
          </div>
        </div>
      </div>
    )
  },
  Footer() {
    return (
      <div className="auth-modal-footer">
        Secure account access powered by Amazon Cognito.
      </div>
    )
  },
}



function LandingPage({
  onTry,
  themeMode,
  onThemeModeChange,
}: {
  onTry: () => void
  themeMode: ThemeMode
  onThemeModeChange: (mode: ThemeMode) => void
}) {
  return (
    <main className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="#top" aria-label="ColdRoute SG home">
          <span className="landing-brand-mark"><CloudServerOutlined /></span>
          <span>
            <strong>ColdRoute SG</strong>
            <small>Cold-chain route planning</small>
          </span>
        </a>

        <div className="landing-nav-actions">
          <Button
            type="text"
            shape="circle"
            className="landing-theme-toggle"
            icon={themeMode === 'dark' ? <SunOutlined /> : <MoonOutlined />}
            aria-label={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={themeMode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={() => onThemeModeChange(themeMode === 'dark' ? 'light' : 'dark')}
          />
          <span className="landing-secure-label">
            <SafetyCertificateOutlined /> Secure access
          </span>
          <Button type="primary" className="landing-nav-cta" onClick={onTry}>
            Try it out
          </Button>
        </div>
      </header>

      <section className="landing-hero" id="top">
        <div className="landing-hero-copy">
          <div className="landing-kicker">DELIVERY INTELLIGENCE FOR SINGAPORE</div>
          <h1>Plan every cold-chain stop with the context that matters.</h1>
          <p className="landing-hero-lead">
            ColdRoute SG helps dispatchers sequence deliveries using route travel time,
            delivery windows, cold-chain priority and live operating context from
            weather, traffic and parking data.
          </p>

          <div className="landing-hero-actions">
            <Button
              type="primary"
              size="large"
              className="landing-primary-cta"
              onClick={onTry}
            >
              Try it out <ArrowRightOutlined />
            </Button>
            <span className="landing-cta-note">Create an account in minutes.</span>
          </div>

          <div className="landing-trust-row">
            <span><CheckCircleOutlined /> Built for Singapore deliveries</span>
            <span><CheckCircleOutlined /> Responsive driver workflow</span>
            <span><CheckCircleOutlined /> Secure cloud architecture</span>
          </div>
        </div>

        <div className="landing-product-preview" aria-label="ColdRoute route plan preview">
          <div className="preview-window-bar">
            <div>
              <span className="preview-dot" />
              <span className="preview-dot" />
              <span className="preview-dot" />
            </div>
            <span>Route Planner</span>
          </div>

          <div className="preview-summary-row">
            <div>
              <span className="preview-label">Optimised route</span>
              <strong>4 delivery stops</strong>
            </div>
            <span className="preview-live-chip">LIVE CONTEXT</span>
          </div>

          <div className="preview-route-list">
            <div className="preview-route-item depot">
              <span className="preview-node">D</span>
              <div>
                <strong>Jurong Cold Storage Depot</strong>
                <small>Departure · 09:10</small>
              </div>
            </div>
            <div className="preview-route-line" />
            <div className="preview-route-item">
              <span className="preview-node">1</span>
              <div>
                <strong>Ang Mo Kio Central</strong>
                <small>ETA 09:42 · Parking available</small>
              </div>
              <span className="preview-status">On time</span>
            </div>
            <div className="preview-route-line" />
            <div className="preview-route-item">
              <span className="preview-node">2</span>
              <div>
                <strong>Novena</strong>
                <small>ETA 10:08 · Rain nearby</small>
              </div>
              <span className="preview-status attention">Watch</span>
            </div>
            <div className="preview-route-line" />
            <div className="preview-route-item">
              <span className="preview-node">3</span>
              <div>
                <strong>Marina Bay</strong>
                <small>ETA 10:31 · Priority 1</small>
              </div>
              <span className="preview-status">On time</span>
            </div>
          </div>

          <div className="preview-insight">
            <ThunderboltOutlined />
            <span>
              <strong>Recalibrate as conditions change.</strong>
              Update the current stop and ColdRoute replans the remaining delivery run.
            </span>
          </div>
        </div>
      </section>

      <section className="landing-section landing-features" aria-labelledby="landing-features-title">
        <div className="landing-section-heading">
          <span>ONE WORKFLOW, MORE OPERATING CONTEXT</span>
          <h2 id="landing-features-title">Designed around real delivery decisions.</h2>
          <p>
            Instead of treating route planning as a shortest-path problem alone,
            ColdRoute brings the operational constraints of a delivery run into one interface.
          </p>
        </div>

        <div className="landing-feature-grid">
          <article className="landing-feature-card">
            <div className="landing-feature-icon"><EnvironmentOutlined /></div>
            <h3>Route sequencing</h3>
            <p>
              Balance travel time, delivery windows, service duration and cold-chain
              priority to produce an actionable stop sequence.
            </p>
          </article>

          <article className="landing-feature-card">
            <div className="landing-feature-icon"><ThunderboltOutlined /></div>
            <h3>Live operating context</h3>
            <p>
              Bring weather, traffic and nearby parking conditions into the delivery
              planning workflow instead of checking them separately.
            </p>
          </article>

          <article className="landing-feature-card">
            <div className="landing-feature-icon"><SafetyCertificateOutlined /></div>
            <h3>Driver-ready updates</h3>
            <p>
              Use the responsive route planner on desktop or mobile and recalibrate
              the remaining stops as the delivery run progresses.
            </p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-workflow" aria-labelledby="landing-workflow-title">
        <div className="landing-section-heading compact">
          <span>HOW IT WORKS</span>
          <h2 id="landing-workflow-title">From delivery list to optimised route.</h2>
        </div>

        <div className="landing-workflow-grid">
          <div className="landing-workflow-step">
            <span>01</span>
            <div>
              <h3>Enter delivery stops</h3>
              <p>Add the depot, customer locations, service time and delivery windows.</p>
            </div>
          </div>
          <div className="landing-workflow-step">
            <span>02</span>
            <div>
              <h3>Set cold-chain priority</h3>
              <p>Identify the deliveries where delay and exposure matter most.</p>
            </div>
          </div>
          <div className="landing-workflow-step">
            <span>03</span>
            <div>
              <h3>Optimise and monitor</h3>
              <p>Review the recommended sequence, ETAs, map and operating conditions.</p>
            </div>
          </div>
        </div>

        <div className="landing-bottom-cta">
          <div>
            <span>READY TO PLAN A DELIVERY RUN?</span>
            <h2>Open ColdRoute SG and try the workflow.</h2>
          </div>
          <Button type="primary" size="large" onClick={onTry}>
            Try it out <ArrowRightOutlined />
          </Button>
        </div>
      </section>

      <footer className="landing-footer">
        <div className="landing-brand compact">
          <span className="landing-brand-mark"><CloudServerOutlined /></span>
          <span><strong>ColdRoute SG</strong></span>
        </div>
        <span>Cloud-based cold-chain delivery optimisation.</span>
      </footer>
    </main>
  )
}

function AppContent() {
  const { authStatus, user, signOut } = useAuthenticator((context) => [
    context.authStatus,
    context.user,
  ])
  const [authModalOpen, setAuthModalOpen] = useState(false)
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')
  const [roleChecked, setRoleChecked] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let nextTheme: ThemeMode = 'light'
    try {
      const saved = window.localStorage.getItem('coldroute-theme')
      if (saved === 'light' || saved === 'dark') {
        nextTheme = saved
      } else if (
        typeof window.matchMedia === 'function'
        && window.matchMedia('(prefers-color-scheme: dark)').matches
      ) {
        nextTheme = 'dark'
      }
    } catch {
      nextTheme = 'light'
    }
    setThemeMode(nextTheme)
  }, [])

  useEffect(() => {
    try {
      window.localStorage.setItem('coldroute-theme', themeMode)
    } catch {
      // Local storage can be unavailable in some browser modes.
    }
    document.documentElement.dataset.theme = themeMode
  }, [themeMode])

  useEffect(() => {
    if (authStatus === 'authenticated' && authModalOpen) {
      notification.success({
        key: 'coldroute-auth-sign-in-success',
        className: 'coldroute-auth-notification',
        message: 'Signed in successfully',
        description: 'Welcome back to ColdRoute SG.',
        placement: 'topRight',
        duration: 3.5,
      })
      setAuthModalOpen(false)
    }
  }, [authStatus, authModalOpen])

  useEffect(() => {
    let cancelled = false

    async function resolveRole() {
      if (authStatus !== 'authenticated') {
        if (!cancelled) {
          setIsAdmin(false)
          setRoleChecked(authStatus !== 'configuring')
        }
        return
      }

      if (!cancelled) setRoleChecked(false)

      try {
        const session = await fetchAuthSession()
        const payload = session.tokens?.accessToken?.payload ?? session.tokens?.idToken?.payload
        const rawGroups = payload?.['cognito:groups']
        const groups = Array.isArray(rawGroups)
          ? rawGroups.map(String)
          : typeof rawGroups === 'string'
            ? rawGroups.split(',').map((group) => group.trim()).filter(Boolean)
            : []

        if (!cancelled) setIsAdmin(groups.includes('admin'))
      } catch (error) {
        console.error('Unable to resolve Cognito role:', error)
        if (!cancelled) setIsAdmin(false)
      } finally {
        if (!cancelled) setRoleChecked(true)
      }
    }

    void resolveRole()
    return () => {
      cancelled = true
    }
  }, [authStatus, user?.username])

  const themeConfig = useMemo<ThemeConfig>(() => {
    const isDark = themeMode === 'dark'
    return {
      algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: isDark ? '#2dd4bf' : '#0f766e',
        colorInfo: isDark ? '#38bdf8' : '#0284c7',
        colorSuccess: isDark ? '#4ade80' : '#16a34a',
        colorWarning: isDark ? '#fbbf24' : '#d97706',
        colorError: isDark ? '#fb7185' : '#dc2626',
        colorBgBase: isDark ? '#07111b' : '#f3f6f8',
        colorBgContainer: isDark ? '#0d1a26' : '#ffffff',
        colorBgElevated: isDark ? '#112231' : '#ffffff',
        colorBorder: isDark ? '#274052' : '#dbe4ea',
        colorBorderSecondary: isDark ? '#1b3040' : '#e6edf2',
        colorText: isDark ? '#e8f1f7' : '#0f172a',
        colorTextSecondary: isDark ? '#91a8b8' : '#64748b',
        borderRadius: 12,
        borderRadiusLG: 16,
        controlHeight: 38,
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
        boxShadowSecondary: isDark
          ? '0 18px 50px rgba(0, 0, 0, 0.34)'
          : '0 14px 38px rgba(15, 23, 42, 0.08)',
      },
    }
  }, [themeMode])

  if (authStatus === 'configuring') {
    return (
      <ConfigProvider theme={themeConfig}>
        <div className="app-loading-state">
          <Spin size="large" />
          <span>Preparing ColdRoute SG…</span>
        </div>
      </ConfigProvider>
    )
  }

  if (authStatus === 'authenticated') {
    const username =
      user?.signInDetails?.loginId
      || user?.username
      || 'Signed-in user'

    if (!roleChecked) {
      return (
        <ConfigProvider theme={themeConfig}>
          <div className="app-loading-state">
            <Spin size="large" />
            <span>Checking account access…</span>
          </div>
        </ConfigProvider>
      )
    }

    return (
      <ConfigProvider theme={themeConfig}>
        <Suspense
          fallback={(
            <div className="app-loading-state">
              <Spin size="large" />
              <span>Loading ColdRoute SG…</span>
            </div>
          )}
        >
          {isAdmin ? (
            <AdminDashboard
              themeMode={themeMode}
              onThemeModeChange={setThemeMode}
              username={username}
              onSignOut={signOut}
            />
          ) : (
            <Dashboard
              themeMode={themeMode}
              onThemeModeChange={setThemeMode}
              username={username}
              onSignOut={signOut}
            />
          )}
        </Suspense>
      </ConfigProvider>
    )
  }

  return (
    <ConfigProvider theme={themeConfig}>
      <LandingPage
        onTry={() => setAuthModalOpen(true)}
        themeMode={themeMode}
        onThemeModeChange={setThemeMode}
      />

      <Modal
        open={authModalOpen}
        onCancel={() => setAuthModalOpen(false)}
        footer={null}
        width={560}
        centered
        className="auth-access-modal"
        title={null}
      >
        <div className="auth-modal-shell">
          <Authenticator
            loginMechanisms={['email']}
            components={modalAuthenticatorComponents}
          />
        </div>
      </Modal>
    </ConfigProvider>
  )
}

export default function App() {
  return (
    <AppErrorBoundary>
      <Authenticator.Provider>
        <AppContent />
      </Authenticator.Provider>
    </AppErrorBoundary>
  )
}
