'use client'

import { useEffect, useState } from 'react'
import { GoogleMap, Marker, useLoadScript } from '@react-google-maps/api'
import { subscribeToLocationHistory } from '@/lib/realtime/subscriptions'
import { LocationHistory } from '@/types/database'

interface EmergencyMapProps {
  latitude: number
  longitude: number
  alertId: string
  user_id: string
}

const mapContainerStyle = {
  width: '100%',
  height: '100%',
}

export default function EmergencyMapComponent({
  latitude,
  longitude,
  alertId,
  user_id,
}: EmergencyMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  
  // Use useLoadScript hook for proper Google Maps loading
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey,
    // Suppress console errors from Google Maps API
    preventGoogleFontsLoading: true,
  })

  const [map, setMap] = useState<any>(null)
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number }>({
    lat: latitude,
    lng: longitude,
  })
  const [locationHistory, setLocationHistory] = useState<LocationHistory[]>([])

  // Update current location when props change
  useEffect(() => {
    setCurrentLocation({ lat: latitude, lng: longitude })
  }, [latitude, longitude])

  // Subscribe to location history updates
  useEffect(() => {
    if (!alertId) return

    const unsubscribe = subscribeToLocationHistory(alertId, (newLocation) => {
      setLocationHistory((prev) => [...prev, newLocation])
      setCurrentLocation({
        lat: newLocation.latitude,
        lng: newLocation.longitude,
      })

      // Pan map to new location
      if (map && typeof window !== 'undefined' && window.google?.maps) {
        map.panTo({
          lat: newLocation.latitude,
          lng: newLocation.longitude,
        })
      }
    })

    return unsubscribe
  }, [alertId, map])

  const onLoad = (mapInstance: any) => {
    setMap(mapInstance)
  }

  // Handle loading states
  if (!apiKey) {
    return (
      <div className="w-full h-full bg-gray-200 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-gray-600 font-medium mb-2">Google Maps API key not configured</p>
          <p className="text-gray-500 text-sm">
            Location: {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}
          </p>
        </div>
      </div>
    )
  }

  if (loadError) {
    // Don't show error to user - just show coordinates
    // Google Maps API errors are expected in some cases (network, API key issues)
    return (
      <div className="w-full h-full bg-gray-200 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-gray-600 font-medium mb-2">Map unavailable</p>
          <p className="text-gray-500 text-sm">
            Location: {currentLocation.lat.toFixed(6)}, {currentLocation.lng.toFixed(6)}
          </p>
          <p className="text-gray-400 text-xs mt-2">
            Coordinates available - map display unavailable
          </p>
        </div>
      </div>
    )
  }

  if (!isLoaded) {
    return (
      <div className="w-full h-full bg-gray-200 flex items-center justify-center">
        <div className="text-center p-4">
          <p className="text-gray-600 font-medium">Loading map...</p>
        </div>
      </div>
    )
  }

  // Get Google Maps API - check if it's available
  const googleMaps = typeof window !== 'undefined' ? window.google?.maps : null

  return (
    <GoogleMap
      mapContainerStyle={mapContainerStyle}
      center={currentLocation}
      zoom={15}
      onLoad={onLoad}
      options={{
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: true,
      }}
    >
      {/* Current location marker */}
      <Marker
        position={currentLocation}
        title="Emergency Location"
      />

      {/* Location history trail */}
      {locationHistory.map((loc, index) => (
        <Marker
          key={`${loc.id}-${index}`}
          position={{
            lat: loc.latitude,
            lng: loc.longitude,
          }}
          icon={
            googleMaps
              ? {
                  path: googleMaps.SymbolPath.CIRCLE,
                  scale: 4,
                  fillColor: '#DE3831',
                  fillOpacity: 0.6,
                  strokeColor: '#FFFFFF',
                  strokeWeight: 2,
                }
              : undefined
          }
        />
      ))}
    </GoogleMap>
  )
}

