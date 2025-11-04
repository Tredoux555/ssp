// Server component - exports generateStaticParams for static export
export async function generateStaticParams() {
  return []
}

// Import wrapper component that handles client component
import ClientWrapper from './ClientWrapper'

export default function AcceptInvitePage() {
  return <ClientWrapper />
}
