import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "STATUS People · Colégio Status", description: "Gestão de pessoas do Colégio Status" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
