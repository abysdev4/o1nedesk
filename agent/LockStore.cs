using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace OneDesk.Agent;

/// <summary>
/// Guarda (localmente, offline) o estado de bloqueio e o hash PBKDF2 da senha de
/// desbloqueio definida pelo admin. Permite bloqueio anti-furto que persiste reinicios.
/// </summary>
public static class LockStore
{
    private static string Dir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OneDesk");
    private static string Path_ => System.IO.Path.Combine(Dir, "lock.json");

    private sealed class State
    {
        public bool locked { get; set; }
        public string? salt { get; set; }
        public string? hash { get; set; }
    }

    private static State Load()
    {
        try
        {
            if (File.Exists(Path_))
                return JsonSerializer.Deserialize<State>(File.ReadAllText(Path_)) ?? new State();
        }
        catch { }
        return new State();
    }

    private static void Save(State s)
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(Path_, JsonSerializer.Serialize(s));
        }
        catch { }
    }

    public static bool IsLocked => Load().locked;
    public static bool HasPassword => !string.IsNullOrEmpty(Load().hash);

    public static void SetLocked(bool v)
    {
        var s = Load();
        s.locked = v;
        Save(s);
    }

    public static void SetPassword(string raw)
    {
        if (string.IsNullOrEmpty(raw)) return;
        var salt = RandomNumberGenerator.GetBytes(16);
        var hash = Pbkdf2(raw, salt);
        var s = Load();
        s.salt = Convert.ToBase64String(salt);
        s.hash = Convert.ToBase64String(hash);
        Save(s);
    }

    public static bool Verify(string raw)
    {
        var s = Load();
        if (string.IsNullOrEmpty(s.salt) || string.IsNullOrEmpty(s.hash)) return false;
        try
        {
            var salt = Convert.FromBase64String(s.salt);
            var expected = Convert.FromBase64String(s.hash);
            var actual = Pbkdf2(raw, salt);
            return CryptographicOperations.FixedTimeEquals(expected, actual);
        }
        catch { return false; }
    }

    private static byte[] Pbkdf2(string raw, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(raw), salt, 100_000, HashAlgorithmName.SHA256, 32);
}
