import type { NextConfig } from "next";

const isCapacitorBuild = process.env.CAPACITOR_BUILD === 'true';

const nextConfig: NextConfig = {
  // Enable static export for Capacitor (mobile builds)
  // Note: API routes won't work in static export - we'll migrate to Supabase Edge Functions
  output: isCapacitorBuild ? 'export' : undefined,
  
  // Configure images for static export
  images: {
    unoptimized: isCapacitorBuild,
  },
  
  // Disable server-side features for static export
  trailingSlash: true,
  
  // Skip API routes during static export (they won't work anyway)
  ...(isCapacitorBuild && {
    // Exclude API routes from static export
    generateBuildId: async () => {
      return 'mobile-build'
    },
  }),
};

export default nextConfig;
