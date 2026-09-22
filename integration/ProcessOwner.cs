using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Threading.Tasks;

namespace AgentStatus
{
    // Compiled once by the installer. Hook processes only load the assembly.
    public static class ProcessOwner
    {
        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct ProcessEntry
        {
            public uint Size, Usage, Id;
            public UIntPtr DefaultHeap;
            public uint Module, Threads, ParentId;
            public int BasePriority;
            public uint Flags;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string Name;
        }

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint processId);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern bool Process32FirstW(IntPtr snapshot, ref ProcessEntry entry);
        [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
        private static extern bool Process32NextW(IntPtr snapshot, ref ProcessEntry entry);
        [DllImport("kernel32.dll")]
        private static extern bool CloseHandle(IntPtr handle);

        public static long[] Find(string agent, int hookPid)
        {
            try
            {
                var elapsed = Stopwatch.StartNew();
                var processes = new Dictionary<uint, ProcessEntry>();
                var snapshot = CreateToolhelp32Snapshot(2, 0); // TH32CS_SNAPPROCESS
                if (snapshot == new IntPtr(-1)) return null;
                try
                {
                    var entry = new ProcessEntry();
                    entry.Size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
                    if (!Process32FirstW(snapshot, ref entry)) return null;
                    do { processes[entry.Id] = entry; }
                    while (Process32NextW(snapshot, ref entry));
                }
                finally { CloseHandle(snapshot); }

                uint id = (uint)hookPid;
                DateTime childStarted = DateTime.MaxValue;
                var visited = new HashSet<uint>();
                for (int depth = 0; depth < 8 && id != 0 && visited.Add(id); depth++)
                {
                    ProcessEntry entry;
                    if (!processes.TryGetValue(id, out entry)) return null;
                    DateTime started;
                    using (var process = Process.GetProcessById((int)id))
                    {
                        started = process.StartTime.ToUniversalTime();
                        // A parent PID may have been reused after the real parent exited.
                        if (process.HasExited || started > childStarted) return null;
                        if (!String.Equals(process.ProcessName + ".exe", entry.Name,
                            StringComparison.OrdinalIgnoreCase)) return null;
                    }
                    bool matches = String.Equals(entry.Name, agent + ".exe",
                        StringComparison.OrdinalIgnoreCase);
                    if (!matches && agent == "claude" && String.Equals(entry.Name,
                        "node.exe", StringComparison.OrdinalIgnoreCase))
                    {
                        matches = IsLegacyClaude(id, started,
                            Math.Max(0, 500 - (int)elapsed.ElapsedMilliseconds));
                    }
                    if (matches)
                        return new long[] { id, new DateTimeOffset(started).ToUnixTimeMilliseconds() };
                    childStarted = started;
                    id = entry.ParentId;
                }
            }
            catch { /* Owner metadata is optional; never block event recording. */ }
            return null;
        }

        private static bool IsLegacyClaude(uint id, DateTime started, int budgetMs)
        {
            if (budgetMs == 0) return false;
            // Native Claude/Codex never need WMI. Keep npm Claude support, but bound
            // the entire query (including connecting to WMI) when that service stalls.
            var query = Task.Run(() =>
            {
                try
                {
                    using (var search = new ManagementObjectSearcher(
                        "SELECT CommandLine FROM Win32_Process WHERE ProcessId = " + id))
                    using (var results = search.Get())
                    {
                        foreach (ManagementObject result in results)
                        using (result)
                        {
                            var command = result["CommandLine"] as string;
                            if (command == null || command.IndexOf("claude-code",
                                StringComparison.OrdinalIgnoreCase) < 0) return false;
                            using (var process = Process.GetProcessById((int)id))
                                return !process.HasExited && process.StartTime.ToUniversalTime() == started;
                        }
                    }
                }
                catch { }
                return false;
            });
            return query.Wait(budgetMs) && query.Result;
        }
    }
}
