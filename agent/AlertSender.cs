using System.Text;
using System.Text.Json;

namespace OneDesk.Agent;

/// <summary>
/// Envia alertas de seguranca (tamper) ao hub via HTTP POST /alert.
/// Funciona mesmo quando o WebSocket do agente caiu (usado pelo watchdog).
/// Descobre a URL do hub pelo endpoint estavel (Vercel) e cai no HubWs.
/// </summary>
public static class AlertSender
{
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(10) };

    public static async Task Send(AgentConfig cfg, string kind, string message, string severity = "warn")
    {
        var baseUrl = await ResolveHubHttp(cfg);
        if (string.IsNullOrEmpty(baseUrl)) return;
        try
        {
            var payload = JsonSerializer.Serialize(new
            {
                token = cfg.EnrollToken,
                agentId = cfg.AgentId,
                kind,
                message,
                severity,
            });
            using var content = new StringContent(payload, Encoding.UTF8, "application/json");
            await _http.PostAsync($"{baseUrl}/alert", content);
        }
        catch { }
    }

    private static async Task<string?> ResolveHubHttp(AgentConfig cfg)
    {
        string? ws = null;
        if (!string.IsNullOrWhiteSpace(cfg.DiscoveryUrl))
        {
            try
            {
                var json = await _http.GetStringAsync(cfg.DiscoveryUrl);
                using var doc = JsonDocument.Parse(json);
                if (doc.RootElement.TryGetProperty("url", out var u) && u.ValueKind == JsonValueKind.String)
                    ws = u.GetString();
            }
            catch { }
        }
        if (string.IsNullOrWhiteSpace(ws)) ws = cfg.HubWs;
        if (string.IsNullOrWhiteSpace(ws)) return null;
        return ws.Replace("wss://", "https://").Replace("ws://", "http://").TrimEnd('/');
    }
}
