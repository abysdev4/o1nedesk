using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

[SupportedOSPlatform("windows")]
static class Program
{
    private const string AgentMutex = "OneDeskAgent_SingleInstance";
    private const string WatchdogMutex = "OneDeskWatchdog_Instance";
    private static Mutex? _mutex;

    private static string StopFlag =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OneDesk", "stop.flag");

    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int n);
    private static bool IsShuttingDown() => GetSystemMetrics(0x2000) != 0; // SM_SHUTTINGDOWN

    [STAThread]
    static void Main(string[] args)
    {
        if (args.Contains("--uninstall")) { Installer.Uninstall(); return; }
        if (args.Contains("--watchdog")) { RunWatchdog(); return; }

        // Reinstalacao/atualizacao elevada (--install pedido pelo instalador)
        if (args.Contains("--install"))
        {
            if (Installer.IsElevated()) Installer.Install();
            else Installer.RelaunchElevatedToInstall();
            return;
        }

        // Update baixado pelo agente — executado elevado pela tarefa agendada
        if (args.Contains("--install-pending"))
        {
            if (Installer.IsElevated()) Installer.InstallPendingUpdate();
            else Installer.RelaunchElevated("--install-pending");
            return;
        }

        // Auto-instalacao (quando rodado de fora de Program Files)
        bool forceRun = args.Contains("--run");
        if (!forceRun && !Installer.IsInstalledHere())
        {
            if (Installer.IsElevated()) Installer.Install();
            else Installer.RelaunchElevatedToInstall();
            return;
        }

        _mutex = new Mutex(true, AgentMutex, out bool createdNew);
        if (!createdNew) return;

        // Garante o watchdog rodando (apenas quando instalado)
        if (Installer.IsInstalledHere()) EnsureWatchdog();

        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new TrayContext());
    }

    private static void EnsureWatchdog()
    {
        try
        {
            if (Mutex.TryOpenExisting(WatchdogMutex, out var m)) { m.Dispose(); return; }
            Process.Start(new ProcessStartInfo
            {
                FileName = Installer.InstalledExe,
                Arguments = "--watchdog",
                UseShellExecute = false,
                CreateNoWindow = true,
            });
        }
        catch { }
    }

    // ===================== Watchdog =====================
    private static void RunWatchdog()
    {
        using var wd = new Mutex(true, WatchdogMutex, out bool createdNew);
        if (!createdNew) return; // ja existe watchdog

        var cfg = AgentConfig.Load();
        bool wasDown = false;

        while (true)
        {
            try
            {
                if (File.Exists(StopFlag)) return;          // pedido de parada (uninstall)
                if (IsShuttingDown()) { Thread.Sleep(3000); continue; }

                bool agentAlive = Mutex.TryOpenExisting(AgentMutex, out var am);
                if (am != null) am.Dispose();

                if (!agentAlive)
                {
                    if (!wasDown)
                    {
                        wasDown = true;
                        // Alerta uma vez por episodio de queda
                        try { AlertSender.Send(cfg, "agent_down", "Agente encerrado — reiniciando automaticamente", "danger").Wait(4000); } catch { }
                    }
                    // Reinicia o agente
                    if (File.Exists(Installer.InstalledExe))
                    {
                        try
                        {
                            Process.Start(new ProcessStartInfo
                            {
                                FileName = Installer.InstalledExe,
                                UseShellExecute = true,
                            });
                        }
                        catch { }
                    }
                }
                else
                {
                    wasDown = false;
                }
            }
            catch { }
            Thread.Sleep(5000);
        }
    }
}

[SupportedOSPlatform("windows")]
sealed class TrayContext : ApplicationContext
{
    private readonly NotifyIcon _tray;
    private readonly AgentClient _client;
    private readonly CancellationTokenSource _cts = new();
    private readonly AgentConfig _cfg;
    private readonly SynchronizationContext _ui;
    private UpdatePromptForm? _updatePrompt;
    private readonly System.Windows.Forms.Timer _updatePoll;

