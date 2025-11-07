import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/contexts/AuthContext";
import { ErrorHandler } from "@/components/ErrorHandler";
import PushNotificationSetup from "@/components/PushNotificationSetup";
import { GlobalErrorBoundary } from "@/components/GlobalErrorBoundary";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  fallback: ["system-ui", "arial"],
});

export const metadata: Metadata = {
  title: "PSP - Personal Security Program",
  description: "Emergency alert notification system for South Africa",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${inter.variable} font-sans antialiased`}>
        <GlobalErrorBoundary>
          <ErrorHandler />
          <AuthProvider>
            <PushNotificationSetup />
            {children}
          </AuthProvider>
        </GlobalErrorBoundary>
      </body>
    </html>
  );
}
