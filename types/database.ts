// Database types for PSP (Personal Security Program)

export interface UserProfile {
  id: string
  email: string
  phone?: string
  full_name?: string
  profile_photo_url?: string
  created_at: string
  updated_at: string
}

export interface EmergencyAlert {
  id: string
  user_id: string
  status: 'active' | 'resolved' | 'cancelled'
  alert_type: 'robbery' | 'house_breaking' | 'car_jacking' | 'accident' | 'other'
  location_lat?: number
  location_lng?: number
  address?: string
  triggered_at: string
  resolved_at?: string
  contacts_notified: string[]
  created_at: string
  updated_at: string
}

export interface EmergencyContact {
  id: string
  user_id: string
  contact_user_id?: string
  name: string
  phone?: string
  email?: string
  relationship?: string
  priority: number
  can_see_location: boolean
  verified: boolean
  created_at: string
  updated_at: string
}

export interface AlertResponse {
  id: string
  alert_id: string
  contact_user_id: string
  received_at: string
  acknowledged_at?: string
  navigated_to_location: boolean
  arrived_at_location?: string
  created_at: string
}

export interface LocationHistory {
  id: string
  user_id: string
  alert_id?: string
  latitude: number
  longitude: number
  accuracy?: number
  timestamp: string
  created_at: string
}

export interface SocialGroup {
  id: string
  name: string
  description?: string
  admin_user_id: string
  member_count: number
  created_at: string
  updated_at: string
}

export interface GroupMember {
  id: string
  group_id: string
  user_id: string
  role: string
  joined_at: string
}

export interface AdminNotification {
  id: string
  sent_by: string
  target_type: 'all_users' | 'specific_group'
  target_group_id?: string
  title: string
  message: string
  sent_at: string
  delivery_status: string
}

export interface AuditLog {
  id: string
  user_id?: string
  action_type: string
  details?: Record<string, any>
  ip_address?: string
  timestamp: string
}

