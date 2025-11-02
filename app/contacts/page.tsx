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

export default function ContactsPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [contacts, setContacts] = useState<EmergencyContact[]>([])
  const [loading, setLoading] = useState(true)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingContact, setEditingContact] = useState<EmergencyContact | null>(null)
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

  const handleAddContact = async () => {
    if (!user) return

    if (!formData.name || (!formData.phone && !formData.email)) {
      alert('Please provide at least a name and phone or email')
      return
    }

    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('emergency_contacts')
        .insert({
          user_id: user.id,
          name: formData.name,
          phone: formData.phone || null,
          email: formData.email || null,
          relationship: formData.relationship || null,
          priority: parseInt(formData.priority) || 0,
          can_see_location: true,
          verified: false,
        })

      if (error) throw error

      setFormData({
        name: '',
        phone: '',
        email: '',
        relationship: '',
        priority: '0',
      })
      setShowAddForm(false)
      loadContacts()
    } catch (error: any) {
      alert(`Failed to add contact: ${error.message}`)
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

    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('emergency_contacts')
        .update({
          name: formData.name,
          phone: formData.phone || null,
          email: formData.email || null,
          relationship: formData.relationship || null,
          priority: parseInt(formData.priority) || 0,
        })
        .eq('id', editingContact.id)
        .eq('user_id', user.id)

      if (error) throw error

      setEditingContact(null)
      setFormData({
        name: '',
        phone: '',
        email: '',
        relationship: '',
        priority: '0',
      })
      setShowAddForm(false)
      loadContacts()
    } catch (error: any) {
      alert(`Failed to update contact: ${error.message}`)
    }
  }

  const handleDeleteContact = async (contactId: string) => {
    if (!user) return

    const confirmed = window.confirm('Are you sure you want to remove this contact?')

    if (!confirmed) return

    const supabase = createClient()

    try {
      const { error } = await supabase
        .from('emergency_contacts')
        .delete()
        .eq('id', contactId)
        .eq('user_id', user.id)

      if (error) throw error

      loadContacts()
    } catch (error: any) {
      alert(`Failed to delete contact: ${error.message}`)
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

