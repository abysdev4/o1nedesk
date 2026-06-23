using System.Management;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>Coleta informacoes tecnicas (uma vez, no registro) via WMI.</summary>
[SupportedOSPlatform("windows")]
public static class SystemInfo
{
    public static Dictionary<string, object?> Collect()
    {
        var d = new Dictionary<string, object?>();
        try
        {
            d["os"] = Wmi("Win32_OperatingSystem", "Caption");
            d["osBuild"] = Wmi("Win32_OperatingSystem", "BuildNumber");
            d["osArch"] = Wmi("Win32_OperatingSystem", "OSArchitecture");
            d["installDate"] = Environment.OSVersion.Version.ToString();
        }
        catch { }

        try
        {
            d["cpu"] = Wmi("Win32_Processor", "Name")?.Trim();
            d["cpuCores"] = Wmi("Win32_Processor", "NumberOfCores");
            d["cpuThreads"] = Wmi("Win32_Processor", "NumberOfLogicalProcessors");
            d["cpuClockMhz"] = Wmi("Win32_Processor", "MaxClockSpeed");
        }
        catch { }

        try
        {
            d["manufacturer"] = Wmi("Win32_ComputerSystem", "Manufacturer")?.Trim();
            d["model"] = Wmi("Win32_ComputerSystem", "Model")?.Trim();
            var totalRam = Wmi("Win32_ComputerSystem", "TotalPhysicalMemory");
            if (totalRam != null && long.TryParse(totalRam, out var ram))
                d["ramTotal"] = ram;
            d["domain"] = Wmi("Win32_ComputerSystem", "Domain")?.Trim();
        }
        catch { }

        try { d["bios"] = Wmi("Win32_BIOS", "SMBIOSBIOSVersion")?.Trim(); } catch { }
        try { d["serial"] = Wmi("Win32_BIOS", "SerialNumber")?.Trim(); } catch { }
        try { d["gpu"] = Wmi("Win32_VideoController", "Name")?.Trim(); } catch { }

        try
        {
            var disks = new List<string>();
            using var s = new ManagementObjectSearcher("SELECT Model, Size FROM Win32_DiskDrive");
            foreach (ManagementObject mo in s.Get())
            {
                var model = mo["Model"]?.ToString()?.Trim();
                var size = mo["Size"]?.ToString();
                if (!string.IsNullOrEmpty(model))
                    disks.Add(size != null && long.TryParse(size, out var sz)
                        ? $"{model} ({sz / 1_000_000_000} GB)"
                        : model);
            }
            if (disks.Count > 0) d["disks"] = disks;
        }
        catch { }

        try
        {
            d["ramModules"] = CountRamModules();
        }
        catch { }

        return d;
    }

    private static string? Wmi(string cls, string prop)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher($"SELECT {prop} FROM {cls}");
            foreach (ManagementObject mo in searcher.Get())
            {
                var v = mo[prop];
                if (v != null) return v.ToString();
            }
        }
        catch { }
        return null;
    }

    private static int CountRamModules()
    {
        int n = 0;
        using var s = new ManagementObjectSearcher("SELECT Capacity FROM Win32_PhysicalMemory");
        foreach (var _ in s.Get()) n++;
        return n;
    }
}
