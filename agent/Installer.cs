using System.Diagnostics;
using System.Runtime.Versioning;
using System.Security.Principal;
using System.Text.Json;
using Microsoft.Win32;

namespace OneDesk.Agent;

/// <summary>
/// Auto-instalacao: o proprio executavel se copia para Program Files, grava config,
/// configura auto-start com o Windows (chave Run + Tarefa Agendada) e inicia.
/// </summary>
[SupportedOSPlatform("windows")]
public static class Installer
{
    public static string InstallDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "OneDesk");
    public static string InstalledExe => Path.Combine(InstallDir, "OneDeskAgent.exe");
    public static string DataDir =>
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "OneDesk");

    private const string RunKey = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
    private const string TaskName = "OneDeskAgent";
    public const string UpdateTaskName = "OneDeskAgentApplyUpdate";

    public static bool IsInstalledHere()
    {
        try
        {
            return string.Equals(
                Path.GetFullPath(Environment.ProcessPath ?? ""),
                Path.GetFullPath(InstalledExe),
                StringComparison.OrdinalIgnoreCase);
        }
        catch { return false; }
    }

    public static bool IsElevated()
    {
        try
        {
            using var id = WindowsIdentity.GetCurrent();
            return new WindowsPrincipal(id).IsInRole(WindowsBuiltInRole.Administrator);
        }
        catch { return false; }
    }

    /// <summary>Relanca o proprio exe pedindo elevacao (UAC) para instalar.</summary>
    public static void RelaunchElevatedToInstall() => RelaunchElevated("--install");

    public static void RelaunchElevated(string arguments)
    {
        var psi = new ProcessStartInfo
        {
            FileName = Environment.ProcessPath,
            Arguments = arguments,
            UseShellExecute = true,
            Verb = "runas",
        };
        try { Process.Start(psi); } catch { /* usuario cancelou o UAC */ }
    }

    /// <summary>Executa a instalacao (precisa estar elevado).</summary>
    public static void Install() => InstallFrom(Environment.ProcessPath!);

    /// <summary>Instala a partir de um exe (update pendente ou auto-instalacao).</summary>
    public static void InstallFrom(string sourceExe)
    {
        Directory.CreateDirectory(InstallDir);
        Directory.CreateDirectory(DataDir);

        // 1) Substitui o exe em Program Files SEM duplicidade e sem deixar a versao antiga subir.
        if (!string.Equals(Path.GetFullPath(sourceExe), Path.GetFullPath(InstalledExe), StringComparison.OrdinalIgnoreCase))
        {
            // Trava o watchdog ANTES de matar: o stop.flag impede que ele relance o
            // agente antigo durante a troca (a sentinela e removida no passo 6).
            try { File.WriteAllText(Path.Combine(DataDir, "stop.flag"), DateTime.UtcNow.ToString("o")); } catch { }

            // Encerra agente + watchdog (mesma imagem) ate nao sobrar nenhum.
            KillOtherAgents();

            // Copia o binario novo por cima, tolerando lock temporario.
            ReplaceInstalledExe(sourceExe);
        }

        // 2) Grava config preservando valores existentes (nao sobrescreve URL/token no update)
        var cfgPath = Path.Combine(DataDir, "config.json");
        var cfg = AgentConfig.LoadFromFile(cfgPath);
        File.WriteAllText(cfgPath, JsonSerializer.Serialize(cfg, new JsonSerializerOptions { WriteIndented = true }));

        // 3) Auto-start: chave Run (HKLM)
        try
        {
            using var key = Registry.LocalMachine.CreateSubKey(RunKey);
            key?.SetValue("OneDeskAgent", $"\"{InstalledExe}\"");
        }
        catch { }

        // 4) Auto-start: Tarefa Agendada no logon (robustez)
        try
        {
            Run("schtasks", $"/Delete /TN {TaskName} /F", true);
            Run("schtasks", $"/Create /TN {TaskName} /TR \"\\\"{InstalledExe}\\\"\" /SC ONLOGON /RL LIMITED /F", true);
        }
        catch { }

        // 5) Tarefa elevada para updates futuros (sem UAC a cada versao)
        RegisterUpdateTask();

        // 6) Garante que nao ha sentinela de parada antiga
        try { File.Delete(Path.Combine(DataDir, "stop.flag")); } catch { }
        try { if (File.Exists(UpdateManager.PendingPath)) File.Delete(UpdateManager.PendingPath); } catch { }

        // 7) Inicia agora na sessao do usuario (o agente sobe o watchdog sozinho)
        StartInstalled();
    }

    /// <summary>Tarefa ONCE/HIGHEST — disparada pelo agente apos download do update.</summary>
    public static void RegisterUpdateTask()
    {
        if (!IsElevated()) return;
        try
        {
            Run("schtasks", $"/Delete /TN {UpdateTaskName} /F", true);
            var tr = $"\\\"{InstalledExe}\\\" --install-pending";
            Run("schtasks",
                $"/Create /TN {UpdateTaskName} /TR {tr} /SC ONCE /SD 01/01/2020 /ST 00:00 /RL HIGHEST /F",
                true);
        }
        catch { }
    }

    public static bool HasUpdateTask() =>
        Run("schtasks", $"/Query /TN {UpdateTaskName}", true);

    public static bool TriggerApplyUpdateTask() =>
        Run("schtasks", $"/Run /TN {UpdateTaskName}", false);

    /// <summary>Instala update baixado (executado elevado pela tarefa agendada).</summary>
    public static void InstallPendingUpdate()
    {
        if (!File.Exists(UpdateManager.PendingPath)) return;
        InstallFrom(UpdateManager.PendingPath);
    }

    private static void StartInstalled()
    {
        // Tenta iniciar via tarefa agendada (sessao do usuario). Fallback: start direto.
        if (Run("schtasks", $"/Run /TN {TaskName}", true)) return;
        try
        {
            Process.Start(new ProcessStartInfo { FileName = InstalledExe, UseShellExecute = true });
        }
        catch { }
    }

    public static void Uninstall()
    {
        // Sentinela primeiro: faz o watchdog parar de reiniciar o agente
        try
        {
            Directory.CreateDirectory(DataDir);
            File.WriteAllText(Path.Combine(DataDir, "stop.flag"), DateTime.UtcNow.ToString("o"));
        }
        catch { }
        Thread.Sleep(800);
        // Mata agente + watchdog (mesma imagem)
        try { Run("taskkill", "/IM OneDeskAgent.exe /F", true); } catch { }
        try { Run("schtasks", $"/Delete /TN {TaskName} /F", true); } catch { }
        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(RunKey, true);
            key?.DeleteValue("OneDeskAgent", false);
        }
        catch { }
        try { if (Directory.Exists(InstallDir)) Directory.Delete(InstallDir, true); } catch { }
        try { if (Directory.Exists(DataDir)) Directory.Delete(DataDir, true); } catch { }
    }

    /// <summary>Encerra todas as instancias do agente/watchdog (exceto este instalador),
    /// repetindo ate nenhuma sobrar — cobre a corrida em que o watchdog relanca o antigo.</summary>
    private static void KillOtherAgents()
    {
        for (int attempt = 0; attempt < 12; attempt++)
        {
            var others = Process.GetProcessesByName("OneDeskAgent")
                .Where(p => p.Id != Environment.ProcessId)
                .ToArray();
            if (others.Length == 0) return;

            foreach (var p in others)
                try { p.Kill(true); } catch { }
            foreach (var p in others)
            {
                try { p.WaitForExit(1500); } catch { }
                try { p.Dispose(); } catch { }
            }
            Thread.Sleep(250);
        }
    }

    /// <summary>Copia o exe novo por cima do instalado, com retentativa. Se o destino
    /// estiver travado, renomeia o antigo (.old) e copia o novo no lugar.</summary>
    private static void ReplaceInstalledExe(string sourceExe)
    {
        for (int i = 0; i < 12; i++)
        {
            try
            {
                File.Copy(sourceExe, InstalledExe, true);
                return;
            }
            catch
            {
                try
                {
                    if (File.Exists(InstalledExe))
                    {
                        var bak = InstalledExe + ".old";
                        try { File.Delete(bak); } catch { }
                        File.Move(InstalledExe, bak);          // Windows permite mover exe travado
                        File.Copy(sourceExe, InstalledExe, true);
                        try { File.Delete(bak); } catch { }
                        return;
                    }
                }
                catch { }
                Thread.Sleep(400);
            }
        }
    }

    private static bool Run(string file, string args, bool wait)
    {
        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = file,
                Arguments = args,
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            var p = Process.Start(psi);
            if (wait) { p?.WaitForExit(8000); return p?.ExitCode == 0; }
            return true;
        }
        catch { return false; }
    }
}
