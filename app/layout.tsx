import type { Metadata } from "next";
import localFont from "next/font/local";
import { cookies } from "next/headers";
import "./globals.css";

// Brand fonts, self-hosted (CSP allows no third-party font origins): Barlow Condensed headings, Inter body.
const inter = localFont({ src: "./fonts/Inter-Var.ttf", variable: "--font-inter", display: "swap" });
const barlow = localFont({
  src: [
    { path: "./fonts/BarlowCondensed-SemiBold.ttf", weight: "600" },
    { path: "./fonts/BarlowCondensed-Bold.ttf", weight: "700" },
  ],
  variable: "--font-barlow",
  display: "swap",
});

export const metadata: Metadata = {
  title: "MotoNorte Payroll",
  description: "HR & payroll with mechanic incentives",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = (await cookies()).get("mn_theme")?.value === "light" ? "light" : "dark"; // dark brand: dark by default
  return (
    <html lang="en" data-theme={theme} className={`${inter.variable} ${barlow.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
