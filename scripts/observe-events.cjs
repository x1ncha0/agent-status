// Observer kiểm thử chỉ đọc tên event, không xóa file hoặc lưu prompt.
const fs = require('node:fs');
const path = require('node:path');
const root =
  process.env.AGENT_STATUS_DATA_DIR || path.join(process.env.LOCALAPPDATA, 'AgentStatus');
const seen = new Set();
const events = [];
const watchers = [];
for (const agent of ['claude', 'codex']) {
  const directory = path.join(root, 'events', agent);
  fs.mkdirSync(directory, { recursive: true });
  watchers.push(
    fs.watch(directory, (_kind, name) => {
      if (!name || !name.endsWith('.json') || seen.has(name)) return;
      try {
        const event = JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
        seen.add(name);
        const record = { agent, event: event.hook_event_name, timestamp: event.timestamp };
        events.push(record);
        console.log(JSON.stringify(record));
      } catch {
        /* Main có thể đã đọc/xóa file; observer không can thiệp. */
      }
    }),
  );
}
console.log('Watching local hook event names for 120 seconds.');
setTimeout(() => {
  watchers.forEach((watcher) => watcher.close());
  fs.mkdirSync('.test-data', { recursive: true });
  fs.writeFileSync('.test-data/live-events.json', JSON.stringify(events, null, 2));
}, 120000);
