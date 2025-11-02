# SSP - Self Security Project

**Emergency alert notification system for South Africa**

A life-critical emergency alert application designed to instantly notify emergency contacts when someone is in danger. Built with a focus on reliability, security, and real-time location tracking.

---

## Features

### Core Emergency Features
- **One-Button Emergency Alert**: Single button press to send emergency alert to all contacts
- **Real-Time Location Tracking**: Continuous GPS tracking during emergency (updates every 10 seconds)
- **Red Flashing Alert Screen**: Full-screen emergency alert with flashing animation, custom sound, and vibration
- **Instant Notifications**: Urgent push notifications to all emergency contacts
- **Navigation Support**: Direct navigation to distress location via Google Maps

### User Features
- **Contact Management**: Add, edit, and remove emergency contacts
- **Priority System**: Set contact priority for notification order
- **Profile Management**: Update user profile with name and phone
- **Rate Limiting**: Prevents accidental multiple alerts (max 1 per 30 seconds)

### Admin Features (Future)
- **Mass Notifications**: Send notifications to all users or specific groups
- **Social Group Management**: Create and manage user groups
- **Active Emergencies Dashboard**: Monitor all active emergencies
- **Analytics**: View emergency statistics and trends

---

## Tech Stack

- **Frontend**: Next.js 16+ (App Router), TypeScript, Tailwind CSS
- **Backend**: Supabase (PostgreSQL, Auth, Realtime)
- **Maps**: Google Maps API (Geocoding, Maps JavaScript API)
- **Styling**: South African flag colors (green, gold, red, blue, black, white)
- **Deployment**: Vercel

---

## Getting Started

### Prerequisites

- Node.js 18+ 
- npm or yarn
- Supabase account (separate project from jeffy)
- Google Maps API key
- Vercel account (for deployment)

### Installation

1. **Clone the repository**
   ```bash
   git clone <your-repo-url>
   cd ssp
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up Supabase**
   - Create a new Supabase project (completely separate from jeffy)
   - Run the SQL schema from `supabase-schema.sql`
   - Enable Realtime for `emergency_alerts` and `location_history` tables
   - Get your project URL and anon key

4. **Configure environment variables**
   ```bash
   cp .env.local.example .env.local
   ```
   
   Update `.env.local` with your actual values:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
   
   NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
   
   ADMIN_EMAIL=your_admin_email@example.com
   ADMIN_PASSWORD=your_secure_admin_password
   ```

5. **Run the development server**
   ```bash
   npm run dev
   ```

6. **Open your browser**
   Navigate to [http://localhost:3000](http://localhost:3000)

---

## Project Structure

```
ssp/
├── app/
│   ├── admin/              # Admin dashboard (future)
│   ├── alert/[id]/         # Contact view of emergency
│   ├── auth/               # Authentication pages
│   │   ├── login/
│   │   └── register/
│   ├── contacts/           # Contact management
│   ├── dashboard/          # Main user dashboard
│   ├── emergency/
│   │   └── active/[id]/    # Emergency alert screen
│   ├── profile/            # User profile settings
│   └── api/                # API routes
│       ├── emergency/
│       ├── location/
│       └── admin/
├── components/
│   ├── Button.tsx
│   ├── Card.tsx
│   ├── EmergencyMap.tsx
│   └── Input.tsx
├── lib/
│   ├── contexts/
│   │   └── AuthContext.tsx
│   ├── emergency.ts        # Emergency alert functions
│   ├── location.ts         # Location tracking utilities
│   ├── realtime/
│   │   └── subscriptions.ts
│   ├── supabase.ts
│   └── utils.ts
├── types/
│   └── database.ts         # TypeScript types
└── supabase-schema.sql     # Database schema
```

---

## Database Schema

### Core Tables

- **user_profiles**: Extended user profiles (extends Supabase auth.users)
- **emergency_alerts**: Active and resolved emergency alerts
- **emergency_contacts**: User's emergency contact list
- **alert_responses**: Contact acknowledgments and responses
- **location_history**: GPS location tracking during emergencies
- **social_groups**: Admin-managed user groups (future)
- **group_members**: Group membership (future)
- **admin_notifications**: Mass notification history (future)
- **audit_logs**: Security audit trail

### Security

- **Row Level Security (RLS)** enabled on all tables
- Users can only see their own data
- Contacts can only see alerts they're notified about
- Location history only visible during active emergency
- Admin access is separate and secured

---

## Key Features Implementation

### Emergency Alert Flow

1. User presses emergency button on dashboard
2. Rate limit check (max 1 per 30 seconds)
3. Confirmation dialog
4. Get current GPS location
5. Create emergency alert in database
6. Get user's emergency contacts
7. Send notifications to all contacts
8. Navigate to emergency alert screen
9. Start continuous location tracking
10. Real-time location updates every 10 seconds

### Contact Alert Flow

1. Contact receives push notification
2. Opens alert response page
3. Sees real-time location on map
4. Can acknowledge alert ("I'm on my way")
5. Can navigate directly to location via Google Maps
6. Receives real-time location updates as person moves

---

## Security Considerations

- **Rate Limiting**: Emergency button (30 seconds), location updates (5 seconds)
- **RLS Policies**: Comprehensive Row Level Security on all tables
- **Data Privacy**: Location only shared during active emergency
- **Audit Logging**: All critical actions logged
- **Encryption**: Sensitive data encrypted at rest

---

## Deployment

### Vercel Deployment

1. **Connect to GitHub**
   - Push your code to GitHub
   - Connect your repository to Vercel

2. **Configure Environment Variables**
   - Add all environment variables in Vercel dashboard
   - Use production Supabase project
   - Add Google Maps API key

3. **Deploy**
   - Vercel will automatically deploy on push to main branch
   - Custom domain can be configured in Vercel dashboard

### Supabase Production Setup

1. **Create Production Project**
   - Create a new Supabase project for production
   - Run the schema SQL file from `supabase-schema.sql`

2. **Enable Realtime**
   - Enable Realtime for `emergency_alerts` table
   - Enable Realtime for `location_history` table

3. **Configure Storage**
   - Set up production storage bucket (if needed for profile photos)

---

## Development

### Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Color Scheme

South African flag colors:
- Green: `#007A4D` (sa-green)
- Gold: `#FFB612` (sa-gold)
- Red: `#DE3831` (sa-red) - Used for emergencies
- Blue: `#002395` (sa-blue)
- Black: `#000000` (sa-black)
- White: `#FFFFFF` (sa-white)

---

## Future Enhancements

- [ ] Push notification system (via Supabase Edge Functions or external service)
- [ ] Admin dashboard with mass notifications
- [ ] Social group management
- [ ] PWA with offline support
- [ ] Background location tracking
- [ ] SMS notifications fallback
- [ ] Multi-language support
- [ ] Emergency type selection (robbery, house breaking, etc.)
- [ ] Contact verification system

---

## Important Notes

- **This app is completely separate from jeffy projects** - separate Supabase project, GitHub repo, Vercel project
- **Life-critical system** - must never crash, must be reliable
- **Privacy first** - user data only visible to admin and emergency contacts during active emergency
- **Free service** - no payments, 100% free

---

## License

Private project - All rights reserved

---

## Support

For issues or questions, contact the project administrator.
