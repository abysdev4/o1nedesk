using System.Drawing;
using System.Reflection;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Aviso obrigatorio de atualizacao no PC do usuario. Reaparece ate atualizar ou adiar.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class UpdatePromptForm : Form
{
    private readonly AgentConfig _cfg;
    private readonly AgentClient _client;
    private readonly string _latestVersion;
    private readonly System.Windows.Forms.Timer _topmost;
    private readonly Label _status;
    private readonly ProgressBar _progress;
    private readonly Button _btnUpdate;
    private readonly Button _btnSnooze;
    private bool _running;
    private bool _allowClose;

    public UpdatePromptForm(AgentConfig cfg, AgentClient client, string latestVersion, bool adminRequested = false)
    {
        _cfg = cfg;
        _client = client;
        _latestVersion = latestVersion;

        Text = "OneDesk — Atualizacao obrigatoria";
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        ShowInTaskbar = true;
        Width = 520;
        Height = adminRequested ? 420 : 390;
        BackColor = Color.FromArgb(8, 11, 18);
        ForeColor = Color.White;

        var card = new Panel
        {
            Left = 24,
            Top = 20,
            Width = 452,
            Height = adminRequested ? 340 : 310,
            BackColor = Color.FromArgb(17, 22, 31),
        };
        Controls.Add(card);

        var logo = new PictureBox
        {
            SizeMode = PictureBoxSizeMode.Zoom,
            Width = 180,
            Height = 44,
            Left = (card.Width - 180) / 2,
            Top = 22,
            BackColor = Color.Transparent,
        };
        try
        {
            var asm = Assembly.GetExecutingAssembly();
            var res = Array.Find(asm.GetManifestResourceNames(), n => n.EndsWith("logo-white.png", StringComparison.OrdinalIgnoreCase));
            if (res != null) { using var s = asm.GetManifestResourceStream(res); if (s != null) logo.Image = Image.FromStream(s); }
        }
        catch { }
        card.Controls.Add(logo);

        card.Controls.Add(new Label
        {
            Text = "Atualizacao obrigatoria",
            Font = new Font("Segoe UI", 15f, FontStyle.Bold),
            ForeColor = Color.FromArgb(255, 140, 66),
            AutoSize = false,
            Width = card.Width,
            Height = 32,
            Top = 78,
            TextAlign = ContentAlignment.MiddleCenter,
        });

        var body = adminRequested
            ? $"O suporte solicitou a atualizacao deste computador.\n\nVersao instalada: v{UpdateManager.CurrentVersion}\nNova versao: v{_latestVersion}\n\nClique em Atualizar agora. O download e a instalacao sao automaticos."
            : $"Uma nova versao do OneDesk Agent esta disponivel.\n\nVersao instalada: v{UpdateManager.CurrentVersion}\nNova versao: v{_latestVersion}\n\nPara continuar usando o suporte remoto, atualize agora.";

        card.Controls.Add(new Label
        {
            Text = body,
            Font = new Font("Segoe UI", 10f),
            ForeColor = Color.FromArgb(180, 190, 210),
            Left = 28,
            Top = 118,
            Width = card.Width - 56,
            Height = adminRequested ? 110 : 95,
        });

        _status = new Label
        {
            Text = "",
            Font = new Font("Segoe UI", 9f),
            ForeColor = Color.FromArgb(140, 150, 170),
            Left = 28,
            Top = adminRequested ? 228 : 218,
            Width = card.Width - 56,
            Height = 20,
        };
        card.Controls.Add(_status);

        _progress = new ProgressBar
        {
            Left = 28,
            Top = adminRequested ? 252 : 242,
            Width = card.Width - 56,
            Height = 8,
            Style = ProgressBarStyle.Continuous,
            Visible = false,
        };
        card.Controls.Add(_progress);

        _btnUpdate = new Button
        {
            Text = "Atualizar agora",
            Width = 200,
            Height = 38,
            Left = 28,
            Top = adminRequested ? 272 : 262,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(255, 140, 66),
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 10f, FontStyle.Bold),
            Cursor = Cursors.Hand,
        };
        _btnUpdate.FlatAppearance.BorderSize = 0;
        _btnUpdate.Click += (_, _) => _ = RunUpdateAsync();
        card.Controls.Add(_btnUpdate);

        _btnSnooze = new Button
        {
            Text = "Adiar 2 horas",
            Width = 140,
            Height = 38,
            Left = card.Width - 28 - 140,
            Top = _btnUpdate.Top,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(35, 42, 55),
            ForeColor = Color.FromArgb(160, 170, 190),
            Font = new Font("Segoe UI", 9f),
            Cursor = Cursors.Hand,
        };
        _btnSnooze.FlatAppearance.BorderColor = Color.FromArgb(55, 65, 80);
        _btnSnooze.Click += (_, _) =>
        {
            UpdateManager.Snooze(TimeSpan.FromHours(2));
            _allowClose = true;
            Close();
        };
        card.Controls.Add(_btnSnooze);

        _topmost = new System.Windows.Forms.Timer { Interval = 800 };
        _topmost.Tick += (_, _) =>
        {
            try { if (!TopMost) TopMost = true; BringToFront(); Activate(); } catch { }
        };
        _topmost.Start();

        FormClosing += (_, e) =>
        {
            if (!_allowClose && !_running)
            {
                e.Cancel = true;
                FlashWindow();
            }
        };

        Shown += (_, _) => { try { System.Media.SystemSounds.Exclamation.Play(); } catch { } };
    }

    private void FlashWindow()
    {
        try
        {
            _status.Text = "Esta atualizacao e obrigatoria. Clique em Atualizar ou Adiar.";
            _status.ForeColor = Color.FromArgb(255, 140, 66);
        }
        catch { }
    }

    private async Task RunUpdateAsync()
    {
        if (_running) return;
        _running = true;
        _btnUpdate.Enabled = false;
        _btnSnooze.Enabled = false;
        _progress.Visible = true;
        _progress.Value = 0;
        _status.Text = "Preparando download...";

        var progress = new Progress<int>(pct =>
        {
            try
            {
                _progress.Value = Math.Clamp(pct, 0, 100);
                if (pct < 100) _status.Text = $"Baixando... {pct}%";
            }
            catch { }
        });

        await UpdateManager.RunUserUpdateAsync(_cfg, this, phase =>
        {
            try
            {
                BeginInvoke(() =>
                {
                    _status.Text = PhaseLabel(phase);
                    if (phase.StartsWith("failed:") || phase == "uac_cancelled")
                    {
                        _running = false;
                        _btnUpdate.Enabled = true;
                        _btnSnooze.Enabled = true;
                        _progress.Visible = false;
                    }
                    _client.ReportUpdateStatus(phase);
                });
            }
            catch { }
        }, progress);

        _running = false;
    }

    private static string PhaseLabel(string phase) => phase switch
    {
        "checking" => "Verificando versao...",
        "downloading" => "Baixando atualizacao...",
        "applying" => "Instalando (aguarde)...",
        "restarting" => "Reiniciando agente...",
        "already_latest" => "Ja esta na versao mais recente.",
        "busy" => "Atualizacao em andamento...",
        "uac_cancelled" => "Permissao de administrador necessaria. Tente novamente.",
        _ when phase.StartsWith("failed:") => $"Falha: {phase[7..]}",
        _ => phase,
    };

    protected override void Dispose(bool disposing)
    {
        if (disposing) _topmost.Dispose();
        base.Dispose(disposing);
    }
}