    public TrayContext()
    {
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _cfg = AgentConfig.Load();

        _tray = new NotifyIcon
        {
            Icon = LoadIcon(),
            Visible = true,
            Text = "OneDesk Agent — iniciando...",
        };

        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("OneDesk — Suporte Remoto") { Enabled = false });
        var statusItem = new ToolStripMenuItem("Status: conectando...") { Enabled = false };
        menu.Items.Add(statusItem);
        menu.Items.Add(new ToolStripMenuItem($"ID: {_cfg.AgentId[..Math.Min(8, _cfg.AgentId.Length)]}") { Enabled = false });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Sobre", null, (_, _) =>
            MessageBox.Show(
                "OneDesk Agent 1.0\n\nEste computador esta conectado ao suporte remoto da sua empresa.\n" +
                "O tecnico pode ver estatisticas, abrir um terminal e, com sua ciencia, a area de trabalho,\n" +
                "consultar a localizacao aproximada e bloquear o dispositivo remotamente (anti-furto).\n\n" +
                $"Servidor: {_cfg.HubWs}\nID: {_cfg.AgentId}",
                "OneDesk Agent", MessageBoxButtons.OK, MessageBoxIcon.Information));
        menu.Items.Add("Sair", null, (_, _) => RequestExit());
        _tray.ContextMenuStrip = menu;

        _client = new AgentClient(_cfg);
        _client.OnUpdateRequested = adminRequested => _ = PollForUpdateAsync(adminRequested);
        _client.OnConnectionChanged = connected => _ui.Post(_ =>
        {
            try
            {
                _tray.Text = connected ? "OneDesk Agent — conectado" : "OneDesk Agent — reconectando...";
                statusItem.Text = connected ? "Status: conectado" : "Status: reconectando...";
            }
            catch { }
        }, null);

        _client.OnNotify = (title, message, popup) => _ui.Post(_ =>
        {
            try
            {
                if (popup)
                    MessageBox.Show(message, string.IsNullOrEmpty(title) ? "OneDesk" : title,
                        MessageBoxButtons.OK, MessageBoxIcon.Information);
                else
                {
                    _tray.BalloonTipTitle = string.IsNullOrEmpty(title) ? "OneDesk" : title;
                    _tray.BalloonTipText = message;
                    _tray.ShowBalloonTip(6000);
                }
            }
            catch { }
        }, null);

        _client.OnLock = () => _ui.Post(_ => ShowLock(), null);
        _client.OnUnlock = () => _ui.Post(_ => HideLock(), null);

        _client.OnBlockInput = on => _ui.Post(_ =>
        {
            try { if (on) LocalInputBlocker.Enable(); else LocalInputBlocker.Disable(); }
            catch { }
        }, null);

        _client.OnPrivacyScreen = on => _ui.Post(_ =>
        {
            try { if (on) ShowPrivacy(); else HidePrivacy(); }
            catch { }
        }, null);

        _client.OnClipboardSet = (text) => _ui.Post(_ =>
        {
            try { if (!string.IsNullOrEmpty(text)) Clipboard.SetText(text); } catch { }
        }, null);
        _client.OnClipboardGet = () => _ui.Post(_ =>
        {
            string t = "";
            try { if (Clipboard.ContainsText()) t = Clipboard.GetText(); } catch { }
            _client.SendClipboard(t);
        }, null);
        _client.OnFileSaved = (name) => _ui.Post(_ =>
        {
            try
            {
                _tray.BalloonTipTitle = "Arquivo recebido";
                _tray.BalloonTipText = $"{name} — salvo em Downloads\\OneDesk";
                _tray.ShowBalloonTip(5000);
            }
            catch { }
        }, null);

        // Redirecionamento de clipboard: admin copia na maquina dele e da Ctrl+V na conexao remota
        _client.OnPasteText = (text) => _ui.Post(_ =>
        {
            try
            {
                if (!string.IsNullOrEmpty(text)) { Clipboard.SetText(text); InputInjector.PasteShortcut(); }
            }
            catch { }
        }, null);
        _client.OnPasteFiles = (files) => _ui.Post(_ =>
        {
            try
            {
                var col = new System.Collections.Specialized.StringCollection();
                col.AddRange(files.ToArray());
                Clipboard.SetFileDropList(col);
                InputInjector.PasteShortcut();
            }
            catch { }
        }, null);

        _tray.BalloonTipTitle = "OneDesk Agent ativo";
        _tray.BalloonTipText = "Este computador esta disponivel para suporte remoto.";
        _tray.ShowBalloonTip(4000);

        _updatePoll = new System.Windows.Forms.Timer { Interval = 20 * 60 * 1000 };
        _updatePoll.Tick += (_, _) => _ = PollForUpdateAsync(false);
        _updatePoll.Start();
        _ = PollForUpdateAsync(false);

        _ = _client.RunAsync(_cts.Token);

        // Bloqueio anti-furto persistente: se estava bloqueado, reabre a tela no boot
        if (LockStore.IsLocked) _ui.Post(_ => ShowLock(), null);
    }

    private async Task PollForUpdateAsync(bool adminRequested)
    {
        if (UpdateManager.IsSnoozed() && !adminRequested) return;
        try
        {
            var info = await UpdateManager.FetchLatestAsync(_cfg);
            if (info == null)
            {
                // Aviso forcado pelo dashboard, mas ja esta na versao mais recente:
                // devolve status para o tecnico nao ficar preso em "aguardando cliente".
                if (adminRequested) _client.ReportUpdateStatus("already_latest");
                return;
            }
            _ui.Post(_ => ShowUpdatePrompt(info.LatestVersion, adminRequested), null);
        }
        catch
        {
            if (adminRequested) _client.ReportUpdateStatus("failed:check");
        }
    }

    private void ShowUpdatePrompt(string? latestVersion, bool adminRequested)
    {
        try
        {
            if (_updatePrompt != null && !_updatePrompt.IsDisposed)
            {
                _updatePrompt.BringToFront();
                _updatePrompt.Activate();
                return;
            }
            if (!adminRequested && UpdateManager.IsSnoozed()) return;
            var ver = latestVersion ?? "?";
            _updatePrompt = new UpdatePromptForm(_cfg, _client, ver, adminRequested);
            _updatePrompt.FormClosed += (_, _) => _updatePrompt = null;
            _updatePrompt.Show();
        }
        catch { }
    }

    private LockScreen? _lock;
    private PrivacyScreen? _privacy;

    private void ShowPrivacy()
    {
        try
        {
            if (_privacy != null && !_privacy.IsDisposed) { _privacy.Activate(); return; }
            _privacy = new PrivacyScreen();
            _privacy.FormClosed += (_, _) => _privacy = null;
            _privacy.Show();
        }
        catch { }
    }

    private void HidePrivacy()
    {
        try { _privacy?.ForceClose(); } catch { }
        _privacy = null;
    }

    private void ShowLock()
    {
        try
        {
            if (_lock != null && !_lock.IsDisposed) { _lock.Activate(); return; }
            _lock = new LockScreen(() =>
            {
                // desbloqueio local (senha correta): persiste e avisa o hub
                LockStore.SetLocked(false);
                try { _client.ReportLock(false); } catch { }
            });
            _lock.FormClosed += (_, _) => _lock = null;
            _lock.Show();
        }
        catch { }
    }

    private void HideLock()
    {
        try { _lock?.ForceClose(); } catch { }
        _lock = null;
    }

    private void RequestExit()
    {
        // Avisa o admin de que o usuario fechou manualmente (o watchdog reinicia depois)
        try { AlertSender.Send(_cfg, "close_attempt", "Usuario fechou o agente pela bandeja", "warn").Wait(2500); } catch { }
        ExitThread();
    }

    private static Icon LoadIcon()
    {
        try
        {
            var exeIcon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            if (exeIcon != null) return exeIcon;
        }
        catch { }
        return SystemIcons.Information;
    }

    protected override void ExitThreadCore()
    {
        try { _cts.Cancel(); } catch { }
        try { _updatePoll.Stop(); _updatePoll.Dispose(); } catch { }
        try { LocalInputBlocker.Disable(); } catch { }
        try { HidePrivacy(); } catch { }
        try { InputInjector.ReleaseAll(); } catch { }
        try { _tray.Visible = false; _tray.Dispose(); } catch { }
        base.ExitThreadCore();
    }
}
