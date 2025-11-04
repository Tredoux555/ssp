'use client'

import { useEffect, useState, useMemo } from 'react'
import { GoogleMap, LoadScript, Marker } from '@react-google-maps/api'
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

const defaultCenter = {
  lat: -25.7461, // South Africa center
  lng: 28.1881,
}

// Track if Google Maps script is already loaded to prevent duplicate initialization
let googleMapsScriptLoaded = false
let googleMapsScriptLoading = false

export default function EmergencyMapComponent({
  latitude,
  longitude,
  alertId,
  user_id,
}: EmergencyMapProps) {
  const [map, setMap] = useState<google.maps.Map | null>(null)
  const [currentLocation, setCurrentLocation] = useState<{ lat: number; lng: number }>({
    lat: latitude,
    lng: longitude,
  })
  const [locationHistory, setLocationHistory] = useState<LocationHistory[]>([])
  const [mapsLoaded, setMapsLoaded] = useState(false)

  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''

  // Check if Google Maps is already loaded
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Check if Google Maps API is already available
      if (window.google?.maps) {
        googleMapsScriptLoaded = true
        setMapsLoaded(true)
        return
      }

      // Check if script is already in DOM
      const existingScript = document.querySelector(`script[src*="maps.googleapis.com"]`)
      if (existingScript) {
        googleMapsScriptLoaded = true
        // Wait for script to load
        existingScript.addEventListener('load', () => {
          setMapsLoaded(true)
        })
        // Check if already loaded
        if (window.google?.maps) {
          setMapsLoaded(true)
        }
      }
    }
  }, [])

  // Memoize to prevent unnecessary re-renders
  const shouldLoadScript = useMemo(() => {
    return apiKey && !googleMapsScriptLoaded && !mapsLoaded
  }, [apiKey, mapsLoaded])

  useEffect(() => {
    setCurrentLocation({ lat: latitude, lng: longitude })
  }, [latitude, longitude])

  useEffect(() => {
    if (!alertId) return

    // Subscribe to location updates
    const unsubscribe = subscribeToLocationHistory(alertId, (newLocation) => {
      setLocationHistory((prev) => [...prev, newLocation])
      setCurrentLocation({
        lat: newLocation.latitude,
        lng: newLocation.longitude,
      })

      // Pan map to new location
      if (map) {
        map.panTo({
          lat: newLocation.latitude,
          lng: newLocation.longitude,
        })
      }
    })

    return unsubscribe
  }, [alertId, map])

  const onLoad = (mapInstance: google.maps.Map) => {
    setMap(mapInstance)
  }

  const onScriptLoad = () => {
    googleMapsScriptLoaded = true
    googleMapsScriptLoading = false
    setMapsLoaded(true)
  }

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

  // If Google Maps is already loaded, render map directly
  if (mapsLoaded || (typeof window !== 'undefined' && window.google?.maps)) {
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
        {/* Current location marker - use default red marker instead of custom icon */}
        <Marker
          position={currentLocation}
          title="Emergency Location"
          // Use default Google Maps red marker - no custom icon needed
        />

        {/* Location history trail */}
        {locationHistory.map((loc, index) => (
          <Marker
            key={`${loc.id}-${index}`}
            position={{
              lat: loc.latitude,
              lng: loc.longitude,
            }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 4,
              fillColor: '#DE3831',
              fillOpacity: 0.6,
              strokeColor: '#FFFFFF',
              strokeWeight: 2,
            }}
          />
        ))}
      </GoogleMap>
    )
  }

  // Load script only if not already loaded
  if (!googleMapsScriptLoading && shouldLoadScript) {
    googleMapsScriptLoading = true
  }

  return (
    <LoadScript 
      googleMapsApiKey={apiKey}
      onLoad={onScriptLoad}
    >
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
        {/* Current location marker - use default red marker instead of custom icon */}
        <Marker
          position={currentLocation}
          title="Emergency Location"
          // Use default Google Maps red marker - no custom icon needed
        />

        {/* Location history trail */}
        {locationHistory.map((loc, index) => (
          <Marker
            key={`${loc.id}-${index}`}
            position={{
              lat: loc.latitude,
              lng: loc.longitude,
            }}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              scale: 4,
              fillColor: '#DE3831',
              fillOpacity: 0.6,
              strokeColor: '#FFFFFF',
              strokeWeight: 2,
            }}
          />
        ))}
      </GoogleMap>
    </LoadScript>
  )
}

