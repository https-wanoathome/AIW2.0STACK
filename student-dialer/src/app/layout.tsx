import type { Metadata } from "next";
import { Geist, Geist_Mono, Anton } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Display font: heavy condensed sans for huge uppercase headlines and
// hero metric numbers. Free closest match to Druk-style condensed
// display fonts seen in the design inspiration.
const anton = Anton({
  variable: "--font-anton",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  // `title.template` lets every page suffix its own label. Pages that
  // don't set their own title fall back to `default`.
  title: {
    template: "%s | Student Dialer",
    default: "Student Dialer",
  },
  description: "Lightweight dialing dashboard for students",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${anton.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body
        className="min-h-full flex flex-col bg-[var(--background)] text-[var(--foreground)]"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
