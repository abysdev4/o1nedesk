using System.Drawing;
using System.Reflection;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Tela de bloqueio em tela cheia (cobre todos os monitores), topmost, com o cartao
/// centralizado no monitor principal. Logo + texto corporativo + senha de desbloqueio.
/// (Nao desabilita Ctrl+Alt+Del/Gerenciador — isso seria comportamento de malware.)
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class LockScreen : Form
{
    private const string CorporateText =
        "Este dispositivo foi bloqueado pelo administrador por motivos de seguranca. " +
        "Insira a senha de desbloqueio fornecida pela sua organizacao ou contate o suporte de TI.";

    private readonly Action _onUnlocked;
    private readonly TextBox _pass;
    private readonly Label _error;
    private readonly System.Windows.Forms.Timer _topmostTimer;
    private bool _allowClose;

    public LockScreen(Action onUnlocked)
    {
        _onUnlocked = onUnlocked;

        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        TopMost = true;
        BackColor = Color.FromArgb(8, 11, 18);
        StartPosition = FormStartPosition.Manual;
        Bounds = SystemInformation.VirtualScreen; // cobre todos os monitores
        KeyPreview = true;
        Cursor = Cursors.Default;

        // ===== Cartao central =====
        var card = new Panel
        {
            Width = 460,
            Height = 470,
            BackColor = Color.FromArgb(17, 22, 31),
        };
        // centraliza no MONITOR PRINCIPAL (nao no meio da area virtual multi-monitor)
        var vs = SystemInformation.VirtualScreen;
        var prim = Screen.PrimaryScreen?.Bounds ?? vs;
        card.Left = (prim.X - vs.X) + (prim.Width - card.Width) / 2;
        card.Top = (prim.Y - vs.Y) + (prim.Height - card.Height) / 2;

        // Logo (recurso embutido)
        var logo = new PictureBox
        {
            SizeMode = PictureBoxSizeMode.Zoom,
            Width = 220,
            Height = 52,
            Left = (card.Width - 220) / 2,
            Top = 34,
            BackColor = Color.Transparent,
        };
        try
        {
            var asm = Assembly.GetExecutingAssembly();
            var resName = Array.Find(asm.GetManifestResourceNames(), n => n.EndsWith("logo-white.png", StringComparison.OrdinalIgnoreCase));
            if (resName != null)
            {
                using var stream = asm.GetManifestResourceStream(resName);
                if (stream != null) logo.Image = Image.FromStream(stream);
            }
        }
        catch { }

        var title = new Label
        {
            Text = "Dispositivo bloqueado",
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 15, FontStyle.Bold),
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleCenter,
            Left = 30, Top = 98, Width = card.Width - 60, Height = 44,
        };

        var text = new Label
        {
            Text = CorporateText,
            ForeColor = Color.FromArgb(138, 152, 172),
            Font = new Font("Segoe UI", 9.5f),
            AutoSize = false,
            TextAlign = ContentAlignment.TopCenter,
            Left = 36, Top = 152, Width = card.Width - 72, Height = 102,
        };

        _pass = new TextBox
        {
            UseSystemPasswordChar = true,
            Font = new Font("Segoe UI", 12),
            Width = card.Width - 72, Left = 36, Top = 270, Height = 30,
            TextAlign = HorizontalAlignment.Center,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = Color.FromArgb(22, 28, 40),
            ForeColor = Color.White,
        };
        _pass.KeyDown += (_, e) => { if (e.KeyCode == Keys.Enter) { TryUnlock(); e.SuppressKeyPress = true; } };

        var btn = new Button
        {
            Text = "Desbloquear",
            Width = card.Width - 72, Left = 36, Top = 314, Height = 40,
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.FromArgb(59, 130, 246),
            ForeColor = Color.White,
            Font = new Font("Segoe UI", 10.5f, FontStyle.Bold),
            Cursor = Cursors.Hand,
        };
        btn.FlatAppearance.BorderSize = 0;
        btn.Click += (_, _) => TryUnlock();

        _error = new Label
        {
            ForeColor = Color.FromArgb(239, 68, 68),
            Font = new Font("Segoe UI", 9),
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleCenter,
            Left = 36, Top = 364, Width = card.Width - 72, Height = 22,
        };

        var footer = new Label
        {
            Text = "OneDesk  •  Acesso remoto seguro",
            ForeColor = Color.FromArgb(90, 102, 120),
            Font = new Font("Segoe UI", 8),
            AutoSize = false,
            TextAlign = ContentAlignment.MiddleCenter,
            Left = 30, Top = 432, Width = card.Width - 60, Height = 20,
        };

        card.Controls.AddRange(new Control[] { logo, title, text, _pass, btn, _error, footer });
        Controls.Add(card);

        _topmostTimer = new System.Windows.Forms.Timer { Interval = 600 };
        _topmostTimer.Tick += (_, _) =>
        {
            try
            {
                if (!TopMost) TopMost = true;
                Activate();
                BringToFront();
                if (!_pass.Focused) _pass.Focus();
            }
            catch { }
        };
        _topmostTimer.Start();

        Shown += (_, _) => { Activate(); _pass.Focus(); };
    }

    private void TryUnlock()
    {
        if (LockStore.Verify(_pass.Text))
        {
            _onUnlocked();
            ForceClose();
        }
        else
        {
            _error.Text = "Senha incorreta.";
            _pass.Clear();
            _pass.Focus();
        }
    }

    public void ForceClose()
    {
        _allowClose = true;
        try { _topmostTimer.Stop(); } catch { }
        Close();
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        if (!_allowClose && e.CloseReason is CloseReason.UserClosing or CloseReason.TaskManagerClosing)
            e.Cancel = true; // nao deixa fechar com Alt+F4
        else
            base.OnFormClosing(e);
    }
}
