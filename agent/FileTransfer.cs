using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Recebe arquivos do admin em pedacos (chunks) e grava em Downloads\OneDesk.
/// Escreve incrementalmente em arquivo temporario para nao segurar tudo em memoria.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class FileReceiver
{
    private sealed class Session
    {
        public FileStream Stream = null!;
        public string Name = "";
        public string TempPath = "";
    }

    private readonly Dictionary<string, Session> _sessions = new();

    public static string TargetDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), "Downloads", "OneDesk");
    public static string PasteDir =>
        Path.Combine(Path.GetTempPath(), "OneDesk-paste");

    /// <summary>Adiciona um chunk. Retorna o caminho final quando o arquivo termina (last=true).
    /// paste=true grava numa pasta temporaria (para colar via clipboard) em vez de Downloads.</summary>
    public string? AddChunk(string id, string name, string base64, bool last, bool paste = false)
    {
        try
        {
            if (!_sessions.TryGetValue(id, out var s))
            {
                var tmp = Path.Combine(Path.GetTempPath(), $"onedesk-recv-{id}.part");
                s = new Session { Stream = File.Create(tmp), Name = SafeName(name), TempPath = tmp };
                _sessions[id] = s;
            }
            if (!string.IsNullOrEmpty(base64))
            {
                var bytes = Convert.FromBase64String(base64);
                s.Stream.Write(bytes, 0, bytes.Length);
            }
            if (last)
            {
                s.Stream.Flush();
                s.Stream.Dispose();
                var dir = paste ? PasteDir : TargetDir;
                Directory.CreateDirectory(dir);
                var final = UniquePath(dir, s.Name);
                File.Move(s.TempPath, final, true);
                _sessions.Remove(id);
                return final;
            }
        }
        catch
        {
            Cancel(id);
        }
        return null;
    }

    public void Cancel(string id)
    {
        if (_sessions.TryGetValue(id, out var s))
        {
            try { s.Stream.Dispose(); } catch { }
            try { File.Delete(s.TempPath); } catch { }
            _sessions.Remove(id);
        }
    }

    private static string SafeName(string name)
    {
        var n = Path.GetFileName(name);
        foreach (var c in Path.GetInvalidFileNameChars()) n = n.Replace(c, '_');
        return string.IsNullOrWhiteSpace(n) ? "arquivo" : n;
    }

    private static string UniquePath(string dir, string name)
    {
        var path = Path.Combine(dir, name);
        if (!File.Exists(path)) return path;
        var baseName = Path.GetFileNameWithoutExtension(name);
        var ext = Path.GetExtension(name);
        for (int i = 1; i < 1000; i++)
        {
            var candidate = Path.Combine(dir, $"{baseName} ({i}){ext}");
            if (!File.Exists(candidate)) return candidate;
        }
        return Path.Combine(dir, $"{baseName}-{Guid.NewGuid():N}{ext}");
    }
}
