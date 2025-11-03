/**
 * Emergency Alert Notification System
 * Handles full-screen alerts, sounds, and vibrations for emergency notifications
 */

let currentAlertId: string | null = null
let alertSound: HTMLAudioElement | null = null
let isAlertActive = false

/**
 * Play emergency alert sound
 */
export function playAlertSound(): void {
  try {
    // Stop any existing sound
    if (alertSound) {
      alertSound.pause()
      alertSound.currentTime = 0
    }

    // Create and play emergency sound
    alertSound = new Audio('/emergency-alert.mp3')
    alertSound.volume = 1.0
    alertSound.loop = true
    
    // Play sound (user interaction required for autoplay)
    alertSound.play().catch((error) => {
      // Browser may block autoplay - this is expected
      console.warn('Sound autoplay blocked (requires user interaction):', error)
    })
  } catch (error) {
    console.warn('Failed to play alert sound:', error)
  }
}

/**
 * Stop emergency alert sound
 */
export function stopAlertSound(): void {
  try {
    if (alertSound) {
      alertSound.pause()
      alertSound.currentTime = 0
      alertSound = null
    }
  } catch (error) {
    console.warn('Failed to stop alert sound:', error)
  }
}

/**
 * Vibrate device (mobile only)
 */
export function vibrateDevice(pattern: number[] = [200, 100, 200]): void {
  try {
    if (navigator.vibrate) {
      // Vibrate pattern: vibrate for 200ms, pause 100ms, vibrate 200ms
      // Repeat pattern 3 times for urgent alert
      const longPattern: number[] = []
      for (let i = 0; i < 3; i++) {
        longPattern.push(...pattern)
        if (i < 2) longPattern.push(100) // Pause between repetitions
      }
      navigator.vibrate(longPattern)
    }
  } catch (error) {
    console.warn('Failed to vibrate device:', error)
  }
}

/**
 * Show full-screen emergency alert
 * This creates a red flashing overlay that covers the entire screen
 */
export function showEmergencyAlert(alertId: string, alertData: any): void {
  // Prevent duplicate alerts
  if (isAlertActive && currentAlertId === alertId) {
    return
  }

  isAlertActive = true
  currentAlertId = alertId

  // Create alert overlay
  const overlay = document.createElement('div')
  overlay.id = 'emergency-alert-overlay'
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: #DE3831;
    z-index: 99999;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    color: white;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    animation: emergencyFlash 0.5s infinite;
  `

  // Add flashing animation
  const style = document.createElement('style')
  style.textContent = `
    @keyframes emergencyFlash {
      0%, 100% { background: #DE3831; }
      50% { background: #FF0000; }
    }
  `
  document.head.appendChild(style)

  // Alert content
  const content = document.createElement('div')
  content.style.cssText = `
    text-align: center;
    padding: 2rem;
    max-width: 90%;
  `

  const title = document.createElement('h1')
  title.textContent = '🚨 EMERGENCY ALERT 🚨'
  title.style.cssText = 'font-size: 2rem; font-weight: bold; margin-bottom: 1rem; text-transform: uppercase;'

  const message = document.createElement('p')
  message.textContent = 'Someone in your contact list needs help!'
  message.style.cssText = 'font-size: 1.2rem; margin-bottom: 1rem;'

  const details = document.createElement('p')
  details.textContent = alertData.address || 'Location available'
  details.style.cssText = 'font-size: 1rem; opacity: 0.9; margin-bottom: 2rem;'

  const button = document.createElement('button')
  button.textContent = 'View Alert Details'
  button.style.cssText = `
    background: white;
    color: #DE3831;
    border: none;
    padding: 1rem 2rem;
    font-size: 1.1rem;
    font-weight: bold;
    border-radius: 8px;
    cursor: pointer;
    margin-top: 1rem;
  `
  button.onclick = () => {
    window.location.href = `/alert/${alertId}`
  }

  content.appendChild(title)
  content.appendChild(message)
  content.appendChild(details)
  content.appendChild(button)

  overlay.appendChild(content)
  document.body.appendChild(overlay)

  // Prevent body scroll when alert is active
  document.body.style.overflow = 'hidden'

  // Play sound and vibrate
  playAlertSound()
  vibrateDevice()

  // Store alert ID for later cleanup
  currentAlertId = alertId
}

/**
 * Hide emergency alert overlay
 */
export function hideEmergencyAlert(): void {
  const overlay = document.getElementById('emergency-alert-overlay')
  if (overlay) {
    overlay.remove()
  }
  
  stopAlertSound()
  document.body.style.overflow = ''
  
  isAlertActive = false
  currentAlertId = null
}

/**
 * Check if an alert is currently active
 */
export function isEmergencyAlertActive(): boolean {
  return isAlertActive
}

/**
 * Get current active alert ID
 */
export function getCurrentAlertId(): string | null {
  return currentAlertId
}

