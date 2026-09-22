# Agent Status

[![Release](https://img.shields.io/github/v/release/x1ncha0/agent-status?label=latest&color=2ea44f)](https://github.com/x1ncha0/agent-status/releases/latest)
[![Downloads](https://img.shields.io/github/downloads/x1ncha0/agent-status/total?color=blue)](https://github.com/x1ncha0/agent-status/releases)
[![Windows](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078d4?logo=windows&logoColor=white)](#giới-hạn)

Agent Status là tiện ích Windows hiển thị trạng thái **Claude Code** và **Codex CLI** trong một cửa sổ nhỏ, luôn nổi và không chiếm Taskbar.

Cửa sổ có thể kéo và thay đổi kích thước (tối thiểu `90 × 45` DIP). Kích thước và vị trí được lưu lại. Menu khay hệ thống có các tùy chọn Show/Hide, cài đặt integration, kiểm tra cập nhật, Start with Windows và Exit.

## Trạng thái

| Đèn          | Ý nghĩa                                     |
| ------------ | ------------------------------------------- |
| Xanh         | Sẵn sàng hoặc đã hoàn thành                 |
| Vàng         | Agent đang làm việc                         |
| Đỏ nhấp nháy | Đang chờ bạn cấp quyền hoặc trả lời câu hỏi |

Mỗi khi Claude hoặc Codex chuyển sang đỏ, app phát một tiếng báo hệ thống, kể cả khi cửa sổ đang ẩn. Âm thanh không lặp lại trong lúc agent vẫn đang chờ.

Chỉ hiện agent có phiên đang hoạt động và có đèn xanh, vàng hoặc đỏ. Agent chưa kết nối hoặc đã đóng sẽ tự ẩn; agent còn lại được căn giữa. Khi không còn agent nào, cửa sổ tự ẩn xuống khay hệ thống và tự hiện lại khi nhận trạng thái của phiên mới, không giành focus. App vẫn theo dõi trạng thái khi đang ẩn.

Nếu chọn **Hide** thủ công, cửa sổ giữ ẩn trong lúc các phiên hiện tại còn chạy; có thể mở lại bằng **Show** trong khay hệ thống.

## Tải về

[![Download AgentStatus.exe](https://img.shields.io/badge/Download-AgentStatus.exe-2ea44f?style=for-the-badge&logo=windows&logoColor=white)](https://github.com/x1ncha0/agent-status/releases/latest/download/AgentStatus.exe)

Bản phát hành là file portable, không cần cài đặt hoặc Node.js. Chạy `AgentStatus.exe`; lần đầu mở app, chọn **Cài đặt kết nối** nếu integration chưa được cài.

Codex có thể yêu cầu Review/Trust hook trong `/hooks`. Sau khi xác nhận, hãy mở một phiên CLI mới.

## Cài đặt hoặc cập nhật integration

Trong app, mở menu khay hệ thống và chọn **Thiết lập kết nối...**. Installer sẽ cập nhật hook cho Claude Code và Codex, đồng thời giữ lại các hook khác.

Sau khi cập nhật Agent Status, hãy cập nhật integration và mở phiên CLI mới để hook mới được nhận diện. Khi di chuyển file `.exe`, tắt rồi bật lại **Start with Windows**.

## Cập nhật app

Chọn **Kiểm tra cập nhật** trong menu khay hệ thống. Kết quả hiện trong popup nhỏ ở góc dưới bên phải màn hình thay vì hộp thoại giữa màn hình: đang kiểm tra, đã dùng bản mới nhất (tự đóng sau vài giây), có bản mới, hoặc không kết nối được GitHub (có nút **Thử lại**).

Khi có bản mới, chọn **Tải bản cập nhật**: app tự tải `AgentStatus.exe` kèm progress bar (có thể **Huỷ**), đối chiếu SHA256 của bản phát hành, đổi bản đang chạy thành `AgentStatus.old.exe`, đưa bản mới vào đúng chỗ rồi tự khởi động lại. File `.old.exe` được xoá ở lần mở kế tiếp; checksum lệch thì bản đang chạy được giữ nguyên.

Nếu thư mục chứa `.exe` không cho ghi, file tải về được lưu vào Downloads và popup hiện nút **Mở thư mục** để bạn thay thủ công.

## Giới hạn

- Chỉ hỗ trợ CLI native trên Windows với hook đã được cài và trust. WSL, remote/cloud và client Desktop/IDE chưa được kiểm chứng.
- App không lưu prompt, arguments, tool output hoặc transcript; chỉ lưu metadata cần để hiển thị trạng thái.
- Executable chưa được code-sign.

Xem thêm [release notes](RELEASE_NOTES.md) và [kết quả kiểm tra](VERIFICATION.md).
