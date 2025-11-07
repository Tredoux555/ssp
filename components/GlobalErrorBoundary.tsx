'use client'

import React, { Component, ErrorInfo, ReactNode } from 'react'
import Button from './Button'
import { AlertTriangle } from 'lucide-react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
}

/**
 * Global Error Boundary to catch React errors and prevent complete app crash
 */
export class GlobalErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Global error boundary caught an error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    // Force reload to clear any corrupted state
    window.location.href = '/'
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Application Error</h1>
            <p className="text-gray-600 mb-4">
              Something went wrong. Please try refreshing the page.
            </p>
            {this.state.error && (
              <p className="text-sm text-gray-500 mb-4 font-mono">
                {this.state.error.message}
              </p>
            )}
            <div className="space-y-3">
              <Button
                onClick={this.handleReset}
                variant="primary"
                className="w-full"
              >
                Go to Home
              </Button>
              <Button
                onClick={() => window.location.reload()}
                variant="secondary"
                className="w-full"
              >
                Reload Page
              </Button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

