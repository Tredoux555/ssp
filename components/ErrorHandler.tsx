'use client'

import { useEffect } from 'react'

export function ErrorHandler() {
  useEffect(() => {
    // Handle unhandled promise rejections
    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      console.error('Unhandled promise rejection:', event.reason)
      // Prevent the error from appearing in console as unhandled
      event.preventDefault()
      // Optionally show user-friendly error message
      // You could dispatch a toast notification here
    }

    // Handle general errors
    const handleError = (event: ErrorEvent) => {
      console.error('Global error:', event.error)
      // Prevent default error handling if needed
      // event.preventDefault()
    }

    window.addEventListener('unhandledrejection', handleUnhandledRejection)
    window.addEventListener('error', handleError)

    return () => {
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
      window.removeEventListener('error', handleError)
    }
  }, [])

  return null
}

