'use client'

import { useState } from 'react'
import { useLocationPermission } from '@/lib/hooks/useLocationPermission'
import Button from '@/components/Button'
import Card from '@/components/Card'
import { MapPin, AlertCircle, RefreshCw } from 'lucide-react'

interface LocationPermissionPromptProps {
  onPermissionGranted?: () => void
  onDismiss?: () => void
}

export default function LocationPermissionPrompt({
  onPermissionGranted,
  onDismiss,
}: LocationPermissionPromptProps) {
  const { permissionStatus, isChecking, requestPermission, checkPermission } = useLocationPermission()
  const [isRequesting, setIsRequesting] = useState(false)

  const handleRequestPermission = async () => {
    setIsRequesting(true)
    const status = await requestPermission()
    setIsRequesting(false)
    
    if (status === 'granted' && onPermissionGranted) {
      onPermissionGranted()
    } else {
      // Re-check permission status
      checkPermission()
    }
  }

  if (permissionStatus === 'granted') {
    return null
  }

  if (isChecking) {
    return (
      <Card className="mb-4 border-yellow-500 bg-yellow-50">
        <div className="flex items-center gap-3">
          <RefreshCw className="w-5 h-5 text-yellow-600 animate-spin" />
          <p className="text-sm text-yellow-800">Checking location permissions...</p>
        </div>
      </Card>
    )
  }

  if (permissionStatus === 'unsupported') {
    return (
      <Card className="mb-4 border-red-500 bg-red-50">
        <div className="flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-red-600 mt-0.5" />
          <div className="flex-1">
            <p className="text-sm font-medium text-red-800 mb-1">Location Not Supported</p>
            <p className="text-xs text-red-700">
              Your browser does not support location services. Please use a modern browser with location support.
            </p>
          </div>
        </div>
      </Card>
    )
  }

  return (
    <Card className="mb-4 border-orange-500 bg-orange-50">
      <div className="flex items-start gap-3">
        <MapPin className="w-5 h-5 text-orange-600 mt-0.5" />
        <div className="flex-1">
          <p className="text-sm font-medium text-orange-800 mb-1">Location Permission Required</p>
          <p className="text-xs text-orange-700 mb-3">
            To track your location during emergencies and help responders find you, please enable location access.
          </p>
          
          <div className="flex gap-2">
            <Button
              variant="primary"
              size="sm"
              onClick={handleRequestPermission}
              disabled={isRequesting}
            >
              {isRequesting ? 'Requesting...' : 'Enable Location'}
            </Button>
            
            {onDismiss && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onDismiss}
              >
                Dismiss
              </Button>
            )}
          </div>
          
          {permissionStatus === 'denied' && (
            <div className="mt-3 p-2 bg-orange-100 rounded text-xs text-orange-800">
              <p className="font-medium mb-1">Location access was denied</p>
              <p className="mb-2">To enable location:</p>
              <ol className="list-decimal list-inside space-y-1 ml-2">
                <li>Click the lock icon in your browser's address bar</li>
                <li>Find "Location" in the permissions list</li>
                <li>Change it to "Allow"</li>
                <li>Refresh this page</li>
              </ol>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

