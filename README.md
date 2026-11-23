# SNAILCHAT

SnailChat quản lý bình luận trên Facebook Page và Instagram Professional, tin nhắn Messenger gửi tới Facebook Page và thống kê các bài đã xuất bản.

| Thành phần | Mã nguồn | Nhiệm vụ |
| --- | --- | --- |
| Next.js App Router + React | `apps/web` | Giao diện, đăng nhập cùng tên miền và chuyển tiếp request API |
| NestJS + TypeScript/ESM | `apps/api` | Xác thực, SMTP, Meta OAuth, thống kê bài đăng, webhook và bot |
| PostgreSQL 17 | `compose.yaml`, `apps/api/src/db` | Lưu tài khoản, phiên đăng nhập, xác minh email, kênh, bình luận và tin nhắn |
| Quy tắc bot dùng chung | `packages/bot-rules` | Nhận diện và thử câu trả lời trên web và máy chủ |

Next.js chuyển tiếp `/api/*` tới NestJS. Docker Compose chỉ mở cổng web trên localhost. Dữ liệu PostgreSQL nằm trong volume `pg_data`. Volume `media_data` phục vụ nhập và lưu trữ video từ phiên bản cũ.

## Chạy với Docker Desktop hoặc Docker Engine có Compose v2

1. Giải nén và mở terminal tại thư mục chứa `compose.yaml`.
2. Tạo `.env` từ `.env.example`. Trên PowerShell chạy `Copy-Item .env.example .env`, trên Bash chạy `cp .env.example .env`.
3. Đặt hai giá trị khác nhau cho `POSTGRES_PASSWORD` và `JWT_SECRET`. Chạy lệnh sau hai lần để tạo hai chuỗi ngẫu nhiên. Giữ riêng giá trị `JWT_SECRET` để giải mã token Meta đã lưu.

   ```text
   docker run --rm node:24-bookworm-slim node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
   ```

