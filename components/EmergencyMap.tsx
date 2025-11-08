'use client'

import { useEffect, useState, useRef, useCallback, useMemo, memo } from 'react'
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

function EmergencyMapComponent({
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
  // Initialize senderLocation with validation - ensure valid numbers
  const [senderLocation, setSenderLocation] = useState<{ lat: number; lng: number }>(() => {
    const validLat = latitude && !isNaN(latitude) ? latitude : 0
    const validLng = longitude && !isNaN(longitude) ? longitude : 0
    console.log('[Map] 🎬 Initializing senderLocation state:', { lat: validLat, lng: validLng, fromProps: { latitude, longitude } })
    return { lat: validLat, lng: validLng }
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
  const lastProcessedLatLngRef = useRef<{ lat: number; lng: number } | null>(null) // Track last processed props to prevent infinite loops
  const directionsErrorCountRef = useRef<number>(0) // Track consecutive errors to prevent infinite retries
  const lastDirectionsErrorRef = useRef<string | null>(null) // Track last error to prevent retrying same error

  // Update sender location when props change - with robust validation
  useEffect(() => {
    if (latitude && longitude && !isNaN(latitude) && !isNaN(longitude) && 
        typeof latitude === 'number' && typeof longitude === 'number' &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180) {
      
      // Check if props have actually changed (using ref, not state)
      // Use threshold to ignore tiny GPS variations (about 0.1 meters)
      const hasChanged = !lastProcessedLatLngRef.current || 
        Math.abs(lastProcessedLatLngRef.current.lat - latitude) > 0.000001 ||
        Math.abs(lastProcessedLatLngRef.current.lng - longitude) > 0.000001
      
      if (hasChanged) {
        const newLocation = { lat: latitude, lng: longitude }
        console.log('[Map] 📍 Updating sender location from props:', {
          lat: latitude,
          lng: longitude,
          hasLatLng: true,
          previousLocation: lastProcessedLatLngRef.current
        })
        setSenderLocation(newLocation)
        lastProcessedLatLngRef.current = newLocation // Update ref with new values
      }
    } else {
      console.warn('[Map] ⚠️ Invalid sender location props:', { 
        latitude, 
        longitude,
        latType: typeof latitude,
        lngType: typeof longitude,
        latIsNaN: isNaN(latitude as number),
        lngIsNaN: isNaN(longitude as number)
      })
    }
  }, [latitude, longitude]) // Only depend on props, not state
  
  // Update receiver location when props change
  useEffect(() => {
    if (receiverLocation) {
      setReceiverLoc(receiverLocation)
      console.log('[Map] ✅ Receiver location updated from props:', receiverLocation)
    } else if (receiverUserId && receiverUserId !== (senderUserId || user_id)) {
      console.log('[Map] ⚠️ Receiver location not available but receiverUserId is set:', {
        receiverUserId,
        senderUserId,
        user_id
      })
    }
  }, [receiverLocation, receiverUserId, senderUserId, user_id])
  
  // Update receiver location history when props change
  useEffect(() => {
    if (receiverLocationHistory && receiverLocationHistory.length > 0) {
      setReceiverLocHistory(receiverLocationHistory)
    }
  }, [receiverLocationHistory])
  
  // Update all receiver locations when props change (for sender's map)
  useEffect(() => {
    if (receiverLocations) {
      // Compare Maps by size and content to prevent unnecessary updates
      setAllReceiverLocations((prev) => {
        if (prev.size !== receiverLocations.size) {
          console.log('[Map] ✅ Receiver locations updated from props (size changed):', {
            receiverCount: receiverLocations.size,
            receiverIds: Array.from(receiverLocations.keys())
          })
          return new Map(receiverLocations)
        }
        // Check if any receiver has new locations
        let hasChanges = false
        for (const [receiverId, locations] of receiverLocations.entries()) {
          const prevLocations = prev.get(receiverId)
          if (!prevLocations || prevLocations.length !== locations.length) {
            hasChanges = true
            break
          }
        }
        if (hasChanges) {
          console.log('[Map] ✅ Receiver locations updated from props (content changed):', {
            receiverCount: receiverLocations.size,
            receiverIds: Array.from(receiverLocations.keys())
          })
          return new Map(receiverLocations)
        }
        return prev // No changes, return previous to prevent re-render
      })
    } else {
      // Clear if prop is null/undefined
      setAllReceiverLocations((prev) => {
        if (prev.size > 0) {
          console.log('[Map] ⚠️ Receiver locations prop is null/undefined, clearing')
          return new Map()
        }
        return prev
      })
    }
  }, [receiverLocations])
  
  // Update receiver user IDs when props change
  useEffect(() => {
    if (receiverUserIds) {
      setAllReceiverUserIds((prev) => {
        // Compare arrays by converting to strings to prevent infinite loops
        // This handles cases where receiverUserIds is a new array reference with same contents
        const prevStr = JSON.stringify([...prev].sort())
        const newStr = JSON.stringify([...receiverUserIds].sort())
        if (prevStr !== newStr) {
          return receiverUserIds
        }
        return prev // Return previous to prevent unnecessary re-render
      })
    } else {
      // Only clear if we actually had IDs before
      setAllReceiverUserIds((prev) => prev.length > 0 ? [] : prev)
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
          .order('created_at', { ascending: false })
          .limit(50)
        
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
    // Check if locations have changed significantly (>100m) to avoid unnecessary recalculations
    const lastUpdate = lastDirectionsUpdateRef.current
    if (lastUpdate) {
      const originChanged = Math.abs(origin.lat - lastUpdate.origin.lat) > 0.001 || 
                           Math.abs(origin.lng - lastUpdate.origin.lng) > 0.001
      const destChanged = Math.abs(destination.lat - lastUpdate.destination.lat) > 0.001 || 
                         Math.abs(destination.lng - lastUpdate.destination.lng) > 0.001
      
      if (!originChanged && !destChanged) {
        return // Locations haven't changed significantly, skip recalculation
      }
    }

    // Don't retry if we've had too many consecutive errors
    if (directionsErrorCountRef.current >= 3) {
      console.warn('[Map] ⚠️ Too many directions errors, skipping request')
      return
    }

    // Clear any existing timeout
    if (directionsTimeoutRef.current) {
      clearTimeout(directionsTimeoutRef.current)
    }

    // Debounce directions calculation (5 seconds)
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
            directionsErrorCountRef.current = 0 // Reset error count on success
            lastDirectionsErrorRef.current = null
          } else {
            setDirectionsResult(null)
            const errorKey = `${status}-${origin.lat}-${origin.lng}-${destination.lat}-${destination.lng}`
            
            // Don't retry if it's the same error
            if (lastDirectionsErrorRef.current === errorKey) {
              console.warn('[Map] ⚠️ Same directions error, not retrying:', status)
              return
            }
            
            lastDirectionsErrorRef.current = errorKey
            directionsErrorCountRef.current += 1
            
            // Handle specific error types
            if (status === window.google.maps.DirectionsStatus.ZERO_RESULTS) {
              setDirectionsError('No route found')
            } else if (status === window.google.maps.DirectionsStatus.REQUEST_DENIED) {
              setDirectionsError('Directions request denied')
              directionsErrorCountRef.current = 3 // Don't retry denied requests
            } else if (status === window.google.maps.DirectionsStatus.OVER_QUERY_LIMIT) {
              setDirectionsError('Directions API quota exceeded')
              directionsErrorCountRef.current = 3 // Don't retry quota errors
            } else if (status === 'UNKNOWN_ERROR') {
              // UNKNOWN_ERROR often means API issue - don't retry aggressively
              console.warn('[Map] ⚠️ Directions UNKNOWN_ERROR - may be API issue, limiting retries')
              setDirectionsError(null) // Don't show error to user for UNKNOWN_ERROR
              if (directionsErrorCountRef.current >= 2) {
                directionsErrorCountRef.current = 3 // Stop retrying after 2 UNKNOWN_ERRORs
              }
            } else {
              setDirectionsError(`Directions error: ${status}`)
            }
          }
        }
      )
    }, 5000) // 5 second debounce
  }, [])

  // Calculate directions when both receiver and sender locations are available
  useEffect(() => {
    if (!receiverLoc || !senderLocation) {
      setDirectionsResult(null)
      return
    }

    // Only calculate directions for receiver's view (when receiverUserId is set and different from sender)
    // Directions show route from receiver's current location to sender's location
    if (receiverUserId && receiverUserId !== (senderUserId || user_id)) {
      console.log('[Map] Calculating directions from receiver to sender:', {
        receiver: receiverLoc,
        sender: senderLocation
      })
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

  // Adjust map bounds to show all receivers (for sender's map with multiple receivers)
  useEffect(() => {
    if (map && allReceiverLocations.size > 0 && senderLocation && typeof window !== 'undefined' && window.google?.maps) {
      // Only adjust bounds if we have receivers and no directions (directions already handles bounds)
      if (!directionsResult) {
        const bounds = new window.google.maps.LatLngBounds()
        bounds.extend(senderLocation)
        
        // Add all receiver locations to bounds
        allReceiverLocations.forEach((locations) => {
          if (locations.length > 0) {
            const latestLocation = locations[locations.length - 1]
            bounds.extend({ lat: latestLocation.latitude, lng: latestLocation.longitude })
          }
        })
        
        // Fit bounds with padding
        map.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 })
        console.log('[Map] ✅ Adjusted bounds to show all receivers:', {
          receiverCount: allReceiverLocations.size,
          senderLocation
        })
      }
    }
  }, [map, allReceiverLocations, senderLocation, directionsResult])

  const onLoad = useCallback((mapInstance: any) => {
    console.log('[Map] ✅ Map loaded, sender location:', senderLocation)
    setMap(mapInstance)
    
    // Ensure map centers on sender location or fits all markers
    if (senderLocation && senderLocation.lat && senderLocation.lng && 
        !isNaN(senderLocation.lat) && !isNaN(senderLocation.lng)) {
      
      // If we have receiver locations, fit bounds to show all
      if (allReceiverLocations.size > 0 && typeof window !== 'undefined' && window.google?.maps) {
        const bounds = new window.google.maps.LatLngBounds()
        bounds.extend(senderLocation)
        
        // Add all receiver locations to bounds
        allReceiverLocations.forEach((locations) => {
          if (locations.length > 0) {
            const latestLocation = locations[locations.length - 1]
            bounds.extend({ lat: latestLocation.latitude, lng: latestLocation.longitude })
          }
        })
        
        // Fit bounds with padding
        mapInstance.fitBounds(bounds, { top: 50, right: 50, bottom: 50, left: 50 })
        console.log('[Map] 📍 Map fitted to show sender and all receivers:', {
          senderLocation,
          receiverCount: allReceiverLocations.size
        })
      } else {
        // No receivers, just center on sender
        mapInstance.setCenter(senderLocation)
        console.log('[Map] 📍 Map centered on sender location:', senderLocation)
      }
      
      // Verify marker will be visible
      setTimeout(() => {
        const bounds = mapInstance.getBounds()
        if (bounds) {
          const isVisible = bounds.contains(senderLocation)
          console.log('[Map] 🔍 Marker visibility check:', {
            senderLocation,
            isVisible,
            bounds: {
              north: bounds.getNorthEast().lat(),
              south: bounds.getSouthWest().lat(),
              east: bounds.getNorthEast().lng(),
              west: bounds.getSouthWest().lng()
            }
          })
        }
      }, 500)
    } else {
      console.warn('[Map] ⚠️ Cannot center map - invalid sender location:', senderLocation)
    }
  }, [senderLocation, allReceiverLocations])

  // Get Google Maps API - memoize to ensure hooks are called before early returns
  // Depend on isLoaded so it updates when Google Maps actually loads
  const googleMaps = useMemo(() => {
    if (!isLoaded) return null
    return typeof window !== 'undefined' ? window.google?.maps : null
  }, [isLoaded])

  // Memoize map options to prevent re-renders
  const mapOptions = useMemo(() => ({
    disableDefaultUI: false,
    zoomControl: true,
    streetViewControl: false,
    mapTypeControl: false,
    fullscreenControl: true,
  }), [])

  // Memoize sender marker icon - always return a valid icon object
  // Similar pattern to receiver marker but with fallback for when Google Maps isn't loaded
  const senderMarkerIcon = useMemo(() => {
    if (!isLoaded || !googleMaps) {
      console.log('[Map] ⚠️ Google Maps not loaded yet - sender marker will use default icon')
      // Return undefined to let Google Maps use default red marker
      // This is safer than a custom path that might not render correctly
      return undefined
    }
    
    console.log('[Map] ✅ Created sender marker icon (red, scale 10)')
    return {
      path: googleMaps.SymbolPath.CIRCLE,
      scale: 10, // Increased from 8 to make more prominent
      fillColor: '#DE3831',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 3,
      zIndex: 1000, // Ensure sender marker is on top
    }
  }, [googleMaps, isLoaded])

  // Memoize receiver marker icon
  const receiverMarkerIcon = useMemo(() => {
    if (!isLoaded || !googleMaps) return undefined
    return {
      path: googleMaps.SymbolPath.CIRCLE,
      scale: 8,
      fillColor: '#2563EB',
      fillOpacity: 1,
      strokeColor: '#FFFFFF',
      strokeWeight: 3,
    }
  }, [googleMaps, isLoaded])

  // Memoize sender location history markers
  const senderHistoryMarkers = useMemo(() => {
    if (!isLoaded || !googleMaps) return []
    return senderLocationHistory.map((loc, index) => ({
      key: `sender-${loc.id}-${index}`,
      position: { lat: loc.latitude, lng: loc.longitude },
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        scale: 4,
        fillColor: '#DE3831',
        fillOpacity: 0.6,
        strokeColor: '#FFFFFF',
        strokeWeight: 2,
      },
    }))
  }, [senderLocationHistory, googleMaps, isLoaded])

  // Memoize receiver location history markers
  const receiverHistoryMarkers = useMemo(() => {
    if (!isLoaded || !googleMaps) return []
    return receiverLocHistory.map((loc, index) => ({
      key: `receiver-${loc.id}-${index}`,
      position: { lat: loc.latitude, lng: loc.longitude },
      icon: {
        path: googleMaps.SymbolPath.CIRCLE,
        scale: 4,
        fillColor: '#2563EB',
        fillOpacity: 0.6,
        strokeColor: '#FFFFFF',
        strokeWeight: 2,
      },
    }))
  }, [receiverLocHistory, googleMaps, isLoaded])

  // Memoize multiple receiver markers
  const multipleReceiverMarkers = useMemo(() => {
    if (!isLoaded || !googleMaps) return []
    const markers: Array<{
      receiverId: string
      currentMarker: { position: { lat: number; lng: number }; title: string; icon: any }
      polyline: { path: Array<{ lat: number; lng: number }>; options: any }
      historyMarkers: Array<{ key: string; position: { lat: number; lng: number }; icon: any }>
    }> = []
    
    console.log('[Map] 🔍 Computing multiple receiver markers:', {
      receiverLocationsSize: allReceiverLocations.size,
      receiverUserIds: allReceiverUserIds,
      senderLocation
    })
    
    console.log('[Map] 🔍 Processing receiver locations:', {
      totalReceivers: allReceiverLocations.size,
      receiverIds: Array.from(allReceiverLocations.keys())
    })

    Array.from(allReceiverLocations.entries()).forEach(([receiverId, locations]) => {
      console.log('[Map] 🔍 Processing receiver:', {
        receiverId,
        locationCount: locations.length,
        hasLocations: locations.length > 0
      })

      if (locations.length === 0) {
        console.log('[Map] ⚠️ Skipping receiver with no locations:', receiverId)
        return
      }
      const latestLocation = locations[locations.length - 1]
      
      console.log('[Map] ✅ Creating marker for receiver:', {
        receiverId,
        locationCount: locations.length,
        latestLocation: {
          lat: latestLocation.latitude,
          lng: latestLocation.longitude,
          timestamp: latestLocation.created_at
        }
      })
      
      const currentMarker = {
        position: { lat: latestLocation.latitude, lng: latestLocation.longitude },
        title: `Responder Location (${receiverId.slice(0, 8)}...)`,
        icon: {
          path: googleMaps.SymbolPath.CIRCLE,
          scale: 8,
          fillColor: '#2563EB',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 3,
        },
      }
      
      const polyline = {
        path: [senderLocation, { lat: latestLocation.latitude, lng: latestLocation.longitude }],
        options: {
          strokeColor: '#2563EB',
          strokeOpacity: 0.4,
          strokeWeight: 2,
          geodesic: true,
        },
      }
      
      const historyMarkers = locations.map((loc, index) => ({
        key: `receiver-${receiverId}-${loc.id}-${index}`,
        position: { lat: loc.latitude, lng: loc.longitude },
        icon: {
          path: googleMaps.SymbolPath.CIRCLE,
          scale: 4,
          fillColor: '#2563EB',
          fillOpacity: 0.6,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
        },
      }))
      
      markers.push({
        receiverId,
        currentMarker,
        polyline,
        historyMarkers
      })
    })
    
    console.log('[Map] ✅ Computed multiple receiver markers:', {
      markerCount: markers.length,
      receiverIds: markers.map(m => m.receiverId),
      totalMarkers: markers.reduce((sum, m) => sum + 1 + m.historyMarkers.length, 0)
    })
    
    return markers
  }, [allReceiverLocations, senderLocation, googleMaps, allReceiverUserIds, isLoaded])

  // Handle loading states - AFTER all hooks are called
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
        options={mapOptions}
    >
        {/* Sender location marker (Emergency Location - Red) - Always visible */}
        <Marker
          key={`sender-${senderLocation.lat}-${senderLocation.lng}`}
          position={senderLocation}
          title="Emergency Location (Sender)"
          icon={senderMarkerIcon}
          zIndex={1000}
          visible={true}
        />

        {/* Receiver location marker (Responder Location - Blue) */}
        {receiverLoc && (
          <Marker
            position={receiverLoc}
            title="Your Location (Responder)"
            icon={receiverMarkerIcon}
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
        {!directionsResult && receiverLoc && isLoaded && googleMaps && (
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
        {senderHistoryMarkers.map((marker) => (
          <Marker
            key={marker.key}
            position={marker.position}
            icon={marker.icon}
          />
        ))}

        {/* Receiver location history trail (Blue) - for single receiver view */}
        {receiverHistoryMarkers.map((marker) => (
          <Marker
            key={marker.key}
            position={marker.position}
            icon={marker.icon}
          />
        ))}

        {/* Multiple receiver locations (for sender's map) */}
        {multipleReceiverMarkers.map((markerData) => (
          <div key={`receiver-${markerData.receiverId}`}>
            {/* Receiver current location marker */}
            <Marker
              position={markerData.currentMarker.position}
              title={markerData.currentMarker.title}
              icon={markerData.currentMarker.icon}
            />
            
            {/* Polyline from sender to this receiver */}
            {isLoaded && googleMaps && (
              <Polyline
                key={`polyline-${markerData.receiverId}`}
                path={markerData.polyline.path}
                options={markerData.polyline.options}
        />
            )}
            
            {/* Receiver location history trail */}
            {markerData.historyMarkers.map((marker) => (
              <Marker
                key={marker.key}
                position={marker.position}
                icon={marker.icon}
              />
            ))}
          </div>
      ))}
    </GoogleMap>
    </div>
  )
}

// Memoize component to prevent unnecessary re-renders
export default memo(EmergencyMapComponent, (prevProps, nextProps) => {
  // Custom comparison function - only re-render if meaningful props change
  return (
    prevProps.latitude === nextProps.latitude &&
    prevProps.longitude === nextProps.longitude &&
    prevProps.alertId === nextProps.alertId &&
    prevProps.user_id === nextProps.user_id &&
    prevProps.receiverUserId === nextProps.receiverUserId &&
    prevProps.senderUserId === nextProps.senderUserId &&
    prevProps.receiverLocation?.lat === nextProps.receiverLocation?.lat &&
    prevProps.receiverLocation?.lng === nextProps.receiverLocation?.lng &&
    prevProps.receiverLocationHistory?.length === nextProps.receiverLocationHistory?.length &&
    prevProps.receiverUserIds?.length === nextProps.receiverUserIds?.length &&
    prevProps.receiverLocations?.size === nextProps.receiverLocations?.size
  )
})

