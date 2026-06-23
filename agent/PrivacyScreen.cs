using System.Drawing;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Tela de espera mostrada ao USUARIO local durante o suporte ("aguarde").
/// - WDA_EXCLUDEFROMCAPTURE: a captura NAO ve esta janela (o admin enxerga o desktop real).
/// - Click-through (WS_EX_TRANSPARENT): o controle injetado pelo admin passa por baixo.
/// Combinada com o bloqueio de entrada, o usuario local ve so "aguarde" e nao interfere.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class PrivacyScreen : Form
{
    private const int WS_EX_LAYERED = 0x80000;
    private const int WS_EX_TRANSPARENT = 0x20;
    private const int WS_EX_TOOLWINDOW = 0x80;
    private const int WS_EX_NOACTIVATE = 0x08000000;
    private const int WS_EX_TOPMOST = 0x08;
    private const uint LWA_ALPHA = 0x2;
    private const uint WDA_EXCLUDEFROMCAPTURE = 0x11;

    private readonly System.Windows.Forms.Timer _topmost;
    private Image? _logo;

    protected override bool ShowWithoutActivation => true;

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            cp.ExStyle |= WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE | WS_EX_TOPMOST;
            return cp;
        }
    }

    public PrivacyScreen()
    {
        FormBorderStyle = FormBorderStyle.None;
        ShowInTaskbar = false;
        StartPosition = FormStartPosition.Manual;
        Bounds = SystemInformation.VirtualScreen;
        BackColor = Color.FromArgb(8, 11, 18);
        DoubleBuffered = true;
        TopMost = true;

        try
        {
            var asm = Assembly.GetExecutingAssembly();
            var res = Array.Find(asm.GetManifestResourceNames(), n => n.EndsWith("logo-white.png", StringComparison.OrdinalIgnoreCase));
            if (res != null) { using var s = asm.GetManifestResourceStream(res); if (s != null) _logo = Image.FromStream(s); }
        }
        catch { }

        _topmost = new System.Windows.Forms.Timer { Interval = 700 };
        _topmost.Tick += (_, _) =>
        {
            try { if (!TopMost) TopMost = true; BringToFront(); } catch { }
        };
        _topmost.Start();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        try
        {
            SetLayeredWindowAttributes(Handle, 0, 255, LWA_ALPHA); // opaco + click-through
            SetWindowDisplayAffinity(Handle, WDA_EXCLUDEFROMCAPTURE); // invisivel para a captura
        }
        catch { }
    }

    protected override void OnPaint(PaintEventArgs e)
    {
        var g = e.Graphics;
        var b = SystemInformation.VirtualScreen;
        var prim = Screen.PrimaryScreen?.Bounds ?? b;
        int cx = (prim.X - b.X) + prim.Width / 2;
        int cy = (prim.Y - b.Y) + prim.Height / 2;

        if (_logo != null)
        {
            int lw = 260, lh = (int)(lw * (double)_logo.Height / _logo.Width);
            g.DrawImage(_logo, cx - lw / 2, cy - lh - 50, lw, lh);
        }

        using var title = new Font("Segoe UI", 20, FontStyle.Bold);
        using var sub = new Font("Segoe UI", 11);
        using var white = new SolidBrush(Color.White);
        using var gray = new SolidBrush(Color.FromArgb(150, 165, 185));
        var fmt = new StringFormat { Alignment = StringAlignment.Center };
        g.DrawString("Suporte remoto em andamento", title, white, cx, cy + 10, fmt);
        g.DrawString("Aguarde — um tecnico esta atendendo este computador.", sub, gray, cx, cy + 52, fmt);
    }

    public void ForceClose()
    {
        try { _topmost.Stop(); } catch { }
        Close();
    }

    [DllImport("user32.dll")] private static extern bool SetLayeredWindowAttributes(IntPtr hwnd, uint crKey, byte bAlpha, uint dwFlags);
    [DllImport("user32.dll")] private static extern bool SetWindowDisplayAffinity(IntPtr hwnd, uint dwAffinity);
}