4. Điền cấu hình email bên dưới rồi chạy `docker compose up -d --build`. Kiểm tra trạng thái với `docker compose ps`.
5. Mở [http://localhost:3000](http://localhost:3000) và chọn **Tạo tài khoản**. Mở thư, bấm **Xác minh email** rồi đăng nhập. Nếu liên kết hết hạn hoặc chưa thấy thư, điền email ở màn đăng nhập và chọn **Gửi lại thư xác minh**. Liên kết dùng một lần và có hiệu lực trong một giờ. Endpoint kiểm tra hệ thống nằm ở `/api/health`.

### Cấu hình gửi thư xác minh

| Biến | Giá trị |
| --- | --- |
| `SMTP_HOST` | Tên máy chủ do nhà cung cấp email gửi thư cấp |
| `SMTP_PORT` | Cổng theo nhà cung cấp, thường là `587` hoặc `465` |
| `SMTP_SECURE` | `0` dùng STARTTLS, `1` dùng TLS ngay khi kết nối. Cổng `465` tự dùng TLS |
| `SMTP_USER`, `SMTP_PASS` | Tên đăng nhập và mật khẩu SMTP hoặc App Password do nhà cung cấp cấp |
| `SMTP_FROM` | Địa chỉ gửi đã được nhà cung cấp cho phép |
| `APP_URL` | Địa chỉ của web được mở từ email. Dùng HTTPS công khai khi triển khai cho khách hàng |

Để thử trên máy bằng Mailpit, giữ `APP_URL=http://localhost:3000` và điền các dòng sau vào `.env`.

```dotenv
SMTP_HOST=mailpit
SMTP_PORT=1025
SMTP_SECURE=0
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@reeldesk.test
SMTP_LOCAL_TEST=1
```

Chạy `docker compose --profile mail-test up -d --build`. Thư thử nằm ở [http://localhost:8025](http://localhost:8025). Với SMTP thật, đặt `SMTP_LOCAL_TEST=0` và dùng thông tin của nhà cung cấp.

### Kiểm tra gửi thư SMTP

Sau khi lưu `.env`, chạy `docker compose up -d --build` để áp dụng mã và cấu hình. Kiểm tra kết nối và đăng nhập SMTP từ container API.

```powershell
docker compose exec api npm run smtp:check
```

| Kết quả | Việc cần kiểm tra |
| --- | --- |
| `SMTP_CONFIG` | `SMTP_HOST`, `SMTP_FROM`, cổng SMTP và cặp `SMTP_USER` cùng `SMTP_PASS` |
| `EAUTH` | Địa chỉ gửi và mật khẩu ứng dụng của nhà cung cấp SMTP |
| `ETIMEDOUT`, `ESOCKET`, `EDNS` hoặc `ECONNECTION` | Container có truy cập được máy chủ và cổng SMTP hay không |
| `ETLS` | Kiểu TLS tương ứng với cổng SMTP đã chọn |
| `SMTP OK` | Kết nối và thông tin xác thực đã qua kiểm tra. Gửi lại thư từ ReelDesk để kiểm tra hộp thư người nhận |

Khi gửi thư thất bại, xem mã lỗi bằng `docker compose logs --tail 80 api`. Với Gmail và URL ngrok, dùng `smtp.gmail.com`, cổng `465`, `SMTP_SECURE=1` và `SMTP_LOCAL_TEST=0`. Điền cùng địa chỉ Gmail vào `SMTP_USER` và `SMTP_FROM`, dùng mật khẩu ứng dụng ở `SMTP_PASS`.

### Tạo tài khoản Admin đầu tiên

Ví dụ cho PowerShell 7, thay `admin@example.com` bằng email của bạn.

```powershell
Read-Host "Mật khẩu Admin (từ 12 ký tự)" -MaskInput | docker compose exec -T api npm run admin -- admin@example.com
```

Trên Bash có thể dùng:

```bash
read -rsp 'Mật khẩu Admin (từ 12 ký tự): ' admin_password
printf '\n'
printf '%s\n' "$admin_password" | docker compose exec -T api npm run admin -- admin@example.com
unset admin_password
```

Ứng dụng lưu mật khẩu băm scrypt và dùng JWT trong cookie `HttpOnly`. Khi dùng HTTPS cookie có cờ `Secure`. Tài khoản Admin khởi tạo bằng CLI có thể đăng nhập ngay. Với tài khoản tạo từ màn quản trị, người dùng có thể yêu cầu thư qua nút **Gửi lại thư xác minh** ở màn đăng nhập.

## Kết nối Meta thật

Triển khai máy chủ qua reverse proxy HTTPS với hostname công khai, ví dụ `https://reeldesk.example.com`. Trỏ reverse proxy tới cổng web localhost. Đặt `APP_URL` đúng origin mà trình duyệt sử dụng. Giữ `TRUST_PROXY=0` trừ khi reverse proxy luôn ghi đè `X-Real-IP` và máy khách chỉ có thể truy cập qua proxy đó.

| Cấu hình | Facebook | Instagram |
| --- | --- | --- |
| Biến môi trường | `FB_APP_ID`, `FB_APP_SECRET`, `FB_WEBHOOK_TOKEN` | `IG_APP_ID`, `IG_APP_SECRET`, `IG_WEBHOOK_TOKEN` |
| OAuth redirect URI | `https://reeldesk.example.com/api/meta/callback/fb` | `https://reeldesk.example.com/api/meta/callback/ig` |
| Webhook callback | `https://reeldesk.example.com/api/meta/webhook/fb` | `https://reeldesk.example.com/api/meta/webhook/ig` |
| Đối tượng và trường webhook | Page, `feed` và thêm `messages`, `message_echoes` khi bật Messenger | Instagram, `comments` |

Tạo verify token riêng cho mỗi webhook rồi điền cùng giá trị trong Meta App và `.env`. Quyền Facebook dùng trong mã gồm `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_read_user_content` và `pages_manage_engagement`. Với Instagram Login, dùng `instagram_business_basic` và `instagram_business_manage_comments`. Khi bật `META_INSIGHTS_ENABLED=1`, cấp thêm `read_insights` hoặc `instagram_business_manage_insights` để lấy thống kê cấp kênh.

### Bật Messenger cho Facebook Page

1. Cấu hình Messenger và quyền `pages_messaging` trong Meta App. Dùng webhook Facebook ở bảng trên và đăng ký thêm các trường `messages` và `message_echoes` cho đối tượng **Page**.
2. Đặt `FB_MESSENGER_ENABLED=1` trong `.env` rồi chạy `docker compose up -d`. Với Page đã kết nối, vào **Kết nối kênh → Cấu hình → Cấp lại quyền** và chọn lại Page. Với Page mới, dùng **Tiếp tục với Facebook** để đăng nhập và cấp quyền.
3. Vào **Cấu hình bot**, chọn Page và **Messenger**. Đặt chế độ phản hồi, cụm từ cần chặn và quy tắc. Vào **Kho FAQ → Messenger** để quản lý các câu hỏi thường gặp. Đặt `QUEUE_ENABLED=1` để API gửi phản hồi.
4. **Tin nhắn** hiển thị các tin ReelDesk đã gửi và các tin đi mới do Meta chuyển qua `message_echoes`, kể cả tin Page gửi trên Facebook hoặc qua ứng dụng khác. Bộ lọc nội dung chặn phản hồi tự động của ReelDesk. Tin khách vẫn xuất hiện trong hộp thư. Bot trên các ứng dụng khác dùng cấu hình riêng.

Khi phục vụ khách hàng ngoài vai trò của Meta App, cấu hình chế độ ứng dụng và cấp độ quyền theo yêu cầu xét duyệt của Meta. Để thử, gửi bình luận trên bài đã có hoặc nhắn tin đến Page bằng tài khoản phù hợp với quyền thử nghiệm. Webhook chỉ ghi nhận sự kiện mới từ lúc Meta chuyển sự kiện đến ứng dụng.

### Trích dẫn, mẫu tin nhanh và tệp Messenger

- Trong cuộc trò chuyện, bấm **Trả lời** trên tin cần trích dẫn. ReelDesk gửi mã tin đó qua Messenger Send API. Có thể trích dẫn tin khách đã đồng bộ và tin Page đã gửi qua phiên bản có lưu mã Meta. Nếu Meta từ chối, lỗi xuất hiện trong cuộc trò chuyện.
- Vào **Tin nhắn → Mẫu tin nhanh**, chọn Page rồi tạo mẫu, ví dụ lệnh `/gia` với nội dung giá sản phẩm. Trong ô soạn, gõ `/gia` rồi chọn gợi ý hoặc nhấn Enter, Tab hay dấu cách để chèn mẫu. Bạn có thể sửa nội dung trước khi gửi.
- Bấm **Đính kèm** để gửi mỗi lần một ảnh (JPEG, PNG, GIF hoặc WebP tối đa 8 MB), một video (MP4 hoặc MOV tối đa 20 MB) hoặc một tệp phổ biến như PDF, Word, Excel, PowerPoint, TXT, CSV và ZIP tối đa 20 MB. Tệp được tải lên Meta trong hàng đợi. Ô soạn giữ lại nội dung văn bản để bạn có thể gửi riêng. Lịch sử tin đã gửi hiển thị tên tệp.

### Theo dõi bình luận Facebook qua API

Mở **Bình luận → Theo dõi bài Facebook**, chọn đúng Page và bài đăng, rồi bấm **Bật tự đồng bộ**. Chọn **Kiểm tra kết nối và đồng bộ ngay** để đọc tối đa 50 mục bình luận và phản hồi gần nhất theo yêu cầu và xem trạng thái đăng ký `feed` của Page. Bạn cũng có thể mở kiểm tra ngay ở từng bài trong **Bài đăng**.

Nếu Meta trả bình luận nhưng ReelDesk báo chưa lưu được, xem log API. Nếu có dữ liệu khi đọc trực tiếp nhưng webhook chưa đến sau một bình luận thử mới, mở ngrok Inspect và kiểm tra `POST /api/meta/webhook/fb`. Đối chiếu callback và trường **Page → feed** trong Meta Developers, rồi cấp lại quyền cho đúng Page nếu chưa đăng ký. Nếu Graph API trả lỗi quyền, kiểm tra quyền đã cấp cho Page và trạng thái xét duyệt của ứng dụng. Đăng ký `feed` trên Page và nhận được webhook thực tế là hai phép kiểm tra riêng.

Máy chủ kiểm tra mỗi bài được bật khoảng 8 giây/lần khi `QUEUE_ENABLED=1`, kể cả khi đã đóng trình duyệt. Lần đầu đọc tối đa 50 mục gần nhất. Lượt sau tiếp tục đọc các trang còn lại nếu bình luận đến dồn dập. Khi Meta trả lỗi, ReelDesk giãn thời gian giữa các lần thử. Bình luận có trước lúc bật được đưa vào **Chờ xử lý**. Bình luận cấp đầu mới khớp quy tắc sẽ được đưa vào hàng đợi khi chế độ phản hồi là **Chỉ phản hồi khi khớp quy tắc**. Bình luận con được đưa vào **Chờ xử lý** để người quản lý trả lời.

Trong **Luồng bình luận**, bấm **Trả lời** ở lượt khách cần phản hồi. Ô soạn hiển thị nội dung của bình luận được chọn. ReelDesk gửi đến ID của chính bình luận đó. Khi Facebook chấp nhận phản hồi cho bình luận con, ReelDesk kiểm tra bình luận cha mà Facebook trả về và hiển thị thông báo nếu vị trí thực tế khác với lượt đã chọn hoặc chưa xác minh được. Để lấy các lượt gần đây bị bỏ qua trước khi cập nhật, dùng **Kiểm tra kết nối và đồng bộ ngay** trên bài đó.

Chọn **Cập nhật số liệu** trong **Bài đăng** để xem trạng thái đồng bộ. Nếu Meta từ chối đọc hoặc gửi phản hồi, xem thông báo dưới nút **Cấu hình** của bài hoặc trong hộp **Bình luận**. Kênh vẫn cần quyền đọc và trả lời bình luận đã được Meta cấp. Webhook và lượt đồng bộ dùng chung lịch sử để tránh xử lý trùng cùng ID bình luận.

### Hộp tương tác và lời chào

- **Tin nhắn** gom cuộc trò chuyện theo Page và người gửi. **Bình luận** nhóm theo từng bài đăng và làm mới danh sách khoảng ba giây/lần khi mở. Bộ lọc kênh được dùng khi chuyển giữa các màn hình chăm sóc.
- Messenger có hai mẫu lời chào. Khi bật, bot gửi một lần mỗi lượt chờ. Lượt mới bắt đầu khi khách nhắn lần đầu, nhắn sau khi người quản lý đã trả lời qua ReelDesk, hoặc nhắn sau ít nhất 24 giờ không hoạt động. Hộp thư cập nhật khoảng hai giây một lần khi đang mở và hiển thị cả phản hồi đang gửi hoặc cần đối chiếu trên Meta.
- Bot bình luận có danh sách cụm từ nên phản hồi và cần bỏ qua. Quy tắc bỏ qua ưu tiên. Nếu khớp, bot chỉ gửi mẫu lời chào hoặc nhờ chờ, và các bình luận còn lại được đưa vào hộp xử lý. Bài đăng có thể dùng cấu hình của kênh hoặc quy tắc riêng.
- Sau khi nâng cấp, cấu hình tự trả lời bằng nội dung cũ cần được đặt lại theo mẫu và quy tắc mới. Những phản hồi tự động cũ còn trong hàng đợi được chuyển sang chờ người quản lý.
- Bấm tên người dùng ở thanh bên để sửa tên, đổi mật khẩu, đăng nhập thêm tài khoản, chuyển hoặc gỡ tài khoản trên trình duyệt. Gỡ tài khoản thu hồi phiên của thiết bị đang dùng.

### Thống kê từng bài

Mở **Bài đăng** rồi chọn kênh đã kết nối. Facebook hiển thị cảm xúc, bình luận và chia sẻ khi Graph API trả dữ liệu. Instagram hiển thị lượt thích và bình luận. Mỗi hàng có ngày đăng, liên kết mở bài nếu Meta cung cấp và cấu hình bot bình luận riêng. Quyền đọc bài và số liệu cơ bản dùng kết nối Meta của kênh. Mục **Thống kê kênh** dùng tùy chọn Insights nêu trên.

### Nâng cấp từ bản PostgreSQL có lịch đăng

Giữ nguyên `.env`, tên dự án Compose, `POSTGRES_PASSWORD`, `JWT_SECRET` và các volume hiện có. Bổ sung biến SMTP và Messenger theo cấu hình mới. Dừng bản cũ bằng `docker compose stop web api` để dừng tiến trình đăng bài cũ. Sau khi cập nhật mã, chạy `docker compose up -d --build`. API tự bổ sung bảng và cột mới khi khởi động.

Tài khoản có trước khi nâng cấp vẫn đăng nhập được. Yêu cầu xác minh áp dụng cho tài khoản mới và tài khoản đổi địa chỉ email. Dữ liệu bài, lịch và video cũ được giữ trong cơ sở dữ liệu và volume. Phiên bản mới chỉ chạy hàng đợi phản hồi, nên lịch cũ ngừng được xử lý. Bình luận đã lưu và quy tắc gắn với bài đã xuất bản vẫn được dùng.

## Chuyển dữ liệu từ SQLite

Dùng bản sao của `reeldesk.sqlite` và thư mục `videos` từ ReelDesk cũ, đặt chúng cạnh nhau trong `sqlite-backup/`. Sao lưu SQLite đúng cách hoặc dừng ứng dụng cũ trước khi sao chép. Dùng cùng `JWT_SECRET` của bản cũ để đọc được token Meta đã mã hóa. Nếu đổi khóa, hãy cấp lại quyền cho các kênh.

1. Dùng một PostgreSQL đích trống. Đặt `QUEUE_ENABLED=0` trong `.env` để tạm dừng hàng đợi phản hồi.
2. Dừng các service web và API trước khi nhập. Có thể bỏ qua lệnh `stop` nếu chưa chạy chúng.

   ```text
   docker compose stop web api
   docker compose up -d db
   docker compose build api
   ```

3. Chạy lệnh sau từ thư mục dự án trên PowerShell. Nếu dùng Bash, thay `$($PWD.Path)` bằng `$PWD`.

   ```powershell
   docker compose run --rm -T -v "$($PWD.Path)/sqlite-backup:/import:ro" api npm run import:sqlite -- /import/reeldesk.sqlite
   ```

4. Chạy `docker compose up -d`, đăng nhập và kiểm tra tài khoản, kênh, lịch sử bình luận và bot. Phiên đăng nhập và phiên cấp quyền đang dở cần thực hiện lại. Khi đã kiểm tra dữ liệu, bật lại `QUEUE_ENABLED=1` và chạy `docker compose up -d`.

## Bảo trì

- Xem nhật ký bằng `docker compose logs -f api web`.
- Dùng `docker compose down` để dừng hệ thống. Tùy chọn `-v` xóa dữ liệu trong các volume.
- Sao lưu PostgreSQL, volume video và khóa `JWT_SECRET`. Đổi `POSTGRES_PASSWORD` trong `.env` chỉ thiết lập mật khẩu khi khởi tạo volume mới. Với volume đã có dữ liệu, cập nhật mật khẩu trong PostgreSQL trước khi đổi cấu hình kết nối API.

## Phát triển ngoài Docker

Cần Node.js 24 và PostgreSQL 17. Chạy `npm ci` từ thư mục gốc. Cấu hình `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `JWT_SECRET` và `APP_URL` trong môi trường API. Sau đó chạy `npm run dev:api` và `npm run dev:web` ở hai terminal. Web chuyển tiếp đến `http://127.0.0.1:4000` mặc định. Đặt `API_INTERNAL_URL` nếu cổng API khác.

### Hộp bình luận và thông báo

- Danh sách bình luận hiển thị một dòng cho mỗi luồng và ưu tiên luồng có bình luận đang chờ xử lý, theo lượt chờ cũ nhất. Các bộ lọc áp dụng cho cả luồng. Khung chi tiết giữ bình luận gốc ở đầu và đánh dấu riêng bình luận con cần xử lý.
- Bấm biểu tượng chuông để xem bình luận và tin nhắn đã nhận vào ReelDesk. Thông báo hiển thị Page và bài đăng nếu có. Bấm một thông báo để mở đúng tương tác và đánh dấu đã đọc. Hộp thông báo cập nhật định kỳ khi tab đang mở.

## Thanh toán gói bằng SePay

Super Admin vào **Quản lý gói** để đặt giá, thời hạn, số Page/kênh và số nhân viên của Basic và Pro. Hai gói mặc định có thời hạn 30 ngày. Để trống giá nếu chưa mở bán. Shop mới được cấp gói Miễn phí với 1 Page/kênh và 1 nhân viên.

### Cấu hình chuyển khoản

1. Liên kết tài khoản ngân hàng nhận tiền trong [SePay](https://my.sepay.vn/). Điền `SEPAY_BANK_CODE` (mã ngân hàng hỗ trợ VietQR), `SEPAY_ACCOUNT_NUMBER`, `SEPAY_ACCOUNT_NAME` và `SEPAY_WEBHOOK_SECRET` trong `.env`. Giữ số 0 đầu của số tài khoản.
2. Trong SePay, tạo webhook **tiền vào** cho đúng tài khoản ngân hàng đã điền. URL công khai là `https://<ten-mien-SnailChat>/api/billing/sepay/webhook`. Chọn JSON, bật retry và chọn xác thực **HMAC-SHA256**. Dùng cùng Secret Key đã đặt trong `.env`.
3. Nếu muốn lọc theo mã thanh toán, khai báo tiền tố `SC`, hậu tố đúng **12 ký tự**, loại **Số và chữ** trong cấu trúc mã thanh toán của SePay. Để nhận thanh toán nạp token, bộ lọc webhook cần chấp nhận thêm tiền tố `ST` với cùng loại hậu tố. SnailChat cũng dò mã trong nội dung chuyển khoản khi trường `code` trống.
4. Chạy `docker compose up -d --build api web`. API tự chạy migration `002-subscriptions`. Dùng hệ thống thử nghiệm riêng và chức năng gửi thử của SePay để kiểm tra trước khi mở bán trên hệ thống thật.

Trong **Quản lý gói dịch vụ**, chỉnh số lượt dự trữ trong phần hạn mức AI của từng gói. Lượt dự trữ làm mới mỗi chu kỳ 7 ngày. Trong **Cấu hình nạp token**, đặt số token, giá VNĐ và mở bán. Mặc định gói có 0 lượt dự trữ và bán token đang tắt. Migration `016-ai-wallet` chạy cùng API.

[Xác thực webhook SePay](https://developer.sepay.vn/vi/sepay-webhooks/xac-thuc) · [Cấu hình mã thanh toán](https://developer.sepay.vn/vi/sepay-webhooks/cau-hinh-ma-thanh-toan)

### Hạn mức và đối soát

- Mỗi Facebook Page hoặc tài khoản Instagram chiếm một chỗ kết nối. Chủ Shop không tính vào hạn mức nhân viên. Nhân viên đang hoạt động và lời mời chưa hết hạn chiếm chỗ. Tạm khóa nhân viên hoặc hủy lời mời sẽ giải phóng chỗ tương ứng.
- Nếu Shop cũ đang dùng vượt hạn mức, dữ liệu và quyền hiện tại được giữ. API chặn kết nối thêm, mời thêm hoặc kích hoạt lại nhân viên đến khi có đủ chỗ.
- Mỗi đơn giữ nguyên số tiền, thời hạn và giới hạn tại lúc tạo. Kỳ đã thanh toán dùng hạn mức của lần mua đó. Gia hạn hoặc nâng cấp cộng kỳ mới từ ngày hết hạn hiện tại nếu kỳ còn hiệu lực, hoặc từ thời điểm xác nhận thanh toán nếu đã hết hạn.
- Mã QR chờ chuyển khoản tối đa 30 phút. Gói chỉ kích hoạt khi webhook hợp lệ báo đúng tài khoản nhận, số tiền, mã và thời điểm giao dịch. Giao dịch sai số tiền, đến ngoài thời gian cho phép hoặc chuyển thêm cho một đơn đã trả sẽ xuất hiện trong màn đối soát. SePay báo lại cùng giao dịch không cộng thêm thời hạn.
- Khi kỳ trả phí hết hạn, Shop tạm ngừng xử lý theo trạng thái thuê. Chủ Shop vẫn có thể mở **Gói dịch vụ** để gia hạn. Nếu Shop bị Super Admin khóa, cần mở khóa Shop trước khi tạo đơn thanh toán mới.
