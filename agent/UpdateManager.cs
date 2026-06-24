using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text.Json;

namespace OneDesk.Agent;

/// <summary>
/// Atualizacao iniciada pelo USUARIO no cliente: aviso obrigatorio, download e
/// instalacao via tarefa agendada elevada (sem UAC repetido apos v1.2.0).
/// </summary>
public static class UpdateManager
{
    public const string CurrentVersion = "1.2.2";

    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromMinutes(8) };
    private static bool _updating;

    public static string PendingPath =>
        Path.Combine(Installer.DataDir, "pending-update.exe");
    public static string SnoozePath =>
        Path.Combine(Installer.DataDir, "update-snooze.txt");

    public sealed record UpdateInfo(string LatestVersion, string? Sha256, string? DownloadUrl);

    /// <summary>Consulta manifesto remoto. Retorna null se ja esta atualizado ou erro.</summary>
    public static async Task<UpdateInfo?> FetchLatestAsync(AgentConfig cfg, CancellationToken ct = default)
    {
        try
        {
            var versionUrl = cfg.DiscoveryUrl.Replace("/api/hub/status", "/api/agent/version");
            var json = await _http.GetStringAsync(versionUrl, ct);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            var latest = root.GetProperty("version").GetString() ?? CurrentVersion;
            if (!IsNewer(latest, CurrentVersion)) return null;
            string? sha = root.TryGetProperty("sha256", out var s) && s.ValueKind == JsonValueKind.String ? s.GetString() : null;
            string? downloadUrl = root.TryGetProperty("downloadUrl", out var du) && du.ValueKind == JsonValueKind.String ? du.GetString() : null;
            return new UpdateInfo(latest, sha, downloadUrl);
        }
        catch { return null; }
    }

    public static bool IsSnoozed()
    {
        try
        {
            if (!File.Exists(SnoozePath)) return false;
            var raw = File.ReadAllText(SnoozePath).Trim();
            if (!DateTime.TryParse(raw, null, System.Globalization.DateTimeStyles.RoundtripKind, out var until))
                return false;
            return DateTime.UtcNow < until.ToUniversalTime();
        }
        catch { return false; }
    }

    public static void Snooze(TimeSpan duration)
    {
        try
        {
            Directory.CreateDirectory(Installer.DataDir);
            var until = DateTime.UtcNow.Add(duration);
            File.WriteAllText(SnoozePath, until.ToString("o"));
        }
        catch { }
    }

    public static void ClearSnooze()
    {
        try { if (File.Exists(SnoozePath)) File.Delete(SnoozePath); } catch { }
    }

    /// <summary>Download + instala apos clique do usuario. onStatus reporta fases ao dashboard.</summary>
    public static async Task RunUserUpdateAsync(
        AgentConfig cfg,
        IWin32Window? owner,
        Action<string>? onStatus,
        IProgress<int>? progress = null,
        CancellationToken ct = default)
    {
        if (_updating) { onStatus?.Invoke("busy"); return; }
        _updating = true;

        void Report(string phase)
        {
            LogUpdate(phase);
            onStatus?.Invoke(phase);
        }

        try
        {
            Report("checking");
            var info = await FetchLatestAsync(cfg, ct);
            if (info == null)
            {
                Report("already_latest");
                _updating = false;
                return;
            }

            Report("downloading");
            Directory.CreateDirectory(Installer.DataDir);
            var tmp = PendingPath + ".part";
            try { if (File.Exists(tmp)) File.Delete(tmp); } catch { }

            var downloaded = false;
            // GitHub Releases e a fonte principal (nao depende do tunel local)
            if (!string.IsNullOrWhiteSpace(info.DownloadUrl))
                downloaded = await TryDownload(info.DownloadUrl!, tmp, progress, ct);
            if (!downloaded)
            {
                var hubHttp = await ResolveHubHttp(cfg, ct);
                if (hubHttp != null)
                    downloaded = await TryDownload($"{hubHttp}/download/agent", tmp, progress, ct);
            }

            if (!downloaded)
            {
                Report("failed:download");
                _updating = false;
                return;
            }

            if (!string.IsNullOrEmpty(info.Sha256) && !VerifySha(tmp, info.Sha256))
            {
                try { File.Delete(tmp); } catch { }
                Report("failed:sha_mismatch");
                _updating = false;
                return;
            }

            try
            {
                if (File.Exists(PendingPath)) File.Delete(PendingPath);
                File.Move(tmp, PendingPath);
            }
            catch
            {
                try { File.Copy(tmp, PendingPath, true); File.Delete(tmp); } catch { }
            }

            ClearSnooze();
            ApplyDownloadedUpdate(owner, Report);
        }
        catch (Exception ex)
        {
            Report($"failed:{ex.Message}");
            _updating = false;
        }
    }

    private static void ApplyDownloadedUpdate(IWin32Window? owner, Action<string>? report)
    {
        if (!OperatingSystem.IsWindows()) return;
        report?.Invoke("applying");

        // Tarefa elevada criada na instalacao — aplica update sem novo prompt UAC
        if (Installer.HasUpdateTask() && Installer.TriggerApplyUpdateTask())
        {
            report?.Invoke("restarting");
            Thread.Sleep(1500);
            Environment.Exit(0);
            return;
        }

        // Legado / primeira migracao: pede UAC uma vez, com janela pai para o prompt aparecer
        try
        {
            var hwnd = owner?.Handle ?? IntPtr.Zero;
            var rc = ShellExecute(hwnd, "runas", PendingPath, "--install", null, 1);
            if (rc.ToInt64() > 32)
            {
                report?.Invoke("restarting");
                Thread.Sleep(1500);
                Environment.Exit(0);
                return;
            }
            report?.Invoke("failed:elevation_denied");
            _updating = false;
        }
        catch (Win32Exception ex) when (ex.NativeErrorCode == 1223)
        {
            report?.Invoke("uac_cancelled");
            _updating = false;
        }
        catch (Exception ex)
        {
            report?.Invoke($"failed:{ex.Message}");
            _updating = false;
        }
    }

    private static async Task<bool> TryDownload(
        string url, string dest, IProgress<int>? progress, CancellationToken ct)
    {
        try
        {
            using var resp = await _http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead, ct);
            if (!resp.IsSuccessStatusCode) return false;
            var total = resp.Content.Headers.ContentLength;
            await using var src = await resp.Content.ReadAsStreamAsync(ct);
            await using var fs = File.Create(dest);
            var buf = new byte[81920];
            long read = 0;
            int n;
            while ((n = await src.ReadAsync(buf, ct)) > 0)
            {
                await fs.WriteAsync(buf.AsMemory(0, n), ct);
                read += n;
                if (total > 0) progress?.Report((int)(read * 100 / total.Value));
            }
            progress?.Report(100);
            return true;
        }
        catch { return false; }
    }

    private static void LogUpdate(string msg)
    {
        try
        {
            Directory.CreateDirectory(Installer.DataDir);
            File.AppendAllText(Path.Combine(Installer.DataDir, "update.log"), $"[{DateTime.UtcNow:o}] {msg}\n");
        }
        catch { }
    }

    private static async Task<string?> ResolveHubHttp(AgentConfig cfg, CancellationToken ct)
    {
        string? ws = null;
        try
        {
            var json = await _http.GetStringAsync(cfg.DiscoveryUrl, ct);
            using var doc = JsonDocument.Parse(json);
            if (doc.RootElement.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String)
                ws = u.GetString();
        }
        catch { }
        if (string.IsNullOrWhiteSpace(ws)) ws = cfg.HubWs;
        if (string.IsNullOrWhiteSpace(ws)) return null;
        return ws.Replace("wss://", "https://").Replace("ws://", "http://").TrimEnd('/');
    }

    private static bool VerifySha(string file, string expectedHex)
    {
        try
        {
            using var fs = File.OpenRead(file);
            var hash = SHA256.HashData(fs);
            var hex = Convert.ToHexString(hash).ToLowerInvariant();
            return hex == expectedHex.Trim().ToLowerInvariant();
        }
        catch { return false; }
    }

    public static bool IsNewer(string candidate, string current)
    {
        int[] Parse(string v)
        {
            var core = (v ?? "0").Split('-')[0];
            var parts = core.Split('.');
            var a = new int[3];
            for (int i = 0; i < 3 && i < parts.Length; i++) int.TryParse(parts[i], out a[i]);
            return a;
        }
        var c = Parse(candidate);
        var cur = Parse(current);
        for (int i = 0; i < 3; i++)
        {
            if (c[i] > cur[i]) return true;
            if (c[i] < cur[i]) return false;
        }
        return false;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr ShellExecute(
        IntPtr hwnd, string lpOperation, string lpFile, string lpParameters, string? lpDirectory, int nShowCmd);
}


