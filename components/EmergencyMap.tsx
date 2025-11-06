'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import { GoogleMap, Marker, Polyline, useLoadScript, DirectionsService, DirectionsRenderer } from '@react-google-maps/api'
import { subscribeToLocationHistory } from '@/lib/realtime/subscriptions'
import { createClient } from '@/lib/supabase'
import { LocationHistory } from '@/types/database'

interface EmergencyMapProps {
  latitude: number
  longitude: number
  alertId: string
  user_id: string
  receiverLocation?: { lat: number; lng: number } | null
  receiverLocationHistory?: LocationHistory[]
  receiverUserId?: string
  senderUserId?: string
  receiverLocations?: Map<string, LocationHistory[]>
  receiverUserIds?: string[]
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
  receiverLocation,
  receiverLocationHistory = [],
  receiverUserId,
  senderUserId,
  receiverLocations,
  receiverUserIds = [],
}: EmergencyMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  
  // Use useLoadScript hook for proper Google Maps loading
  const { isLoaded, loadError } = useLoadScript({
    googleMapsApiKey: apiKey,
    // Suppress console errors from Google Maps API
    preventGoogleFontsLoading: true,
  })

  const [map, setMap] = useState<any>(null)
  const [senderLocation, setSenderLocation] = useState<{ lat: number; lng: number }>({
    lat: latitude,
    lng: longitude,
  })
  const [senderLocationHistory, setSenderLocationHistory] = useState<LocationHistory[]>([])
  const [receiverLoc, setReceiverLoc] = useState<{ lat: number; lng: number } | null>(receiverLocation || null)
  const [receiverLocHistory, setReceiverLocHistory] = useState<LocationHistory[]>(receiverLocationHistory || [])
  const [allReceiverLocations, setAllReceiverLocations] = useState<Map<string, LocationHistory[]>>(receiverLocations || new Map())
  const [allReceiverUserIds, setAllReceiverUserIds] = useState<string[]>(receiverUserIds || [])
  const [lastUpdateTime, setLastUpdateTime] = useState<Date | null>(null)
  const [isLiveTracking, setIsLiveTracking] = useState(false)
  const [directionsResult, setDirectionsResult] = useState<google.maps.DirectionsResult | null>(null)
  const [directionsError, setDirectionsError] = useState<string | null>(null)
  const [directionsLoading, setDirectionsLoading] = useState(false)
  const directionsServiceRef = useRef<google.maps.DirectionsService | null>(null)
  const lastDirectionsUpdateRef = useRef<{ origin: { lat: number; lng: number }; destination: { lat: number; lng: number } } | null>(null)
  const directionsTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Update sender location when props change
  useEffect(() => {
    setSenderLocation({ lat: latitude, lng: longitude })
  }, [latitude, longitude])
  
  // Update receiver location when props change
  useEffect(() => {
    if (receiverLocation) {
      setReceiverLoc(receiverLocation)
    }
  }, [receiverLocation])
  
  // Update receiver location history when props change
  useEffect(() => {
    if (receiverLocationHistory && receiverLocationHistory.length > 0) {
      setReceiverLocHistory(receiverLocationHistory)
    }
  }, [receiverLocationHistory])
  
  // Update all receiver locations when props change (for sender's map)
  useEffect(() => {
    if (receiverLocations) {
      setAllReceiverLocations(receiverLocations)
    }
  }, [receiverLocations])
  
  // Update receiver user IDs when props change
  useEffect(() => {
    if (receiverUserIds) {
      setAllReceiverUserIds(receiverUserIds)
    }
  }, [receiverUserIds])
  
  // Query all existing locations for the alert on mount
  useEffect(() => {
    if (!alertId) return
    
    const loadAllLocations = async () => {
      try {
        const supabase = createClient()
        if (!supabase) return
        
        const { data: allLocations, error } = await supabase
          .from('location_history')
          .select('*')
          .eq('alert_id', alertId)
          .order('created_at', { ascending: true })
        
        if (error) {
          console.warn('Failed to load location history:', error)
          return
        }
        
        if (allLocations && allLocations.length > 0) {
          // Separate sender and receiver locations
          const senderLocs = allLocations.filter((loc: LocationHistory) => loc.user_id === (senderUserId || user_id))
          const receiverLocs = allLocations.filter((loc: LocationHistory) => loc.user_id === receiverUserId && receiverUserId)
          
          if (senderLocs.length > 0) {
            setSenderLocationHistory(senderLocs)
            const latestSender = senderLocs[senderLocs.length - 1]
            setSenderLocation({
              lat: latestSender.latitude,
              lng: latestSender.longitude,
            })
          }
          
          if (receiverLocs.length > 0) {
            setReceiverLocHistory(receiverLocs)
            // Only use location_history if receiverLocation prop is not available
            // This ensures we use the current location from the parent component
            if (!receiverLocation) {
              const latestReceiver = receiverLocs[receiverLocs.length - 1]
              setReceiverLoc({
                lat: latestReceiver.latitude,
                lng: latestReceiver.longitude,
              })
            }
          }
        }
      } catch (error) {
        console.warn('Error loading location history:', error)
      }
    }
    
    loadAllLocations()
  }, [alertId, senderUserId, receiverUserId, user_id])

  // Subscribe to location history updates
  useEffect(() => {
    if (!alertId) return

    const unsubscribe = subscribeToLocationHistory(alertId, (newLocation) => {
      // Determine if this is sender or receiver location
      const isSenderLocation = newLocation.user_id === (senderUserId || user_id)
      const isReceiverLocation = receiverUserId && newLocation.user_id === receiverUserId
      
      if (isSenderLocation) {
        // Update sender location
        setSenderLocationHistory((prev) => [...prev, newLocation])
        setSenderLocation({
          lat: newLocation.latitude,
          lng: newLocation.longitude,
        })
      } else if (isReceiverLocation) {
        // Update receiver location (for receiver's own map)
        setReceiverLocHistory((prev) => [...prev, newLocation])
        setReceiverLoc({
          lat: newLocation.latitude,
          lng: newLocation.longitude,
        })
      } else if (senderUserId && newLocation.user_id !== senderUserId) {
        // This is a receiver location update (for sender's map showing all receivers)
        setAllReceiverLocations((prev) => {
          const updated = new Map(prev)
          const receiverId = newLocation.user_id
          
          if (!updated.has(receiverId)) {
            updated.set(receiverId, [])
            setAllReceiverUserIds((prevIds) => {
              if (!prevIds.includes(receiverId)) {
                return [...prevIds, receiverId]
              }
              return prevIds
            })
          }
          
          updated.get(receiverId)!.push(newLocation)
          return updated
        })
      }
      
      setLastUpdateTime(new Date())
      setIsLiveTracking(true)

      // Pan map to new location with smooth animation (pan to sender if sender, receiver if receiver)
      if (map && typeof window !== 'undefined' && window.google?.maps) {
        if (isSenderLocation) {
          map.panTo({
            lat: newLocation.latitude,
            lng: newLocation.longitude,
          })
        } else if (isReceiverLocation && receiverLoc) {
          // Optionally pan to receiver location, or keep centered on sender
          // For now, we'll keep it centered on sender (emergency location)
        }
      }
    })

    return unsubscribe
  }, [alertId, map, senderUserId, receiverUserId, user_id, receiverLoc])

  // Calculate directions from receiver to sender
  const calculateDirections = useCallback((origin: { lat: number; lng: number }, destination: { lat: number; lng: number }) => {
    // Check if locations have changed significantly (>50m) to avoid unnecessary recalculations
    const lastUpdate = lastDirectionsUpdateRef.current
    if (lastUpdate) {
      const originChanged = Math.abs(origin.lat - lastUpdate.origin.lat) > 0.0005 || 
                           Math.abs(origin.lng - lastUpdate.origin.lng) > 0.0005
      const destChanged = Math.abs(destination.lat - lastUpdate.destination.lat) > 0.0005 || 
                         Math.abs(destination.lng - lastUpdate.destination.lng) > 0.0005
      
      if (!originChanged && !destChanged) {
        return // Locations haven't changed significantly, skip recalculation
      }
    }

    // Clear any existing timeout
    if (directionsTimeoutRef.current) {
      clearTimeout(directionsTimeoutRef.current)
    }

    // Debounce directions calculation (2 seconds)
    directionsTimeoutRef.current = setTimeout(() => {
      if (typeof window === 'undefined' || !window.google?.maps) {
        console.warn('Google Maps API not available')
        return
      }

      if (!directionsServiceRef.current) {
        directionsServiceRef.current = new window.google.maps.DirectionsService()
      }

      setDirectionsLoading(true)
      setDirectionsError(null)

      directionsServiceRef.current.route(
        {
          origin: new window.google.maps.LatLng(origin.lat, origin.lng),
          destination: new window.google.maps.LatLng(destination.lat, destination.lng),
          travelMode: window.google.maps.TravelMode.DRIVING,
        },
        (result, status) => {
          setDirectionsLoading(false)
          
          if (status === window.google.maps.DirectionsStatus.OK && result) {
            setDirectionsResult(result)
            setDirectionsError(null)
            lastDirectionsUpdateRef.current = { origin, destination }
          } else {
            setDirectionsResult(null)
            if (status === window.google.maps.DirectionsStatus.ZERO_RESULTS) {
              setDirectionsError('No route found')
            } else if (status === window.google.maps.DirectionsStatus.REQUEST_DENIED) {
              setDirectionsError('Directions request denied')
            } else if (status === window.google.maps.DirectionsStatus.OVER_QUERY_LIMIT) {
              setDirectionsError('Directions API quota exceeded')
            } else {
              setDirectionsError(`Directions error: ${status}`)
            }
          }
        }
      )
    }, 2000) // 2 second debounce
  }, [])

  // Calculate directions when both receiver and sender locations are available
  useEffect(() => {
    if (!receiverLoc || !senderLocation) {
      setDirectionsResult(null)
      return
    }

    // Only calculate directions for receiver's view (when receiverUserId is set and different from sender)
    if (receiverUserId && receiverUserId !== (senderUserId || user_id)) {
      calculateDirections(receiverLoc, senderLocation)
    }

    return () => {
      if (directionsTimeoutRef.current) {
        clearTimeout(directionsTimeoutRef.current)
      }
    }
  }, [receiverLoc, senderLocation, receiverUserId, senderUserId, user_id, calculateDirections])

  // Adjust map bounds when directions are available
  useEffect(() => {
    if (directionsResult && map && receiverLoc && typeof window !== 'undefined' && window.google?.maps) {
      const bounds = new window.google.maps.LatLngBounds()
      bounds.extend(senderLocation)
      bounds.extend(receiverLoc)
      map.fitBounds(bounds)
    }
  }, [directionsResult, map, receiverLoc, senderLocation])

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
            Location: {senderLocation.lat.toFixed(6)}, {senderLocation.lng.toFixed(6)}
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
            Location: {senderLocation.lat.toFixed(6)}, {senderLocation.lng.toFixed(6)}
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
    <div className="w-full h-full relative">
      {/* Live Tracking Indicator */}
      {isLiveTracking && (
        <div className="absolute top-2 left-2 z-10 bg-green-500 text-white px-3 py-1 rounded-full text-xs font-medium flex items-center gap-2 shadow-lg">
          <div className="w-2 h-2 bg-white rounded-full animate-pulse"></div>
          Live Tracking
          {lastUpdateTime && (
            <span className="text-xs opacity-90">
              ({Math.floor((Date.now() - lastUpdateTime.getTime()) / 1000)}s ago)
            </span>
          )}
        </div>
      )}

      {/* Directions Route Info */}
      {directionsResult && directionsResult.routes[0] && (
        <div className="absolute top-2 right-2 z-10 bg-blue-600 text-white px-3 py-2 rounded-lg text-xs font-medium shadow-lg max-w-xs">
          <div className="font-semibold mb-1">Route to Emergency</div>
          {directionsResult.routes[0].legs[0] && (
            <>
              <div className="text-xs opacity-90">
                {directionsResult.routes[0].legs[0].distance?.text} • {directionsResult.routes[0].legs[0].duration?.text}
              </div>
            </>
          )}
        </div>
      )}

      {/* Directions Loading Indicator */}
      {directionsLoading && (
        <div className="absolute top-2 right-2 z-10 bg-blue-500 text-white px-3 py-1 rounded-lg text-xs font-medium shadow-lg">
          Calculating route...
        </div>
      )}

      {/* Directions Error */}
      {directionsError && !directionsLoading && (
        <div className="absolute top-2 right-2 z-10 bg-orange-500 text-white px-3 py-1 rounded-lg text-xs font-medium shadow-lg max-w-xs">
          {directionsError}
        </div>
      )}
      
      <GoogleMap
        mapContainerStyle={mapContainerStyle}
        center={senderLocation}
        zoom={directionsResult && receiverLoc ? undefined : 15}
        onLoad={onLoad}
        options={{
          disableDefaultUI: false,
          zoomControl: true,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: true,
        }}
      >
        {/* Sender location marker (Emergency Location - Red) */}
        <Marker
          position={senderLocation}
          title="Emergency Location (Sender)"
          icon={
            googleMaps
              ? {
                  path: googleMaps.SymbolPath.CIRCLE,
                  scale: 8,
                  fillColor: '#DE3831',
                  fillOpacity: 1,
                  strokeColor: '#FFFFFF',
                  strokeWeight: 3,
                }
              : undefined
          }
        />

        {/* Receiver location marker (Responder Location - Blue) */}
        {receiverLoc && (
          <Marker
            position={receiverLoc}
            title="Your Location (Responder)"
            icon={
              googleMaps
                ? {
                    path: googleMaps.SymbolPath.CIRCLE,
                    scale: 8,
                    fillColor: '#2563EB',
                    fillOpacity: 1,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 3,
                  }
                : undefined
            }
          />
        )}

        {/* Directions route (replaces simple polyline when available) */}
        {directionsResult && googleMaps && (
          <DirectionsRenderer
            directions={directionsResult}
            options={{
              suppressMarkers: true, // Keep our custom markers
              polylineOptions: {
                strokeColor: '#2563EB',
                strokeOpacity: 0.8,
                strokeWeight: 4,
              },
            }}
          />
        )}

        {/* Fallback polyline if no directions available */}
        {!directionsResult && receiverLoc && googleMaps && (
          <Polyline
            path={[senderLocation, receiverLoc]}
            options={{
              strokeColor: '#6B7280',
              strokeOpacity: 0.6,
              strokeWeight: 2,
              geodesic: true,
            }}
          />
        )}

        {/* Sender location history trail (Red) */}
        {senderLocationHistory.map((loc, index) => (
          <Marker
            key={`sender-${loc.id}-${index}`}
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

        {/* Receiver location history trail (Blue) - for single receiver view */}
        {receiverLocHistory.map((loc, index) => (
          <Marker
            key={`receiver-${loc.id}-${index}`}
            position={{
              lat: loc.latitude,
              lng: loc.longitude,
            }}
            icon={
              googleMaps
                ? {
                    path: googleMaps.SymbolPath.CIRCLE,
                    scale: 4,
                    fillColor: '#2563EB',
                    fillOpacity: 0.6,
                    strokeColor: '#FFFFFF',
                    strokeWeight: 2,
                  }
                : undefined
            }
          />
        ))}

        {/* Multiple receiver locations (for sender's map) */}
        {Array.from(allReceiverLocations.entries()).map(([receiverId, locations]) => {
          if (locations.length === 0) return null
          const latestLocation = locations[locations.length - 1]
          
          return (
            <div key={`receiver-${receiverId}`}>
              {/* Receiver current location marker */}
              <Marker
                position={{
                  lat: latestLocation.latitude,
                  lng: latestLocation.longitude,
                }}
                title={`Responder Location (${receiverId.slice(0, 8)}...)`}
                icon={
                  googleMaps
                    ? {
                        path: googleMaps.SymbolPath.CIRCLE,
                        scale: 8,
                        fillColor: '#2563EB',
                        fillOpacity: 1,
                        strokeColor: '#FFFFFF',
                        strokeWeight: 3,
                      }
                    : undefined
                }
              />
              
              {/* Polyline from sender to this receiver */}
              {googleMaps && (
                <Polyline
                  key={`polyline-${receiverId}`}
                  path={[senderLocation, { lat: latestLocation.latitude, lng: latestLocation.longitude }]}
                  options={{
                    strokeColor: '#2563EB',
                    strokeOpacity: 0.4,
                    strokeWeight: 2,
                    geodesic: true,
                  }}
                />
              )}
              
              {/* Receiver location history trail */}
              {locations.map((loc, index) => (
                <Marker
                  key={`receiver-${receiverId}-${loc.id}-${index}`}
                  position={{
                    lat: loc.latitude,
                    lng: loc.longitude,
                  }}
                  icon={
                    googleMaps
                      ? {
                          path: googleMaps.SymbolPath.CIRCLE,
                          scale: 4,
                          fillColor: '#2563EB',
                          fillOpacity: 0.6,
                          strokeColor: '#FFFFFF',
                          strokeWeight: 2,
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )
        })}
      </GoogleMap>
    </div>
  )
}

