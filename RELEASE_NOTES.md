# Agent Status — Release notes

## 1.3.0 — 30/09/2026

- Theo dõi thêm **Antigravity** (Antigravity 2.0 và Antigravity IDE) trên Windows và macOS: đèn vàng khi agent đang suy nghĩ hoặc chạy tool, xanh khi đã dừng. Antigravity không có đèn đỏ vì không báo lúc đang chờ bạn duyệt. Đèn tự ẩn khi thoát Antigravity.
- Thiết lập kết nối thêm một mục `agent-status` vào `~/.gemini/config/hooks.json` (chỉ khi máy đã chạy Antigravity: có `~/.gemini/antigravity` hoặc `~/.gemini/antigravity-ide`), giữ nguyên các hook khác và sao lưu file cũ. Hook chỉ báo trạng thái, không đổi quyền hay hành vi của agent.
- Cập nhật trên macOS tự thay app và mở lại bản mới, giống Windows: tải `.dmg`, kiểm SHA256, thay app trong thư mục đang chứa nó rồi khởi động lại. Không thay được thì lưu vào Downloads như trước. Có hiệu lực từ các bản sau 1.3.0; lần lên 1.3.0 vẫn phải thay tay.
- Cửa sổ mới mở lần đầu rộng 165 DIP để đủ chỗ cho ba đèn; kích thước đã lưu giữ nguyên. Tooltip khay hiện tên agent (Claude, Codex, Antigravity).

## 1.2.1 — 30/09/2026

- Sửa lỗi trên macOS cửa sổ không bao giờ hiện và menu khay luôn báo "không có agent đang chạy" dù Claude hoặc Codex đang chạy: app bỏ qua file sự kiện do hook ghi vì tên file là UUID chữ hoa. App giờ đọc được cả tên chữ hoa lẫn chữ thường, nên hook đã cài không cần cài lại; hook mới ghi tên chữ thường.

## 1.2.0 — 30/09/2026

- Có bản macOS (Apple Silicon và Intel, macOS 12 trở lên): icon trên menu bar, cửa sổ nổi trên mọi Space kể cả app toàn màn hình, không có icon Dock. Thiết lập kết nối cài hook cho Claude Code và Codex bằng bộ ghi trạng thái dùng `osascript` có sẵn của macOS, không cần Node hay Python.
- Kiểm tra cập nhật trên macOS tải `.dmg` đúng chip vào Downloads, đối chiếu SHA256 rồi mở Finder để bạn thay app.
- Menu khay có **Start at login** trên macOS.
- Bản phát hành được build và đăng tự động bằng GitHub Actions cho cả Windows và macOS, kèm file SHA256 cho từng bản.

## 1.1.1 — 29/09/2026

- Cửa sổ tự ẩn trong khoảng 0,5 giây sau khi đóng terminal hoặc tắt CLI (trước đây 2,5–3,5 giây). App kiểm tra tiến trình còn sống mà không phải mở PowerShell mỗi lần; PowerShell chỉ còn dùng một lần cho mỗi phiên để xác minh thời điểm khởi động.
- Sửa lỗi cửa sổ không bao giờ tự ẩn khi hook không xác định được tiến trình của phiên: phiên giữ lại tiến trình đã biết từ các sự kiện trước, và phiên không rõ tiến trình tự hết hạn sau 10 phút rảnh (60 phút khi đang làm việc hoặc chờ bạn trả lời).
- Lỗi đọc sự kiện thoáng qua (ví dụ phần mềm diệt virus khoá file) không còn làm cửa sổ ẩn rồi hiện lại. Lỗi kéo dài hơn 1,5 giây được hiện trong tooltip khay hệ thống thay vì báo "Không có agent đang chạy".
- Mục Show trong menu khay bị vô hiệu kèm ghi chú khi không có agent đang chạy, thay vì bấm không có tác dụng.
- Cập nhật tự động bắt buộc có checksum `AgentStatus.exe.sha256` hợp lệ và kiểm tra trước khi tải; thiếu checksum thì không cài.

## 1.1.0 — 22/09/2026

- **Kiểm tra cập nhật** hiện kết quả trong popup nhỏ ở góc dưới bên phải màn hình thay cho hộp thoại giữa màn hình: đang kiểm tra, đã dùng bản mới nhất (tự đóng sau vài giây), có bản mới, hoặc lỗi mạng kèm nút Thử lại. Popup nổi trên cửa sổ khác nhưng không giành focus của CLI; đóng bằng nút × hoặc `Esc`.
- Chọn **Tải bản cập nhật** là app tự tải `AgentStatus.exe` của bản phát hành mới, kèm progress bar theo dung lượng và nút Huỷ.
- Tải xong, app đối chiếu SHA256 với asset `AgentStatus.exe.sha256`, đổi bản đang chạy thành `AgentStatus.old.exe`, đưa bản mới vào đúng chỗ rồi tự khởi động lại. File `.old.exe` được xoá ở lần mở kế tiếp. Checksum lệch thì giữ nguyên bản đang chạy và báo lỗi.
- Nếu thư mục chứa `.exe` không cho ghi, file tải về vào Downloads và popup hiện nút Mở thư mục để thay thủ công.

## 1.0.6 — 22/09/2026

- Phát một tiếng báo hệ thống khi Claude hoặc Codex chuyển sang đỏ, kể cả khi cửa sổ đang ẩn; không kêu lặp khi vẫn đang chờ.
- Đèn đỏ nhấp nháy để dễ nhận biết agent đang chờ cấp quyền hoặc trả lời câu hỏi.
- Giảm thời gian chạy hook bằng cách đọc cây tiến trình qua Windows Toolhelp thay cho nhiều truy vấn WMI. Bộ hỗ trợ được biên dịch lúc cài integration; vẫn giữ PID và thời điểm tạo phiên để khôi phục trạng thái đúng.
- Giữ nguyên lệnh hook và giới hạn 3 giây. Truy vấn dự phòng cho Claude cài qua npm có ngân sách tối đa 500 ms; thiếu metadata vẫn ghi sự kiện.

## 1.0.5 — 11/09/2026

- Tự ẩn agent có chấm rỗng (chưa kết nối hoặc đã đóng phiên), chỉ hiện ba trạng thái xanh / vàng / đỏ; căn giữa khi còn một agent.
- Tự ẩn cửa sổ khi không còn agent nào và hiện lại khi có phiên hoạt động, không giành focus. Giữ lựa chọn Hide thủ công trong lúc agent vẫn chạy; thiết lập và Exit vẫn dùng được qua khay hệ thống.

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
- Hỗ trợ CLI native Windows 10/11 x64. WSL, client Desktop/IDE và remote/cloud chưa được kiểm chứng. Giới hạn phát hiện approval/input vẫn như README; executable chưa code-sign.

## 1.0.2 — 10/09/2026

- Thêm thiết lập lần đầu và menu **Thiết lập kết nối…** ngay trong app, dùng installer đi kèm executable.
- Kiểm tra writer và từng hook bằng `Install-Hooks.ps1 -Check`, không ghi cấu hình hoặc tạo backup trong bước kiểm tra.
- Cho phép hoãn thiết lập; không nhắc lại khi kết nối đã cài đủ.
- Hướng dẫn Codex Review / Trust hooks và mở phiên mới; cải thiện tooltip của đèn chưa kết nối.
- Bảo toàn cấu hình UTF-8 khi merge hooks; bổ sung kiểm thử cài đặt với đường dẫn tiếng Việt.
- Bản 1.0.2 vẫn dùng command hook có `-WindowStyle Hidden` và cửa sổ cố định. Hai điểm này được sửa / thay đổi trong 1.0.3.
