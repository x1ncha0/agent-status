# Agent Status — Release notes

## 1.0.4 — 11/09/2026

- Thêm mục **Kiểm tra cập nhật** trong menu khay hệ thống; khi có bản mới, app mở trang tải release tương ứng.
- Thêm icon đồng nhất cho file `.exe` và tray trên Windows.
- Khi CLI đã đóng, đèn chuyển về chấm rỗng thay vì giữ màu xanh.
- README được rút gọn, bỏ hướng dẫn checksum và tooltip hover không còn phù hợp với vùng kéo cửa sổ.

## 1.0.3 — 10/09/2026

Sửa lỗi terminal bị ẩn / thu nhỏ khi Codex chạy hook và thêm thay đổi kích thước cửa sổ bằng chuột. Bao gồm luồng thiết lập trong app từ 1.0.2.

### Sửa lỗi terminal

- Bỏ `-WindowStyle Hidden` khỏi command hook của cả Claude Code và Codex. Cờ này có thể tác động lên console được kế thừa từ CLI, khiến terminal đang dùng bị ẩn / thu nhỏ khi gửi yêu cầu hoặc chạy tool.
- Installer nhận diện cấu hình cũ và yêu cầu cập nhật. Khi cài, thay handler cũ của Agent Status, loại bản trùng và giữ các hook khác cùng cấu hình hiện có; tạo backup trước khi ghi.
- Giữ luồng truyền event qua stdin và PowerShell writer. Tiến trình do Electron khởi chạy vẫn dùng `windowsHide: true`, không đổi trạng thái cửa sổ của CLI.
- Không tự sửa Trust của Codex. Command mới cần được người dùng review và trust lại.
- Nhận diện câu hỏi Codex ổn định hơn với tool name có prefix `functions.`, namespace, khác hoa/thường hoặc dạng `request_user_input_async`; đèn giữ đỏ cho đến khi câu hỏi được trả lời.

### Thay đổi kích thước

- Kéo cạnh trái / phải để chỉnh chiều rộng, cạnh trên / dưới để chỉnh chiều cao; kéo góc để chỉnh cả hai.
- Kích thước mặc định `110 × 55` DIP, tối thiểu `90 × 45` DIP. Nội dung nằm giữa và giãn theo cửa sổ; chữ, đèn và khoảng cách tăng theo kích thước cửa sổ mà không thu nhỏ dưới mức mặc định.
- Kéo phần nội dung để di chuyển app. Viền được dành riêng cho resize.
- Lưu vị trí cùng chiều rộng / cao, khôi phục khi mở lại. File vị trí của bản cũ vẫn tương thích.
- Giới hạn lại cửa sổ trong vùng làm việc khi màn hình bị tháo hoặc độ phân giải / tỷ lệ hiển thị thay đổi; bỏ qua giá trị kích thước không hợp lệ.
- Dùng nền tối đặc và khung resize native Windows. Không bật lại chế độ nền trong suốt vì [Electron không hỗ trợ resize cửa sổ transparent](https://www.electronjs.org/docs/latest/tutorial/custom-window-styles#limitations).

### Thiết lập và đóng gói

- Khi mở trên máy mới hoặc cần cập nhật hook, app hiện **Cài đặt kết nối**. Có thể mở lại qua menu khay hệ thống → **Thiết lập kết nối…**.
- Máy đã cài đủ mở app mà không hỏi lại. Chọn **Để sau** ngừng nhắc cho phiên bản integration đó; vẫn cài được từ menu.
- Tooltip và hộp thoại hướng dẫn Trust hooks / mở phiên CLI mới khi chưa nhận được trạng thái.
- Giữ nguyên tiếng Việt trong cấu hình và hỗ trợ đường dẫn có dấu / khoảng trắng.
- Một file `AgentStatus.exe` portable có đủ runtime và script thiết lập; người dùng không cần Node.js hay thư mục integration riêng. Gói build kèm SHA256, README, kết quả kiểm thử và release notes. Thư mục `integration/` đi kèm dành cho cài bằng dòng lệnh nếu cần.

### Nâng cấp từ 1.0.1 / 1.0.2

1. Thoát Agent Status đang chạy rồi thay / mở executable mới.
2. Bấm **Cài đặt kết nối** khi app phát hiện hook cũ. Nếu đã chọn Để sau, mở **Thiết lập kết nối…** trong khay hệ thống. Bước này cần thiết để sửa lỗi terminal; chỉ đổi `.exe` chưa thay command hook đã cài.
3. Mở Codex trong terminal mới, vào `/hooks`, Review / Trust các command gọi `Write-AgentEvent.ps1` mới, rồi gửi thử một yêu cầu. Mở lại Claude Code để nhận cấu hình mới. Không cần tự chỉnh file hoặc bypass policy.
4. Kéo viền / góc app đến kích thước mong muốn. Nếu đổi đường dẫn executable, tắt rồi bật lại **Start with Windows** để cập nhật đường dẫn khởi động.

### Kiểm chứng và giới hạn

- Kiểm thử migration hook cũ, giữ hook khác và Trust, stdin đến writer; kiểm thử trạng thái, khôi phục, giá trị vị trí / kích thước cũ hoặc sai.
- Smoke test Electron kiểm tra thiết lập bằng PowerShell thật trong thư mục riêng, kéo cạnh / góc bằng chuột, thu nhỏ, lưu / khôi phục kích thước, bố cục và màu đèn của hai agent.
- Chi tiết bằng chứng và phạm vi đã kiểm tra: [VERIFICATION.md](VERIFICATION.md).
- Hỗ trợ CLI native Windows 10/11 x64. WSL, client Desktop/IDE và remote/cloud chưa được kiểm chứng. Giới hạn phát hiện approval/input vẫn như README; executable chưa code-sign.

## 1.0.2 — 10/09/2026

- Thêm thiết lập lần đầu và menu **Thiết lập kết nối…** ngay trong app, dùng installer đi kèm executable.
- Kiểm tra writer và từng hook bằng `Install-Hooks.ps1 -Check`, không ghi cấu hình hoặc tạo backup trong bước kiểm tra.
- Cho phép hoãn thiết lập; không nhắc lại khi kết nối đã cài đủ.
- Hướng dẫn Codex Review / Trust hooks và mở phiên mới; cải thiện tooltip của đèn chưa kết nối.
- Bảo toàn cấu hình UTF-8 khi merge hooks; bổ sung kiểm thử cài đặt với đường dẫn tiếng Việt.
- Bản 1.0.2 vẫn dùng command hook có `-WindowStyle Hidden` và cửa sổ cố định. Hai điểm này được sửa / thay đổi trong 1.0.3.
