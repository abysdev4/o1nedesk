using System.Drawing;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Desenha o cursor do mouse sobre o frame capturado. Necessario porque o GDI
/// (CopyFromScreen) NAO captura o cursor — sem isso o operador nao ve o ponteiro.
/// </summary>
[SupportedOSPlatform("windows")]
public static class CursorOverlay
{
    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int X; public int Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct CURSORINFO
    {
        public int cbSize;
        public int flags;
        public IntPtr hCursor;
        public POINT ptScreenPos;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ICONINFO
    {
        public bool fIcon;
        public int xHotspot;
        public int yHotspot;
        public IntPtr hbmMask;
        public IntPtr hbmColor;
    }

    private const int CURSOR_SHOWING = 0x0001;
    private const int DI_NORMAL = 0x0003;

    [DllImport("user32.dll")] private static extern bool GetCursorInfo(ref CURSORINFO pci);
    [DllImport("user32.dll")] private static extern bool GetIconInfo(IntPtr hIcon, out ICONINFO piconinfo);
    [DllImport("user32.dll")] private static extern bool DrawIconEx(IntPtr hdc, int x, int y, IntPtr hIcon, int w, int h, int istep, IntPtr hbrush, int flags);
    [DllImport("gdi32.dll")] private static extern bool DeleteObject(IntPtr o);

    /// <summary>Desenha o cursor em g, dado o canto superior-esquerdo (origem) da area capturada.</summary>
    public static void Draw(Graphics g, int originX, int originY)
    {
        var ci = new CURSORINFO { cbSize = Marshal.SizeOf<CURSORINFO>() };
        if (!GetCursorInfo(ref ci) || ci.flags != CURSOR_SHOWING || ci.hCursor == IntPtr.Zero)
            return;

        int hotX = 0, hotY = 0;
        if (GetIconInfo(ci.hCursor, out var ii))
        {
            hotX = ii.xHotspot;
            hotY = ii.yHotspot;
            if (ii.hbmMask != IntPtr.Zero) DeleteObject(ii.hbmMask);
            if (ii.hbmColor != IntPtr.Zero) DeleteObject(ii.hbmColor);
        }

        IntPtr hdc = g.GetHdc();
        try
        {
            DrawIconEx(hdc, ci.ptScreenPos.X - originX - hotX, ci.ptScreenPos.Y - originY - hotY,
                ci.hCursor, 0, 0, 0, IntPtr.Zero, DI_NORMAL);
        }
        finally
        {
            g.ReleaseHdc(hdc);
        }
    }
}
