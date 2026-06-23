using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

[SupportedOSPlatform("windows")]
public static class ScreenCapture
{
    /// <summary>Monitor ativo para captura e controle remoto (indice >= 0).</summary>
    public static int ActiveMonitor { get; set; }

    public static Rectangle Bounds => GetBounds(ActiveMonitor);

    internal static int GetPrimaryIndex()
    {
        RefreshScreens();
        for (int i = 0; i < _screens.Count; i++)
            if (_screens[i].Info.primary) return i;
        return 0;
    }

    /// <summary>Limites de um monitor especifico (>=0) ou da area virtual inteira (-1).</summary>
    internal static Rectangle GetBounds(int monitor)
    {
        if (monitor < 0) return GetVirtualBounds();
        RefreshScreens();
        if (monitor < _screens.Count) return _screens[monitor].Bounds;
        if (_screens.Count > 0) return _screens[0].Bounds;
        return GetVirtualBounds();
    }

    private static ImageCodecInfo? _jpegCodec;
    internal static ImageCodecInfo JpegCodec =>
        _jpegCodec ??= ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

    /// <summary>Captura unica (thumbnail, screenshot) — JPEG em base64.</summary>
    public static string? CaptureBase64(int maxWidth, long quality, int monitor = -1)
    {
        try
        {
            var b = monitor >= 0 ? GetBounds(monitor) : GetBounds(GetPrimaryIndex());
            using var full = new Bitmap(b.Width, b.Height, PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(full))
            {
                g.CopyFromScreen(b.Left, b.Top, 0, 0, b.Size, CopyPixelOperation.SourceCopy);
                CursorOverlay.Draw(g, b.Left, b.Top);
            }

            double scale = maxWidth > 0 && b.Width > maxWidth ? (double)maxWidth / b.Width : 1.0;
            int w = (int)(b.Width * scale), h = (int)(b.Height * scale);

            using var resized = new Bitmap(w, h);
            using (var g = Graphics.FromImage(resized))
            {
                g.InterpolationMode = InterpolationMode.Bilinear;
                g.DrawImage(full, 0, 0, w, h);
            }

            using var ms = new MemoryStream();
            var ep = new EncoderParameters(1);
            ep.Param[0] = new EncoderParameter(Encoder.Quality, quality);
            resized.Save(ms, JpegCodec, ep);
            return Convert.ToBase64String(ms.ToArray());
        }
        catch { return null; }
    }

    [DllImport("user32.dll")] private static extern int GetSystemMetrics(int nIndex);
    internal static Rectangle GetVirtualBounds()
    {
        int x = GetSystemMetrics(76), y = GetSystemMetrics(77);
        int cx = GetSystemMetrics(78), cy = GetSystemMetrics(79);
        if (cx <= 0 || cy <= 0) { cx = GetSystemMetrics(0); cy = GetSystemMetrics(1); x = 0; y = 0; }
        return new Rectangle(x, y, cx, cy);
    }

    /// <summary>Lista de monitores para o dashboard escolher qual ver.</summary>
    public static List<MonitorInfo> GetMonitors()
    {
        RefreshScreens();
        if (_screens.Count > 0)
            return _screens.Select(s => s.Info).ToList();

        // fallback: monitor principal via GetSystemMetrics
        int w = GetSystemMetrics(0), h = GetSystemMetrics(1);
        if (w <= 0) w = 1920;
        if (h <= 0) h = 1080;
        return
        [
            new MonitorInfo
            {
                index = 0,
                name = $"Monitor 1 (principal) — {w}x{h}",
                width = w,
                height = h,
                primary = true,
            },
        ];
    }

    private sealed class ScreenEntry
    {
        public MonitorInfo Info { get; init; } = null!;
        public Rectangle Bounds { get; init; }
    }

    private static readonly List<ScreenEntry> _screens = new();

    private static void RefreshScreens()
    {
        _screens.Clear();
        int idx = 0;
        EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (hMonitor, _, ref rect, _) =>
        {
            var info = new MONITORINFOEX { cbSize = Marshal.SizeOf<MONITORINFOEX>() };
            if (!GetMonitorInfo(hMonitor, ref info)) return true;
            bool primary = (info.dwFlags & MONITORINFOF_PRIMARY) != 0;
            int w = info.rcMonitor.Right - info.rcMonitor.Left;
            int h = info.rcMonitor.Bottom - info.rcMonitor.Top;
            _screens.Add(new ScreenEntry
            {
                Bounds = Rectangle.FromLTRB(info.rcMonitor.Left, info.rcMonitor.Top, info.rcMonitor.Right, info.rcMonitor.Bottom),
                Info = new MonitorInfo
                {
                    index = idx,
                    name = $"Monitor {idx + 1}{(primary ? " (principal)" : "")} — {w}x{h}",
                    width = w,
                    height = h,
                    primary = primary,
                },
            });
            idx++;
            return true;
        }, IntPtr.Zero);

