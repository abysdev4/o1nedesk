using System.Text.Json;
using System.Runtime.Versioning;

namespace OneDesk.Agent;

/// <summary>
/// Localizacao hibrida: tenta a API de localizacao do Windows (GPS/WiFi, precisao de rua)
/// e cai para geolocalizacao por IP (cidade) se a permissao estiver negada/desligada.
/// </summary>
[SupportedOSPlatform("windows")]
public static class Geolocation
{
    private static readonly HttpClient _http = new() { Timeout = TimeSpan.FromSeconds(12) };

    public sealed class Result
    {
        public double lat { get; set; }
        public double lng { get; set; }
        public double? accuracy { get; set; }
        public string source { get; set; } = "ip";
        public string? city { get; set; }
    }

    public static async Task<Result?> ResolveAsync()
    {
        // 1) API de localizacao do Windows (GPS/WiFi)
        try
        {
            var geo = new Windows.Devices.Geolocation.Geolocator
            {
                DesiredAccuracyInMeters = 50,
            };
            var pos = await geo.GetGeopositionAsync();
            var p = pos.Coordinate.Point.Position;
            return new Result
            {
                lat = p.Latitude,
                lng = p.Longitude,
                accuracy = pos.Coordinate.Accuracy,
                source = "windows",
            };
        }
        catch { /* permissao negada/servico off -> IP */ }

        // 2) Fallback por IP
        try
        {
            var json = await _http.GetStringAsync(
                "http://ip-api.com/json/?fields=status,lat,lon,city,regionName,country,query");
            using var doc = JsonDocument.Parse(json);
            var r = doc.RootElement;
            if (r.TryGetProperty("status", out var st) && st.GetString() == "success")
            {
                string? city = null;
                if (r.TryGetProperty("city", out var c) && r.TryGetProperty("regionName", out var rn))
                    city = $"{c.GetString()}, {rn.GetString()}";
                return new Result
                {
                    lat = r.GetProperty("lat").GetDouble(),
                    lng = r.GetProperty("lon").GetDouble(),
                    accuracy = null,
                    source = "ip",
                    city = city,
                };
            }
        }
        catch { }

        return null;
    }
}
