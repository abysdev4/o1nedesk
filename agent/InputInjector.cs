using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Injeta mouse/teclado via SendInput (mais confiavel que mouse_event/keybd_event).
/// Mouse usa coordenadas absolutas sobre a area virtual, calculadas a partir do
/// monitor ativo (o que esta sendo visto) — corrige posicionamento em multi-monitor.
/// Teclado usa Unicode para texto e teclas virtuais para atalhos/teclas especiais.
/// </summary>
[SupportedOSPlatform("windows")]
public static class InputInjector
{
    // ===================== Mouse =====================
    public static void MouseMoveNormalized(double nx, double ny)
    {
        SendMouse(nx, ny, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK, true);
    }

    public static void MouseButton(string button, bool down)
    {
        uint flag = button == "right"
            ? (down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP)
            : (down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP);
        SendMouse(0, 0, flag, false);
    }

    public static void Click(double nx, double ny, string button)
    {
        MouseMoveNormalized(nx, ny);
        MouseButton(button, true);
        Thread.Sleep(12);
        MouseButton(button, false);
    }

    private static void SendMouse(double nx, double ny, uint flags, bool withMove)
    {
        int absX = 0, absY = 0;
        if (withMove)
        {
            var mon = ScreenCapture.Bounds;        // monitor ativo (sendo visto)
            var virt = ScreenCapture.GetVirtualBounds();
            if (virt.Width <= 0 || virt.Height <= 0) return;
            int screenX = mon.Left + (int)(nx * mon.Width);
            int screenY = mon.Top + (int)(ny * mon.Height);
            // normaliza para 0..65535 sobre a area virtual
            absX = (int)Math.Round((double)(screenX - virt.Left) * 65535.0 / virt.Width);
            absY = (int)Math.Round((double)(screenY - virt.Top) * 65535.0 / virt.Height);
            absX = Math.Clamp(absX, 0, 65535);
            absY = Math.Clamp(absY, 0, 65535);
        }
        var inp = new INPUT
        {
            type = INPUT_MOUSE,
            U = new InputUnion
            {
                mi = new MOUSEINPUT { dx = absX, dy = absY, mouseData = 0, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero },
            },
        };
        SendInput(1, new[] { inp }, Marshal.SizeOf<INPUT>());
    }

    // ===================== Teclado =====================
    /// <summary>Trata uma tecla. combo=true (Ctrl/Alt/Meta pressionado) usa VK p/ atalhos.</summary>
    public static void HandleKey(string key, bool down, bool combo)
    {
        if (string.IsNullOrEmpty(key)) return;

        if (key.Length == 1)
        {
            if (combo)
            {
                ushort vk = VkFromChar(key[0]);
                if (vk != 0) SendKeyVk(vk, down);
            }
            else if (down)
            {
                TypeUnicode(key[0]); // texto normal: injeta o caractere (qualquer layout/acento)
            }
            return;
        }

        ushort special = MapSpecial(key);
        if (special != 0) SendKeyVk(special, down);
    }

    private static void TypeUnicode(char ch)
    {
        var down = MakeKey(0, ch, KEYEVENTF_UNICODE);
        var up = MakeKey(0, ch, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
        SendInput(2, new[] { down, up }, Marshal.SizeOf<INPUT>());
    }

    private static void SendKeyVk(ushort vk, bool down)
    {
        var inp = MakeKey(vk, '\0', down ? 0u : KEYEVENTF_KEYUP);
        SendInput(1, new[] { inp }, Marshal.SizeOf<INPUT>());
    }

    /// <summary>Envia Ctrl+V para a janela em foco (colar o conteudo da area de transferencia).</summary>
    public static void PasteShortcut()
    {
        SendKeyVk(0x11, true);  // Ctrl down
        SendKeyVk(0x56, true);  // V down
        Thread.Sleep(15);
        SendKeyVk(0x56, false); // V up
        SendKeyVk(0x11, false); // Ctrl up
    }

    /// <summary>Solta modificadores e botoes do mouse que possam ter ficado "presos"
    /// (ex.: queda de conexao no meio de um Ctrl). Evita ter que reiniciar o cliente.</summary>
    public static void ReleaseAll()
    {
        try
        {
            ushort[] mods = { 0x11, 0x10, 0x12, 0x5B, 0x5C, 0xA0, 0xA1, 0xA2, 0xA3, 0xA4, 0xA5 };
            foreach (var vk in mods) SendKeyVk(vk, false); // key up
            SendMouse(0, 0, MOUSEEVENTF_LEFTUP, false);
            SendMouse(0, 0, MOUSEEVENTF_RIGHTUP, false);
        }
        catch { }
    }

    private static INPUT MakeKey(ushort vk, char scanChar, uint flags) => new()
    {
        type = INPUT_KEYBOARD,
        U = new InputUnion
        {
            ki = new KEYBDINPUT { wVk = vk, wScan = scanChar, dwFlags = flags, time = 0, dwExtraInfo = IntPtr.Zero },
        },
    };

    private static ushort VkFromChar(char c)
    {
        c = char.ToUpperInvariant(c);
        if ((c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9')) return c;
        return 0;
    }

    private static ushort MapSpecial(string key) => key switch
    {
        "Enter" => 0x0D,
        "Backspace" => 0x08,
        "Tab" => 0x09,
        "Escape" => 0x1B,
        "Spacebar" or " " => 0x20,
        "ArrowLeft" => 0x25,
        "ArrowUp" => 0x26,
        "ArrowRight" => 0x27,
        "ArrowDown" => 0x28,
        "Delete" => 0x2E,
        "Insert" => 0x2D,
        "Home" => 0x24,
        "End" => 0x23,
        "PageUp" => 0x21,
        "PageDown" => 0x22,
        "Control" => 0x11,
        "Shift" => 0x10,
        "Alt" => 0x12,
        "Meta" or "OS" => 0x5B,
        "CapsLock" => 0x14,
        "F1" => 0x70, "F2" => 0x71, "F3" => 0x72, "F4" => 0x73,
        "F5" => 0x74, "F6" => 0x75, "F7" => 0x76, "F8" => 0x77,
        "F9" => 0x78, "F10" => 0x79, "F11" => 0x7A, "F12" => 0x7B,
        _ => 0,
    };

    // ===================== SendInput P/Invoke =====================
    private const uint INPUT_MOUSE = 0, INPUT_KEYBOARD = 1;
    private const uint MOUSEEVENTF_MOVE = 0x0001, MOUSEEVENTF_ABSOLUTE = 0x8000, MOUSEEVENTF_VIRTUALDESK = 0x4000;
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002, MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008, MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint KEYEVENTF_KEYUP = 0x0002, KEYEVENTF_UNICODE = 0x0004;

    [StructLayout(LayoutKind.Sequential)]
    private struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Sequential)]
    private struct KEYBDINPUT { public ushort wVk; public ushort wScan; public uint dwFlags; public uint time; public IntPtr dwExtraInfo; }

    [StructLayout(LayoutKind.Explicit)]
    private struct InputUnion
    {
        [FieldOffset(0)] public MOUSEINPUT mi;
        [FieldOffset(0)] public KEYBDINPUT ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct INPUT { public uint type; public InputUnion U; }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, INPUT[] pInputs, int cbSize);
}
