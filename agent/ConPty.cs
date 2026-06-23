using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace OneDesk.Agent;

/// <summary>
/// Wrapper de ConPTY (pseudo-console do Windows) para um shell interativo real
/// (cmd.exe / powershell.exe) com suporte a ANSI, cores e redimensionamento.
/// </summary>
public sealed class ConPty : IDisposable
{
    public FileStream Input { get; private set; } = null!;
    public FileStream Output { get; private set; } = null!;

    private IntPtr _hPC;
    private SafeFileHandle _inputReadSide = null!;
    private SafeFileHandle _outputWriteSide = null!;
    private PROCESS_INFORMATION _pi;
    private IntPtr _attrList;
    private bool _disposed;

    public Process? Started { get; private set; }
    public uint ProcessId => _pi.dwProcessId;

    public static ConPty Start(string shell, short cols, short rows)
    {
        var pty = new ConPty();
        pty.Init(shell, cols, rows);
        return pty;
    }

    private void Init(string shell, short cols, short rows)
    {
        // pipes
        CreatePipe(out _inputReadSide, out var inputWriteSide);
        CreatePipe(out var outputReadSide, out _outputWriteSide);

        Input = new FileStream(inputWriteSide, FileAccess.Write);
        Output = new FileStream(outputReadSide, FileAccess.Read);

        var size = new COORD { X = cols <= 0 ? (short)120 : cols, Y = rows <= 0 ? (short)30 : rows };
        int hr = CreatePseudoConsole(size, _inputReadSide, _outputWriteSide, 0, out _hPC);
        if (hr != 0) throw new InvalidOperationException($"CreatePseudoConsole falhou: 0x{hr:X}");

        var cmd = shell == "powershell"
            ? "powershell.exe -NoLogo"
            : "cmd.exe";

        StartProcess(cmd);
    }

    private void StartProcess(string commandLine)
    {
        var startupInfo = new STARTUPINFOEX();
        startupInfo.StartupInfo.cb = Marshal.SizeOf<STARTUPINFOEX>();

        // tamanho da lista de atributos
        var lpSize = IntPtr.Zero;
        InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref lpSize);
        _attrList = Marshal.AllocHGlobal(lpSize);
        startupInfo.lpAttributeList = _attrList;

        if (!InitializeProcThreadAttributeList(_attrList, 1, 0, ref lpSize))
            throw new InvalidOperationException("InitializeProcThreadAttributeList falhou");

        if (!UpdateProcThreadAttribute(
                _attrList, 0,
                (IntPtr)PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE,
                _hPC, (IntPtr)IntPtr.Size, IntPtr.Zero, IntPtr.Zero))
            throw new InvalidOperationException("UpdateProcThreadAttribute falhou");

        var sa = new SECURITY_ATTRIBUTES();
        sa.nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>();

        bool ok = CreateProcess(
            null, commandLine, ref sa, ref sa, false,
            EXTENDED_STARTUPINFO_PRESENT, IntPtr.Zero, null,
            ref startupInfo, out _pi);

        if (!ok)
            throw new InvalidOperationException($"CreateProcess falhou: {Marshal.GetLastWin32Error()}");

        try { Started = Process.GetProcessById((int)_pi.dwProcessId); } catch { }
    }

    public void Resize(short cols, short rows)
    {
        if (_hPC != IntPtr.Zero && cols > 0 && rows > 0)
            ResizePseudoConsole(_hPC, new COORD { X = cols, Y = rows });
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        try { Input?.Dispose(); } catch { }
        try { Output?.Dispose(); } catch { }
        try { if (_hPC != IntPtr.Zero) ClosePseudoConsole(_hPC); } catch { }
        try
        {
            if (_pi.hProcess != IntPtr.Zero)
            {
                try { Started?.Kill(true); } catch { }
                CloseHandle(_pi.hThread);
                CloseHandle(_pi.hProcess);
            }
        }
        catch { }
        try
        {
            if (_attrList != IntPtr.Zero)
            {
                DeleteProcThreadAttributeList(_attrList);
                Marshal.FreeHGlobal(_attrList);
            }
        }
        catch { }
        try { _inputReadSide?.Dispose(); } catch { }
        try { _outputWriteSide?.Dispose(); } catch { }
    }

    // ===================== P/Invoke =====================
    private const int PROC_THREAD_ATTRIBUTE_PSEUDOCONSOLE = 0x00020016;
    private const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;

    private static void CreatePipe(out SafeFileHandle read, out SafeFileHandle write)
    {
        var sa = new SECURITY_ATTRIBUTES { nLength = Marshal.SizeOf<SECURITY_ATTRIBUTES>(), bInheritHandle = true };
        if (!CreatePipe(out read, out write, ref sa, 0))
            throw new InvalidOperationException("CreatePipe falhou");
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct COORD { public short X; public short Y; }

    [StructLayout(LayoutKind.Sequential)]
    private struct SECURITY_ATTRIBUTES { public int nLength; public IntPtr lpSecurityDescriptor; public bool bInheritHandle; }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFO
    {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX; public int dwY; public int dwXSize; public int dwYSize;
        public int dwXCountChars; public int dwYCountChars; public int dwFillAttribute; public int dwFlags;
        public short wShowWindow; public short cbReserved2; public IntPtr lpReserved2;
        public IntPtr hStdInput; public IntPtr hStdOutput; public IntPtr hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct STARTUPINFOEX { public STARTUPINFO StartupInfo; public IntPtr lpAttributeList; }

    [StructLayout(LayoutKind.Sequential)]
    private struct PROCESS_INFORMATION { public IntPtr hProcess; public IntPtr hThread; public uint dwProcessId; public uint dwThreadId; }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CreatePipe(out SafeFileHandle hReadPipe, out SafeFileHandle hWritePipe, ref SECURITY_ATTRIBUTES lpPipeAttributes, int nSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int CreatePseudoConsole(COORD size, SafeFileHandle hInput, SafeFileHandle hOutput, uint dwFlags, out IntPtr phPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int ResizePseudoConsole(IntPtr hPC, COORD size);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern int ClosePseudoConsole(IntPtr hPC);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool InitializeProcThreadAttributeList(IntPtr lpAttributeList, int dwAttributeCount, int dwFlags, ref IntPtr lpSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool UpdateProcThreadAttribute(IntPtr lpAttributeList, uint dwFlags, IntPtr Attribute, IntPtr lpValue, IntPtr cbSize, IntPtr lpPreviousValue, IntPtr lpReturnSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern void DeleteProcThreadAttributeList(IntPtr lpAttributeList);

    [DllImport("kernel32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool CreateProcess(
        string? lpApplicationName, string lpCommandLine,
        ref SECURITY_ATTRIBUTES lpProcessAttributes, ref SECURITY_ATTRIBUTES lpThreadAttributes,
        bool bInheritHandles, uint dwCreationFlags, IntPtr lpEnvironment, string? lpCurrentDirectory,
        ref STARTUPINFOEX lpStartupInfo, out PROCESS_INFORMATION lpProcessInformation);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);
}
