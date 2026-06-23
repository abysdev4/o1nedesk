import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "OneDesk — Helpdesk Remoto",
  description: "Plataforma de suporte remoto, terminal, captura de tela e estatisticas",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
