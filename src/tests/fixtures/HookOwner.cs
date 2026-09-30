using System;
using System.Diagnostics;

// Run the real hook under an executable named claude.exe, codex.exe or language_server*.exe, with
// another PowerShell between them, to verify ancestry rather than the hook PID.
public static class HookOwner
{
    public static int Main(string[] args)
    {
        var input = Console.In.ReadToEnd();
        using (var owner = Process.GetCurrentProcess())
        {
            Console.WriteLine(owner.Id + ":" +
                new DateTimeOffset(owner.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds());
        }
        var info = new ProcessStartInfo("powershell.exe",
            "-NoProfile -NonInteractive -File \"" + args[0] +
            "\" -Agent " + args[2] + " -DataDir \"" + args[1] + "\"" +
            (args.Length > 3 ? " -HookEvent " + args[3] : ""));
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.RedirectStandardInput = true;
        info.RedirectStandardOutput = true;
        info.RedirectStandardError = true;
        using (var hook = Process.Start(info))
        {
            hook.StandardInput.Write(input);
            hook.StandardInput.Close();
            if (!hook.WaitForExit(2500))
            {
                hook.Kill();
                Console.Error.WriteLine("Hook exceeded the 2.5s regression budget");
                return 1;
            }
            Console.Write(hook.StandardOutput.ReadToEnd());
            Console.Error.Write(hook.StandardError.ReadToEnd());
            return hook.ExitCode;
        }
    }
}
