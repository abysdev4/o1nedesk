# OneDesk — Plataforma de Helpdesk com Acesso Remoto

Suporte remoto para Windows: **estatísticas ao vivo, terminal (CMD/PowerShell), captura e controle de tela**, tudo num dashboard web. Agente com **instalador personalizado** que sobe automaticamente com o Windows.

```
┌──────────────────┐      WebSocket       ┌───────────────┐      HTTP/WS      ┌─────────────┐
│  AGENTE WINDOWS  │  stats · terminal ·  │      HUB      │  ticket assinado  │  DASHBOARD  │
│   (.NET, bandeja)│  tela · input        │  (Node + WS)  │  + stats ao vivo  │  (Next.js)  │
└──────────────────┘ ───────────────────► │  ↕ Neon       │ ◄──────────────►  └─────────────┘
                                          └───────┬───────┘
                                                  ▼
                                          Neon Postgres (Drizzle)
```

## Estrutura

| Caminho | O quê |
|---|---|
| `packages/db` | Schema Drizzle + cliente Postgres (Neon) + seed do admin |
| `apps/hub` | Servidor WebSocket: roteia agente ↔ console, persiste stats e auditoria |
| `apps/dashboard` | Next.js: login, frota, stats, terminal (xterm), tela remota, tickets, auditoria |
| `agent` | Agente Windows em .NET (bandeja): stats, ConPTY, captura de tela, input |
| `installer` | `build-agent.ps1`, `install-local.ps1`, `uninstall.ps1`, `onedesk.iss` (Inno Setup) |

## Pré-requisitos
- Node 20+ · .NET 10 SDK (para compilar o agente) · conta Neon (já provisionada)

## Como rodar (desenvolvimento)

```bash
npm install
npm run db:push      # cria as tabelas no Neon
npm run db:seed      # cria o admin (henrique@onedata.com)

npm run dev:hub        # terminal 1 → ws://localhost:4000
npm run dev:dashboard  # terminal 2 → http://localhost:3000
```

Login: **henrique@onedata.com** / **henrique21**

## Agente / instalador

```powershell
# 1) compila o agente (exe único, self-contained — não precisa de .NET no cliente)
installer\build-agent.ps1

# 2a) instalar no cliente (auto-start com o Windows). Rode como ADMINISTRADOR:
installer\install-local.ps1 -HubWs "ws://SEU_SERVIDOR:4000" -EnrollToken "<token>"

# 2b) ou gerar o instalador .exe distribuível (precisa do Inno Setup):
#     ajuste MyHubWs/MyEnrollToken em onedesk.iss e rode:
iscc installer\onedesk.iss     # gera installer\Output\OneDeskAgentSetup.exe
```

O agente:
- registra a máquina automaticamente no primeiro start (ID persistente em `C:\ProgramData\OneDesk`);
- **sobe com o Windows** via chave `Run` (HKLM) + **Tarefa Agendada no logon** (redundância);
- mostra **ícone na bandeja** e pede **consentimento** na instalação (necessário para passar em antivírus/SmartScreen e cumprir LGPD);
- reconecta sozinho se cair.

Desinstalar: `installer\uninstall.ps1` (como admin).

## Releases do agente (GitHub)

Binarios (~147 MB) sao publicados no **GitHub Releases** (nao cabem na Vercel).

```powershell
# Setup inicial (uma vez): auth + repo + secret DATABASE_URL
installer\setup-github.ps1

# Publicar nova versao (automatico via CI):
git tag v1.2.1
git push origin v1.2.1
# -> GitHub Actions compila, cria Release, atualiza manifesto no Neon

# Ou manualmente:
installer\publish-release.ps1 -Version 1.2.1 -Notes "..."
```

Clientes **v1.2.0+** recebem aviso no PC e baixam de `downloadUrl` (GitHub). Hub `/download/agent` e fallback.

Clientes **legados** (v1.1.x): `installer\update-legacy.ps1` como admin **uma vez**.

## Variáveis de ambiente (`.env` na raiz)
`DATABASE_URL`, `AUTH_SECRET`, `ENROLL_TOKEN`, `HUB_INTERNAL_TOKEN`, `ADMIN_*`, `HUB_PORT`, `GITHUB_RELEASE_REPO`.
O dashboard usa `apps/dashboard/.env.local` (`DATABASE_URL`, `AUTH_SECRET`, `NEXT_PUBLIC_HUB_WS`).
No Vercel: `GITHUB_RELEASE_REPO=seu-usuario/o1nedesk`.

## Tela remota
- **HD (WebRTC)** — vídeo VP8 codificado no agente (SIPSorcery + libvpx), P2P direto pro `<video>` do navegador. Sinalização (offer/answer/ICE) pelo hub; STUN do Google p/ NAT. Controle de mouse/teclado por cima.
- **Básico (JPEG)** — fallback compatível (stream de quadros JPEG), também com controle.

## Segurança / produção (próximos passos)
- **Code signing** do `OneDeskAgent.exe` (evita bloqueio de SmartScreen/AV).
- Hub atrás de **WSS/TLS** (ws:// → wss://) e domínio próprio.
- **TURN server** para clientes atrás de NAT simétrico (hoje só STUN — funciona em LAN e NATs comuns).
- **MFA** para técnicos (estrutura já no schema: `users.mfaSecret`).
- Encoder **H.264 por hardware** (NVENC/QuickSync) p/ menos CPU; seleção de monitor único em setups multi-tela.
- Trim do agente (~123 MB self-contained) ou publish framework-dependent.
