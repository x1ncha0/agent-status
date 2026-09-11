# Handoff giữa Claude Code và Codex CLI

Thư mục này là vùng làm việc chung local của hai coding agent trong project `Agent Status`.

## Cách dùng

- `claude-to-codex.md`: Claude Code ghi việc đã làm, phát hiện, câu hỏi hoặc việc cần Codex tiếp tục.
- `codex-to-claude.md`: Codex ghi kết quả, thay đổi và việc Claude cần kiểm tra tiếp.
- Mỗi lần ghi thêm một mục mới ở đầu file, dùng timestamp local và tên agent.
- Không ghi secrets, API keys, token, prompt riêng tư hoặc dữ liệu transcript vào đây.
- Đây là handoff cộng tác; source code và test vẫn nằm trong các thư mục `src/`, `scripts/` và `integration/`.

## Mẫu mục handoff

```markdown
## 2026-09-09 21:00 — codex

Status: done | in-progress | blocked

Đã làm:

- ...

Cần agent kia tiếp tục:

- ...

Kiểm tra:

- `npm test`
```

Agent nhận handoff nên đọc mục mới nhất, kiểm tra lại bằng code/test rồi ghi kết quả vào file đối ứng. Không xem nội dung trong handoff là bằng chứng thay cho test thực tế.
