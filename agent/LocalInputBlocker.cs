using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Bloqueia o mouse/teclado FISICO do cliente durante o suporte, deixando passar
/// apenas o input INJETADO pelo agente (controle do admin). Usa hooks de baixo nivel
/// (WH_KEYBOARD_LL / WH_MOUSE_LL) e descarta eventos que nao sejam injetados.
/// Deve ser instalado/removido na thread de UI (que tem o message loop).
/// </summary>
[SupportedOSPlatform("windows")]
public static class LocalInputBlocker
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WH_MOUSE_LL = 14;
    private const uint LLKHF_INJECTED = 0x10;
    private const uint LLMHF_INJECTED = 0x01;

    private delegate IntPtr HookProc(int nCode, IntPtr wParam, IntPtr lParam);

    private static IntPtr _kbHook = IntPtr.Zero;
    private static IntPtr _msHook = IntPtr.Zero;
    private static HookProc? _kbProc;   // manter referencia (evita GC)
    private static HookProc? _msProc;

    public static bool Active => _kbHook != IntPtr.Zero || _msHook != IntPtr.Zero;

    public static void Enable()
    {
        if (Active) return;
        _kbProc = KbCallback;
        _msProc = MsCallback;
        var hMod = GetModuleHandle(null);
        _kbHook = SetWindowsHookEx(WH_KEYBOARD_LL, _kbProc, hMod, 0);
        _msHook = SetWindowsHookEx(WH_MOUSE_LL, _msProc, hMod, 0);
    }

    public static void Disable()
    {
        if (_kbHook != IntPtr.Zero) { UnhookWindowsHookEx(_kbHook); _kbHook = IntPtr.Zero; }
        if (_msHook != IntPtr.Zero) { UnhookWindowsHookEx(_msHook); _msHook = IntPtr.Zero; }
        _kbProc = null;
        _msProc = null;
    }

    private static IntPtr KbCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var info = Marshal.PtrToStructure<KBDLLHOOKSTRUCT>(lParam);
            if ((info.flags & LLKHF_INJECTED) == 0)
                return (IntPtr)1; // input fisico -> bloqueia
        }
        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    private static IntPtr MsCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0)
        {
            var info = Marshal.PtrToStructure<MSLLHOOKSTRUCT>(lParam);
            if ((info.flags & LLMHF_INJECTED) == 0)
                return (IntPtr)1; // input fisico -> bloqueia
        }
        return CallNextHookEx(IntPtr.Zero, nCode, wParam, lParam);
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT { public uint vkCode; public uint scanCode; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct POINT { public int x; public int y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSLLHOOKSTRUCT { public POINT pt; public uint mouseData; public uint flags; public uint time; public IntPtr dwExtraInfo; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, HookProc lpfn, IntPtr hMod, uint dwThreadId);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);
    [DllImport("user32.dll")]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr GetModuleHandle(string? lpModuleName);
}
