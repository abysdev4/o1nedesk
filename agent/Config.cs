using System.Text.Json;

namespace OneDesk.Agent;

/// <summary>
/// Configuracao do agente. Le de C:\ProgramData\OneDesk\config.json (escrito pelo instalador)
/// e mantem um agentId persistente por maquina.
/// </summary>
public sealed class AgentConfig
{
    // Endpoint estavel (Vercel) que informa a URL publica atual do hub.
    // Permite trocar o tunel sem reinstalar o agente.
    public string DiscoveryUrl { get; set; } = "https://onedesk-gamma.vercel.app/api/hub/status";
    // Fallback caso a descoberta falhe.
    public string HubWs { get; set; } = "wss://would-emma-societies-behaviour.trycloudflare.com";
    public string EnrollToken { get; set; } = "177d4735c4e5fe67afeb5922752a878e";
    public string AgentId { get; set; } = "";

    private static string Dir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OneDesk");

    private static string ConfigPath => Path.Combine(Dir, "config.json");
    private static string IdPath => Path.Combine(Dir, "agent.id");

    public static AgentConfig LoadFromFile(string path)
    {
        var cfg = new AgentConfig();
        try
        {
            if (File.Exists(path))
            {
                var loaded = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(path));
                if (loaded != null) Merge(cfg, loaded);
            }
        }
        catch { }
        return cfg;
    }

    private static void Merge(AgentConfig target, AgentConfig src)
    {
        if (!string.IsNullOrWhiteSpace(src.DiscoveryUrl)) target.DiscoveryUrl = src.DiscoveryUrl;
        if (!string.IsNullOrWhiteSpace(src.HubWs)) target.HubWs = src.HubWs;
        if (!string.IsNullOrWhiteSpace(src.EnrollToken)) target.EnrollToken = src.EnrollToken;
    }

    public static AgentConfig Load()
    {
        Directory.CreateDirectory(Dir);

        var cfg = new AgentConfig();
        try
        {
            if (File.Exists(ConfigPath))
            {
                var loaded = JsonSerializer.Deserialize<AgentConfig>(File.ReadAllText(ConfigPath));
                if (loaded != null) Merge(cfg, loaded);
            }
        }
        catch { /* usa defaults */ }

        // agentId persistente
        try
        {
            if (File.Exists(IdPath))
            {
                cfg.AgentId = File.ReadAllText(IdPath).Trim();
            }
            if (string.IsNullOrWhiteSpace(cfg.AgentId))
            {
                cfg.AgentId = Guid.NewGuid().ToString("N");
                File.WriteAllText(IdPath, cfg.AgentId);
            }
        }
        catch
        {
            if (string.IsNullOrWhiteSpace(cfg.AgentId))
                cfg.AgentId = Guid.NewGuid().ToString("N");
        }

        return cfg;
    }

    /// <summary>Marca o consentimento do usuario (data da instalacao/primeiro consentimento).</summary>
    public static DateTime GetOrSetConsent()
    {
        var path = Path.Combine(Dir, "consent.txt");
        try
        {
            if (File.Exists(path) && DateTime.TryParse(File.ReadAllText(path).Trim(), out var dt))
                return dt;
            var now = DateTime.UtcNow;
            File.WriteAllText(path, now.ToString("o"));
            return now;
        }
        catch
        {
            return DateTime.UtcNow;
        }
    }
}
