import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "STATUS ONE · Colégio Status",
  description: "Sistema de gestão do Colégio Status",
  applicationName: "STATUS ONE",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/favicon-64.png", sizes: "64x64", type: "image/png" }, { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }], apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }] },
  appleWebApp: { capable: true, title: "STATUS ONE", statusBarStyle: "black" },
  formatDetection: { telephone: false },
  // iPhone/iPad (Safari) ainda lê a etiqueta antiga para abrir em tela cheia pela tela de início
  other: { "apple-mobile-web-app-capable": "yes" },
};
export const viewport: Viewport = { themeColor: "#0b2545", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
