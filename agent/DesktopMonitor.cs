using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Mantem o thread de captura no desktop de input ativo (ex.: volta do UAC/Secure Desktop)
/// e solta teclas presas quando o desktop fica indisponivel.
/// </summary>
[SupportedOSPlatform("windows")]
public static class DesktopMonitor
{
    private const uint DESKTOP_READOBJECTS = 0x0001;
    private const uint DESKTOP_WRITEOBJECTS = 0x0080;
    private const uint DESKTOP_SWITCHDESKTOP = 0x0100;

    private static CancellationTokenSource? _pollCts;
    private static Action? _onReturned;
    private static volatile bool _wasUnavailable;

    public static void Start(Action? onReturned = null)
    {
        Stop();
        _onReturned = onReturned;
        _wasUnavailable = false;
        _pollCts = new CancellationTokenSource();
        var ct = _pollCts.Token;
        _ = Task.Run(async () =>
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    if (!CanOpenInputDesktop())
                    {
                        if (!_wasUnavailable)
                        {
                            _wasUnavailable = true;
                            InputInjector.ReleaseAll();
                        }
                    }
                    else if (_wasUnavailable)
                    {
                        _wasUnavailable = false;
                        InputInjector.ReleaseAll();
                        _onReturned?.Invoke();
                    }
                }
                catch { }
                await Task.Delay(350, ct).ContinueWith(_ => { });
            }
        }, ct);
    }

    public static void Stop()
    {
        try { _pollCts?.Cancel(); } catch { }
        _pollCts = null;
        _onReturned = null;
        _wasUnavailable = false;
    }

    /// <summary>Chamar no thread que captura a tela, antes de CopyFromScreen.</summary>
    public static bool EnsureInputDesktop()
    {
        var input = OpenInputDesktop(0, false, DESKTOP_READOBJECTS | DESKTOP_WRITEOBJECTS | DESKTOP_SWITCHDESKTOP);
        if (input == IntPtr.Zero) return false;
        try
        {
            var current = GetThreadDesktop(GetCurrentThreadId());
            if (input != current)
                return SetThreadDesktop(input);
            return true;
        }
        finally { CloseDesktop(input); }
    }

    private static bool CanOpenInputDesktop()
    {
        var h = OpenInputDesktop(0, false, DESKTOP_READOBJECTS);
        if (h == IntPtr.Zero) return false;
        CloseDesktop(h);
        return true;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr OpenInputDesktop(int dwFlags, bool fInherit, uint dwDesiredAccess);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool CloseDesktop(IntPtr hDesktop);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetThreadDesktop(uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool SetThreadDesktop(IntPtr hDesktop);
    [DllImport("kernel32.dll")]
    private static extern uint GetCurrentThreadId();
}
