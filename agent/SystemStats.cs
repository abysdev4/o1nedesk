using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Runtime.InteropServices;

namespace OneDesk.Agent;

public sealed class StatsSnapshot
{
    public double cpu { get; set; }
    public long memUsed { get; set; }
    public long memTotal { get; set; }
    public long diskUsed { get; set; }
    public long diskTotal { get; set; }
    public long netUp { get; set; }
    public long netDown { get; set; }
    public int procCount { get; set; }
    public long uptime { get; set; }
    public string username { get; set; } = "";
}

public sealed class SystemStats
{
    // ---- CPU via GetSystemTimes ----
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetSystemTimes(out FILETIME idle, out FILETIME kernel, out FILETIME user);

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME { public uint Low; public uint High; }
    private static ulong ToUlong(FILETIME f) => ((ulong)f.High << 32) | f.Low;

    private ulong _prevIdle, _prevKernel, _prevUser;
    private long _prevNetUp, _prevNetDown;
    private DateTime _prevNetTime = DateTime.UtcNow;

    // ---- Memoria ----
    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    public SystemStats()
    {
        // primeira leitura para inicializar os deltas
        if (GetSystemTimes(out var i, out var k, out var u))
        {
            _prevIdle = ToUlong(i);
            _prevKernel = ToUlong(k);
            _prevUser = ToUlong(u);
        }
        ReadNetTotals(out _prevNetUp, out _prevNetDown);
    }

    private double ReadCpu()
    {
        if (!GetSystemTimes(out var i, out var k, out var u)) return 0;
        ulong idle = ToUlong(i), kernel = ToUlong(k), user = ToUlong(u);
        ulong dIdle = idle - _prevIdle;
        ulong dKernel = kernel - _prevKernel;
        ulong dUser = user - _prevUser;
        _prevIdle = idle; _prevKernel = kernel; _prevUser = user;
        ulong total = dKernel + dUser; // kernel ja inclui idle
        if (total == 0) return 0;
        double busy = (double)(total - dIdle) / total;
        return Math.Clamp(busy * 100.0, 0, 100);
    }

    private static void ReadNetTotals(out long up, out long down)
    {
        up = 0; down = 0;
        try
        {
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up) continue;
                if (ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                var s = ni.GetIPv4Statistics();
                up += s.BytesSent;
                down += s.BytesReceived;
            }
        }
        catch { }
    }

    public StatsSnapshot Capture()
    {
        var snap = new StatsSnapshot();
        snap.cpu = Math.Round(ReadCpu(), 1);

        var mem = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };
        if (GlobalMemoryStatusEx(ref mem))
        {
            snap.memTotal = (long)mem.ullTotalPhys;
            snap.memUsed = (long)(mem.ullTotalPhys - mem.ullAvailPhys);
        }

        try
        {
            var sysDrive = Path.GetPathRoot(Environment.SystemDirectory) ?? "C:\\";
            var d = new DriveInfo(sysDrive);
            if (d.IsReady)
            {
                snap.diskTotal = d.TotalSize;
                snap.diskUsed = d.TotalSize - d.TotalFreeSpace;
            }
        }
        catch { }

        ReadNetTotals(out long up, out long down);
        var now = DateTime.UtcNow;
        var secs = Math.Max(0.001, (now - _prevNetTime).TotalSeconds);
        snap.netUp = (long)Math.Max(0, (up - _prevNetUp) / secs);
        snap.netDown = (long)Math.Max(0, (down - _prevNetDown) / secs);
        _prevNetUp = up; _prevNetDown = down; _prevNetTime = now;

        try { snap.procCount = Process.GetProcesses().Length; } catch { }
        snap.uptime = Environment.TickCount64 / 1000;
        try { snap.username = Environment.UserName; } catch { }

        return snap;
    }
}
