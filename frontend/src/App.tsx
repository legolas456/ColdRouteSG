import { Button, ConfigProvider, Result, Spin, theme } from 'antd'
import type { ThemeConfig } from 'antd'
import { Component, lazy, Suspense, useEffect, useMemo, useState } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

export type ThemeMode = 'light' | 'dark'

const Dashboard = lazy(() =>
  import('./components/Dashboard').then((module) => ({ default: module.Dashboard })),
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

export default function App() {
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')

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

  return (
    <AppErrorBoundary>
      <ConfigProvider theme={themeConfig}>
        <Suspense
          fallback={(
            <div className="app-loading-state">
              <Spin size="large" />
              <span>Loading ColdRoute SG…</span>
            </div>
          )}
        >
          <Dashboard
            themeMode={themeMode}
            onThemeModeChange={setThemeMode}
          />
        </Suspense>
      </ConfigProvider>
    </AppErrorBoundary>
  )
}
