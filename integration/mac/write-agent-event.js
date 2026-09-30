// Agent Status hook writer for macOS. Run by: /usr/bin/osascript -l JavaScript <this> <agent> <dataDir>
// Monitoring must never block the agent: every error is swallowed, nothing is printed, exit 0.
ObjC.import('Foundation');

const FIELDS = ['tool_name', 'tool_use_id', 'notification_type', 'source'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Same rules as parseLstart in src/monitor/process-owner.ts; both sides must agree exactly.
function parseLstart(text) {
  const match = /^\w{3} (\w{3}) +(\d{1,2}) (\d\d):(\d\d):(\d\d) (\d{4})$/.exec(text.trim());
  const month = match ? MONTHS.indexOf(match[1]) : -1;
  if (!match || month < 0) return 0;
  return new Date(+match[6], month, +match[2], +match[3], +match[4], +match[5]).getTime();
}

function utf8(data) {
  return $.NSString.alloc.initWithDataEncoding(data, $.NSUTF8StringEncoding).js;
}

function processTable() {
  const task = $.NSTask.alloc.init;
  task.executableURL = $.NSURL.fileURLWithPath('/bin/ps');
  task.arguments = $(['-A', '-o', 'pid=,ppid=,lstart=,args=']);
  const env = $.NSMutableDictionary.dictionaryWithDictionary(
    $.NSProcessInfo.processInfo.environment,
  );
  env.setObjectForKey('C', 'LC_ALL');
  task.environment = env;
  const pipe = $.NSPipe.pipe;
  task.standardOutput = pipe;
  task.standardError = $.NSFileHandle.fileHandleWithNullDevice;
  if (!task.launchAndReturnError($())) return new Map();
  const text = utf8(pipe.fileHandleForReading.readDataToEndOfFile);
  task.waitUntilExit;
  const table = new Map();
  for (const line of text.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s+(\w{3} \w{3} +\d{1,2} \d\d:\d\d:\d\d \d{4})\s+(.*)$/.exec(
      line,
    );
    if (match)
      table.set(+match[1], { ppid: +match[2], started: parseLstart(match[3]), args: match[4] });
  }
  return table;
}

function matches(agent, args) {
  const name = args.split(' ')[0].split('/').pop();
  if (name === agent) return true;
  // npm Claude runs under node; the native installer runs a versioned file via a symlink.
  return agent === 'claude' && (args.includes('claude-code') || args.includes('/claude/versions/'));
}

function findOwner(agent) {
  const table = processTable();
  let id = $.NSProcessInfo.processInfo.processIdentifier;
  let childStarted = Infinity;
  const visited = new Set();
  for (let depth = 0; depth < 8 && id > 1 && !visited.has(id); depth++) {
    visited.add(id);
    const entry = table.get(id);
    // A parent PID may have been reused after the real parent exited.
    if (!entry || !entry.started || entry.started > childStarted) return undefined;
    if (matches(agent, entry.args)) return { pid: id, started: entry.started };
    childStarted = entry.started;
    id = entry.ppid;
  }
  return undefined;
}

// eslint-disable-next-line no-unused-vars -- osascript calls run(argv).
function run(argv) {
  try {
    const agent = argv[0];
    const dataDir = argv[1];
    if ((agent !== 'claude' && agent !== 'codex') || !dataDir) return;
    const input = JSON.parse(utf8($.NSFileHandle.fileHandleWithStandardInput.readDataToEndOfFile));
    if (!input || !input.session_id || !input.hook_event_name) return;
    const record = {
      agent,
      session_id: String(input.session_id),
      hook_event_name: String(input.hook_event_name),
      timestamp: Date.now(),
    };
    for (const field of FIELDS)
      if (input[field] !== undefined && input[field] !== null) record[field] = String(input[field]);
    try {
      const owner = findOwner(agent);
      if (owner) {
        record.owner_pid = owner.pid;
        record.owner_started_at = owner.started;
      }
    } catch {
      // Fresh events still work when process inspection is unavailable.
    }
    const files = $.NSFileManager.defaultManager;
    const dir = dataDir + '/events/' + agent;
    files.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, $(), $());
    const name = $.NSUUID.UUID.UUIDString.js.toLowerCase();
    const temporary = dir + '/' + name + '.tmp';
    $(JSON.stringify(record)).writeToFileAtomicallyEncodingError(
      temporary,
      false,
      $.NSUTF8StringEncoding,
      $(),
    );
    files.moveItemAtPathToPathError(temporary, dir + '/' + name + '.json', $());
  } catch {
    // Monitoring không được chặn agent hoặc thay đổi approval decision.
  }
}
