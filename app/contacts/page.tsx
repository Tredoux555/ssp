'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/lib/contexts/AuthContext'
import { getEmergencyContacts } from '@/lib/emergency'
import { createClient } from '@/lib/supabase'
import { EmergencyContact } from '@/types/database'
import Button from '@/components/Button'
import Card from '@/components/Card'
import Input from '@/components/Input'
import { Users, Plus, Edit, Trash2, ArrowLeft, Phone, Mail } from 'lucide-react'

// Helper function to properly serialize errors for logging
function serializeError(error: any): any {
  if (!error) return null
  
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      constructor: error.constructor?.name,
    }
  }
  
  if (typeof error === 'string') {
    return { message: error }
  }
  
  // Try to extract any properties
  try {
    const keys = Object.keys(error || {})
    if (keys.length > 0) {
      return error
    }
  } catch {
    // Object.keys might fail for some error types
  }
  
  return { message: String(error), type: typeof error }
}

export default function ContactsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRelationship, setInviteRelationship] = useState('')
  const [invitePriority, setInvitePriority] = useState('0')
  const [inviteSubmitting, setInviteSubmitting] = useState(false)
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [incomingInvites, setIncomingInvites] = useState<any[]>([])
  const [loadingInvites, setLoadingInvites] = useState(false)
  const [acceptingInvite, setAcceptingInvite] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    relationship: '',
    priority: '0',
  })

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/auth/login')
    }
  }, [user, authLoading, router])

  useEffect(() => {
    if (user) {
      loadContacts()
      loadIncomingInvites()
    }
  }, [user])

  const loadContacts = async () => {
    if (!user) return

    try {
      const data = await getEmergencyContacts(user.id)
      setContacts(data)
    } catch (error) {
      console.error('Failed to load contacts:', error)
    } finally {
      setLoading(false)
    }
  }

  const loadIncomingInvites = async () => {
    if (!user) return

    setLoadingInvites(true)
    try {
      console.log('Loading incoming invites for user:', user.email)
      const res = await fetch('/api/contacts/invites/incoming')
      const data = await res.json()
      if (res.ok) {
        console.log('Loaded incoming invites:', data.invites?.length || 0, 'invites')
        setIncomingInvites(data.invites || [])
      } else {
        console.error('Failed to load incoming invites:', data.error)
        // Show error to user if there's a clear error message
        if (data.error && !data.error.includes('schema cache')) {
          alert(`Failed to load invites: ${data.error}`)
        }
        setIncomingInvites([])
      }
    } catch (error: any) {
      // Properly serialize error for logging
      const serializedError = serializeError(error)
      console.error('Failed to load incoming invites:', {
        ...serializedError,
        userEmail: user?.email,
        rawError: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : error,
      })
      alert(`Failed to load invites: ${error?.message || 'Network error'}`)
      setIncomingInvites([])
    } finally {
      setLoadingInvites(false)
    }
  }

  const handleAcceptInvite = async (token: string) => {
    if (!user) {
      console.error('Cannot accept invite: user not logged in')
      alert('Please log in to accept invites')
      return
    }

    if (!token || typeof token !== 'string') {
      console.error('Invalid token provided:', token)
      alert('Invalid invite token. Please try again.')
      return
    }

    console.log('Accepting invite:', {
      token,
      userEmail: user.email,
      userId: user.id,
    })

    setAcceptingInvite(token)
    
    try {
      let res: Response
      
      // Wrap fetch in try-catch to handle network errors
      try {
        res = await fetch(`/api/contacts/invite/${token}/accept`, {
          method: 'POST',
        })
      } catch (fetchError: any) {
        // Network error (TypeError: fetch failed, CORS, etc.)
        const networkError = fetchError instanceof TypeError
          ? new Error(`Network error: ${fetchError.message || 'Failed to connect to server'}`)
          : fetchError instanceof Error
          ? fetchError
          : new Error(`Network error: ${String(fetchError)}`)
        
        console.error('Accept invite network error:', serializeError(networkError))
        throw networkError
      }
      
      // Parse response - handle empty or non-JSON responses
      let data: any = {}
      try {
        const text = await res.text()
        if (text) {
          data = JSON.parse(text)
        }
      } catch (parseError) {
        console.warn('Failed to parse response:', serializeError(parseError))
        // If response is not JSON, create error message from status
        if (!res.ok) {
          data = { error: `Server error: ${res.status} ${res.statusText || 'Unknown error'}` }
        }
      }
      
      console.log('Accept invite response:', {
        ok: res.ok,
        status: res.status,
        data,
      })
      
      if (!res.ok) {
        const errorMessage = data.error || `Failed to accept invite (${res.status})`
        throw new Error(errorMessage)
      }

      console.log('Invite accepted successfully!')
      
      // Reload both incoming invites and contacts list after success
      await loadIncomingInvites()
      await loadContacts()
      alert('Invite accepted!')
    } catch (error: any) {
      // Properly serialize error for logging
      const serializedError = serializeError(error)
      console.error('Accept invite error:', {
        ...serializedError,
        token,
        userEmail: user?.email,
        rawError: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : error,
      })
      
      // Extract error message - handle different error types
      let errorMessage = 'Failed to accept invite'
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage
      } else if (typeof error === 'string') {
        errorMessage = error
      } else if (error?.message) {
        errorMessage = error.message
      }
      
      alert(errorMessage || 'Failed to accept invite. Please check the console for details.')
    } finally {
      setAcceptingInvite(null)
    }
  }

  const handleRejectInvite = async (inviteId: string) => {
    if (!user) return

    const confirmed = window.confirm('Are you sure you want to reject this invite?')
    if (!confirmed) return

    try {
      let res: Response
      
      // Wrap fetch in try-catch to handle network errors
      try {
        res = await fetch(`/api/contacts/invites/${inviteId}/reject`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      } catch (fetchError: any) {
        // Network error (TypeError: fetch failed, CORS, etc.)
        const networkError = fetchError instanceof TypeError
          ? new Error(`Network error: ${fetchError.message || 'Failed to connect to server'}`)
          : fetchError instanceof Error
          ? fetchError
          : new Error(`Network error: ${String(fetchError)}`)
        
        console.error('Reject invite network error:', serializeError(networkError))
        throw networkError
      }
      
      // Parse response - handle empty or non-JSON responses
      let data: any = {}
      try {
        const text = await res.text()
        if (text) {
          data = JSON.parse(text)
        }
      } catch (parseError) {
        console.warn('Failed to parse response:', serializeError(parseError))
        // If response is not JSON, create error message from status
        if (!res.ok) {
          data = { error: `Server error: ${res.status} ${res.statusText || 'Unknown error'}` }
        }
      }
      
      if (!res.ok) {
        const errorMessage = data.error || `Failed to reject invite (${res.status})`
        throw new Error(errorMessage)
      }

      // Reload incoming invites after success
      await loadIncomingInvites()
      alert('Invite rejected')
    } catch (error: any) {
      // Properly serialize error for logging
      const serializedError = serializeError(error)
      console.error('Reject invite error:', {
        ...serializedError,
        inviteId,
        userEmail: user?.email,
        rawError: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : error,
      })
      
      // Extract error message - handle different error types
      let errorMessage = 'Failed to reject invite'
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage
      } else if (typeof error === 'string') {
        errorMessage = error
      } else if (error?.message) {
        errorMessage = error.message
      }
      
      alert(errorMessage || 'Failed to reject invite')
    }
  }

  const handleAddContact = async () => {
    if (!user) return

    // Validation
    if (!formData.name || formData.name.trim().length === 0) {
      alert('Please provide a name')
      return
    }

    if (!formData.phone && !formData.email) {
      alert('Please provide at least a phone number or email address')
      return
    }

    // Validate email format if provided
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      alert('Please provide a valid email address')
      return
    }

    const supabase = createClient()

    if (!supabase) {
      alert('Failed to connect to server. Please refresh the page and try again.')
      return
    }

    try {
      const { error } = await supabase
        .from('emergency_contacts')
        .insert({
          user_id: user.id,
          name: formData.name.trim(),
          phone: formData.phone?.trim() || null,
          email: formData.email?.trim() || null,
          relationship: formData.relationship?.trim() || null,
          priority: parseInt(formData.priority) || 0,
          can_see_location: true,
          verified: false,
        })

      if (error) {
        // Provide user-friendly error messages
        if (error.code === '23505' || error.message.includes('duplicate')) {
          throw new Error('A contact with this phone or email already exists')
        }
        throw new Error(error.message || 'Failed to add contact')
      }

      // Reset form and reload contacts
      setFormData({
        name: '',
        phone: '',
        email: '',
        relationship: '',
        priority: '0',
      })
      setShowAddForm(false)
      await loadContacts()
    } catch (error: any) {
      console.error('Add contact error:', error)
      alert(`Failed to add contact: ${error.message || 'Unknown error'}`)
    }
  }

  const handleEditContact = (contact: EmergencyContact) => {
    setEditingContact(contact)
    setFormData({
      name: contact.name,
      phone: contact.phone || '',
      email: contact.email || '',
      relationship: contact.relationship || '',
      priority: contact.priority.toString(),
    })
    setShowAddForm(true)
  }

  const handleUpdateContact = async () => {
    if (!user || !editingContact) return

    // Validation
    if (!formData.name || formData.name.trim().length === 0) {
      alert('Please provide a name')
      return
    }

    if (!formData.phone && !formData.email) {
      alert('Please provide at least a phone number or email address')
      return
    }

    // Validate email format if provided
    if (formData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      alert('Please provide a valid email address')
      return
    }

    const supabase = createClient()

    if (!supabase) {
      alert('Failed to connect to server. Please refresh the page and try again.')
      return
    }

    try {
      const { error } = await supabase
        .from('emergency_contacts')
        .update({
          name: formData.name.trim(),
          phone: formData.phone?.trim() || null,
          email: formData.email?.trim() || null,
          relationship: formData.relationship?.trim() || null,
          priority: parseInt(formData.priority) || 0,
        })
        .eq('id', editingContact.id)
        .eq('user_id', user.id)

      if (error) {
        if (error.code === '42501' || error.message.includes('row-level security')) {
          throw new Error('You do not have permission to update this contact')
        }
        throw new Error(error.message || 'Failed to update contact')
      }

      setEditingContact(null)
      setFormData({
        name: '',
        phone: '',
        email: '',
        relationship: '',
        priority: '0',
      })
      setShowAddForm(false)
      await loadContacts()
    } catch (error: any) {
      console.error('Update contact error:', error)
      alert(`Failed to update contact: ${error.message || 'Unknown error'}`)
    }
  }

  const handleDeleteContact = async (contactId: string) => {
    if (!user) return

    const confirmed = window.confirm('Are you sure you want to remove this contact?')

    if (!confirmed) return

    try {
      let response: Response
      
      // Wrap fetch in try-catch to handle network errors
      try {
        response = await fetch(`/api/contacts/${contactId}`, {
          method: 'DELETE',
          headers: {
            'Content-Type': 'application/json',
          },
        })
      } catch (fetchError: any) {
        // Network error (TypeError: fetch failed, CORS, etc.)
        const networkError = fetchError instanceof TypeError
          ? new Error(`Network error: ${fetchError.message || 'Failed to connect to server'}`)
          : fetchError instanceof Error
          ? fetchError
          : new Error(`Network error: ${String(fetchError)}`)
        
        console.error('Delete contact network error:', serializeError(networkError))
        throw networkError
      }

      if (!response.ok) {
        // Try to parse error response
        let errorMessage = `Failed to delete contact (${response.status})`
        try {
          const text = await response.text()
          if (text) {
            const errorData = JSON.parse(text)
            errorMessage = errorData.error || errorMessage
          }
        } catch {
          // Response is not JSON or empty - use status text
          errorMessage = response.statusText || errorMessage
        }
        throw new Error(errorMessage)
      }

      // Successfully deleted - reload contacts list
      await loadContacts()
      alert('Contact deleted successfully')
    } catch (error: any) {
      // Properly serialize error for logging
      const serializedError = serializeError(error)
      console.error('Delete contact error:', {
        ...serializedError,
        contactId,
        userEmail: user?.email,
        rawError: error instanceof Error ? {
          name: error.name,
          message: error.message,
          stack: error.stack,
        } : error,
      })
      
      // Extract error message - handle different error types
      let errorMessage = 'Failed to delete contact'
      if (error instanceof Error) {
        errorMessage = error.message || errorMessage
      } else if (typeof error === 'string') {
        errorMessage = error
      } else if (error?.message) {
        errorMessage = error.message
      }
      
      // Provide user-friendly error messages
      if (errorMessage.includes('network') || errorMessage.includes('fetch') || errorMessage.includes('Load failed')) {
        alert('Network error: Please check your internet connection and try again.')
      } else if (errorMessage) {
        alert(`Failed to remove contact: ${errorMessage}`)
      } else {
        alert('Failed to remove contact. Please try again or refresh the page.')
      }
    }
  }

  const handleCancel = () => {
    setShowAddForm(false)
    setEditingContact(null)
    setFormData({
      name: '',
      phone: '',
      email: '',
      relationship: '',
      priority: '0',
    })
  }

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold flex items-center justify-center">
        <p className="text-white">Loading...</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-sa-green via-sa-blue to-sa-gold p-4">
      <div className="max-w-2xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => router.push('/dashboard')}
            className="flex items-center gap-2"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back</span>
          </Button>
          <h1 className="text-3xl font-bold text-white">Emergency Contacts</h1>
        </div>

        {/* Incoming Invites */}
        <Card className="mb-6">
          <h2 className="text-xl font-bold mb-4">Incoming Contact Invites</h2>
          {loadingInvites ? (
            <div className="text-center py-4">
              <p className="text-gray-600">Loading invites...</p>
            </div>
          ) : incomingInvites.length > 0 ? (
            <div className="space-y-3">
              {incomingInvites.map((invite) => (
                <Card key={invite.id} className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1">
                      <p className="font-semibold text-gray-900">{invite.inviter_name}</p>
                      <p className="text-sm text-gray-600">{invite.inviter_email}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        Invited {new Date(invite.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => handleAcceptInvite(invite.token)}
                        disabled={acceptingInvite === invite.token || !!acceptingInvite}
                      >
                        {acceptingInvite === invite.token ? 'Accepting...' : 'Accept'}
                      </Button>
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={() => handleRejectInvite(invite.id)}
                        disabled={!!acceptingInvite}
                      >
                        Reject
                      </Button>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <div className="text-center py-4">
              <p className="text-gray-600">No incoming invites</p>
              <p className="text-sm text-gray-500 mt-1">
                Invites sent to your email will appear here
              </p>
            </div>
          )}
        </Card>

        {/* Invite by Email */}
        <Card className="mb-6">
          <h2 className="text-xl font-bold mb-3">Invite a Contact by Email</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input
              label="Email *"
              type="email"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="friend@example.com"
            />
            <Input
              label="Relationship"
              value={inviteRelationship}
              onChange={(e) => setInviteRelationship(e.target.value)}
              placeholder="Family, Friend, etc."
            />
            <Input
              label="Priority (0-10)"
              type="number"
              min="0"
              max="10"
              value={invitePriority}
              onChange={(e) => setInvitePriority(e.target.value)}
            />
          </div>
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              onClick={async () => {
                if (!user) return
                setInviteSubmitting(true)
                setInviteLink(null)
                try {
                  const res = await fetch('/api/contacts/invite', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      email: inviteEmail,
                      relationship: inviteRelationship,
                      priority: parseInt(invitePriority) || 0,
                    }),
                  })
                  const data = await res.json()
                  if (!res.ok) throw new Error(data.error || 'Failed to create invite')
                  setInviteLink(data.inviteUrl)
                } catch (e: any) {
                  alert(e.message || 'Failed to create invite')
                } finally {
                  setInviteSubmitting(false)
                }
              }}
              disabled={inviteSubmitting}
            >
              {inviteSubmitting ? 'Creating...' : 'Create Invite'}
            </Button>
            {inviteLink && (
              <Button
                variant="secondary"
                onClick={() => {
                  navigator.clipboard.writeText(inviteLink).catch(() => {})
                  alert('Invite link copied to clipboard')
                }}
              >
                Copy Link
              </Button>
            )}
          </div>
          {inviteLink && (
            <p className="text-sm text-gray-600 mt-2 break-all">{inviteLink}</p>
          )}
        </Card>

        {/* Add Contact Button */}
        {!showAddForm && (
          <Card className="mb-6">
            <Button
              variant="primary"
              size="lg"
              onClick={() => setShowAddForm(true)}
              className="w-full flex items-center justify-center gap-2"
            >
              <Plus className="w-5 h-5" />
              Add Emergency Contact
            </Button>
          </Card>
        )}

        {/* Add/Edit Form */}
        {showAddForm && (
          <Card className="mb-6">
            <h2 className="text-xl font-bold mb-4">
              {editingContact ? 'Edit Contact' : 'Add New Contact'}
            </h2>
            <div className="space-y-4">
              <Input
                label="Name *"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="John Doe"
                required
              />
              <Input
                label="Phone"
                type="tel"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                placeholder="+27 12 345 6789"
              />
              <Input
                label="Email"
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="john@example.com"
              />
              <Input
                label="Relationship"
                value={formData.relationship}
                onChange={(e) => setFormData({ ...formData, relationship: e.target.value })}
                placeholder="Family, Friend, etc."
              />
              <Input
                label="Priority (0-10, higher = notified first)"
                type="number"
                min="0"
                max="10"
                value={formData.priority}
                onChange={(e) => setFormData({ ...formData, priority: e.target.value })}
              />
              <div className="flex gap-2">
                <Button
                  variant="primary"
                  onClick={editingContact ? handleUpdateContact : handleAddContact}
                  className="flex-1"
                >
                  {editingContact ? 'Update' : 'Add'} Contact
                </Button>
                <Button variant="secondary" onClick={handleCancel} className="flex-1">
                  Cancel
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Contacts List */}
        <div className="space-y-4">
          {contacts.length === 0 ? (
            <Card>
              <div className="text-center py-8">
                <Users className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-600">No emergency contacts yet</p>
                <p className="text-sm text-gray-500 mt-2">
                  Add contacts who should be notified in case of emergency
                </p>
              </div>
            </Card>
          ) : (
            contacts.map((contact) => (
              <Card key={contact.id}>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <h3 className="font-bold text-lg">{contact.name}</h3>
                      {contact.verified ? (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">
                          Verified
                        </span>
                      ) : (
                        <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded">
                          Pending
                        </span>
                      )}
                    </div>
                    {contact.relationship && (
                      <p className="text-sm text-gray-600 mb-2">{contact.relationship}</p>
                    )}
                    <div className="space-y-1">
                      {contact.phone && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Phone className="w-4 h-4" />
                          <span>{contact.phone}</span>
                        </div>
                      )}
                      {contact.email && (
                        <div className="flex items-center gap-2 text-sm text-gray-700">
                          <Mail className="w-4 h-4" />
                          <span>{contact.email}</span>
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 mt-2">
                      Priority: {contact.priority}
                    </p>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleEditContact(contact)}
                      className="flex items-center gap-1"
                    >
                      <Edit className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={() => handleDeleteContact(contact.id)}
                      className="flex items-center gap-1"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