        // EnumDisplayMonitors nao garante ordem; principal primeiro
        _screens.Sort((a, b) =>
        {
            if (a.Info.primary == b.Info.primary) return a.Info.index.CompareTo(b.Info.index);
            return a.Info.primary ? -1 : 1;
        });
        for (int i = 0; i < _screens.Count; i++)
        {
            var e = _screens[i];
            e.Info.index = i;
            var n = e.Info.name;
            var dash = n.IndexOf('—');
            if (dash > 0)
                e.Info.name = $"Monitor {i + 1}{(e.Info.primary ? " (principal)" : "")} {n[dash..]}";
        }
    }

    private const uint MONITORINFOF_PRIMARY = 1;

    private delegate bool MonitorEnumDelegate(IntPtr hMonitor, IntPtr hdcMonitor, ref RECT lprcMonitor, IntPtr dwData);

    [StructLayout(LayoutKind.Sequential)]
    private struct RECT
    {
        public int Left, Top, Right, Bottom;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    private struct MONITORINFOEX
    {
        public int cbSize;
        public RECT rcMonitor;
        public RECT rcWork;
        public uint dwFlags;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)]
        public string szDevice;
    }

    [DllImport("user32.dll")]
    private static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr lprcClip, MonitorEnumDelegate lpfnEnum, IntPtr dwData);

    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    private static extern bool GetMonitorInfo(IntPtr hMonitor, ref MONITORINFOEX lpmi);
}

public sealed class MonitorInfo
{
    public int index { get; set; }
    public string name { get; set; } = "";
    public int width { get; set; }
    public int height { get; set; }
    public bool primary { get; set; }
}

/// <summary>
/// Streaming otimizado: reaproveita bitmaps, Graphics, MemoryStream e EncoderParameters
/// entre frames para maximizar o FPS e reduzir GC.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class ScreenStreamer : IDisposable
{
    private Bitmap? _full;
    private Bitmap? _scaled;
    private Graphics? _gFull;
    private Graphics? _gScaled;
    private readonly MemoryStream _ms = new(256 * 1024);
    private readonly EncoderParameters _ep = new(1);
    private Rectangle _bounds;
    private int _maxWidth;
    private int _monitor;

    public ScreenStreamer(int maxWidth, long quality, int monitor = -1)
    {
        _maxWidth = maxWidth;
        _monitor = monitor >= 0 ? monitor : ScreenCapture.GetPrimaryIndex();
        _ep.Param[0] = new EncoderParameter(Encoder.Quality, quality);
    }

    public void SetQuality(long q) => _ep.Param[0] = new EncoderParameter(Encoder.Quality, q);
    public void SetMaxWidth(int w) { _maxWidth = w; Rebuild(); }
    public void SetMonitor(int monitor)
    {
        if (monitor < 0) monitor = ScreenCapture.GetPrimaryIndex();
        if (_monitor == monitor) return;
        _monitor = monitor;
        _bounds = default;
        Rebuild();
    }

    private void EnsureBuffers()
    {
        var b = ScreenCapture.GetBounds(_monitor);
        if (_full != null && b == _bounds) return;
        _bounds = b;
        Rebuild();
    }

    private void Rebuild()
    {
        _gFull?.Dispose(); _full?.Dispose();
        _gScaled?.Dispose(); _scaled?.Dispose();

        _full = new Bitmap(_bounds.Width, _bounds.Height, PixelFormat.Format24bppRgb);
        _gFull = Graphics.FromImage(_full);

        double scale = _maxWidth > 0 && _bounds.Width > _maxWidth ? (double)_maxWidth / _bounds.Width : 1.0;
        int w = Math.Max(1, (int)(_bounds.Width * scale));
        int h = Math.Max(1, (int)(_bounds.Height * scale));
        _scaled = new Bitmap(w, h, PixelFormat.Format24bppRgb);
        _gScaled = Graphics.FromImage(_scaled);
        _gScaled.InterpolationMode = InterpolationMode.Bilinear;
        _gScaled.CompositingQuality = CompositingQuality.HighSpeed;
        _gScaled.SmoothingMode = SmoothingMode.None;
        _gScaled.PixelOffsetMode = PixelOffsetMode.Half;
    }

    /// <summary>Captura, escala e codifica um frame. Devolve base64 JPEG.</summary>
    public string? Frame()
    {
        try
        {
            EnsureBuffers();
            _gFull!.CopyFromScreen(_bounds.Left, _bounds.Top, 0, 0, _bounds.Size, CopyPixelOperation.SourceCopy);
            CursorOverlay.Draw(_gFull, _bounds.Left, _bounds.Top);
            _gScaled!.DrawImage(_full!, 0, 0, _scaled!.Width, _scaled.Height);

            _ms.SetLength(0);
            _scaled.Save(_ms, ScreenCapture.JpegCodec, _ep);
            return Convert.ToBase64String(_ms.GetBuffer(), 0, (int)_ms.Length);
        }
        catch { return null; }
    }

    public void Dispose()
    {
        _gFull?.Dispose(); _full?.Dispose();
        _gScaled?.Dispose(); _scaled?.Dispose();
        _ms.Dispose();
    }
}
