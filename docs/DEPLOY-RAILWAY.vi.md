# Deploy lên Railway (kèm Neon)

Hướng dẫn từng bước đưa Reply Assistant lên mạng: app chạy trên [Railway](https://railway.com) từ `Dockerfile` của repo, dữ liệu nằm ở Postgres của [Neon](https://neon.tech). Bản tiếng Anh: [DEPLOY-RAILWAY.md](DEPLOY-RAILWAY.md).

Tên nút trên dashboard có thể đổi theo thời gian, ý chính thì giữ nguyên. Muốn tự chạy trên một server riêng bằng `docker compose` thì xem [HUONG-DAN.vi.md](HUONG-DAN.vi.md#tự-chạy-bằng-docker-app--database).

```
trình duyệt ──HTTPS──▶ Railway (Dockerfile này, Next.js standalone) ──TLS──▶ Neon Postgres + pgvector
                              │
                              └──▶ Anthropic API (và Voyage AI, tùy chọn)
```

## Cần chuẩn bị

- Một bản repo này trên GitHub của bạn.
- Tài khoản Neon, Railway và một API key Anthropic. Key Voyage AI là tùy chọn (cho memory và tìm ghi chú theo nghĩa).
- Node.js 20+ trên máy bạn, chỉ để chạy migration một lần.

Tạo trước hai chuỗi bí mật sẽ dán vào Railway:

```bash
openssl rand -base64 24     # APP_PASSCODE
openssl rand -base64 48     # APP_SESSION_SECRET
```

## 1. Tạo database (Neon)

1. Tạo project, chọn vùng gần nơi bạn đặt Railway (cả hai đều có Singapore).
2. Mở **Connect** và copy hai chuỗi kết nối:
   - chuỗi **direct** (host không có `-pooler`): dùng cho migration;
   - chuỗi **pooled** (host có `-pooler`): tùy chọn cho app. App tự tắt prepared statement khi thấy `-pooler`.
3. Thêm `?sslmode=require` vào cuối cả hai. **Đừng** dùng `channel_binding=require`: driver Postgres của app không hỗ trợ.

Migration đầu tiên đã có `CREATE EXTENSION IF NOT EXISTS vector`, nên không cần bật pgvector bằng tay.

## 2. Tạo bảng (một lần, từ máy bạn)

App ghi các cột của mọi migration ở **mọi request**, nên phải migrate **trước** lần deploy đầu, và trước mỗi lần deploy thay đổi có thêm file trong `drizzle/`.

```bash
git clone <repo của bạn> reply-assistant && cd reply-assistant
npm install
DATABASE_URL='<neon direct url>?sslmode=require' ALLOW_REMOTE_MIGRATE=1 npm run db:migrate
```

Đọc dòng đầu của kết quả: `[drizzle] database target: <host>/<database>`. Nó phải đúng là database Neon bạn định dùng, vì migration sẽ thay đổi database đó. `ALLOW_REMOTE_MIGRATE=1` là chốt chặn nói rằng "đúng, đây là database từ xa tôi muốn".

Kiểm tra: trong SQL editor của Neon chạy `select tablename from pg_tables where schemaname = 'public'`, phải thấy `conversations`, `generations`, `messages`, `profile_notes`, `reply_options`, `reply_usage`, `style_profiles`.

## 3. Tạo service (Railway)

1. **New Project → Deploy from GitHub repo**, cho Railway quyền truy cập repo rồi chọn nó.
2. Railway đọc `railway.toml` và build `Dockerfile`: stage build biên dịch app, stage cuối (runtime) chạy server standalone. Health check là `/api/health`.
3. Lần build đầu tự chạy ngay, nhưng sẽ chưa "healthy" cho tới khi có biến môi trường. Mở tab **Variables** của service (dùng **Raw Editor**) và dán:

   ```
   DATABASE_URL=<url neon pooled hoặc direct>?sslmode=require
   APP_PASSCODE=<giá trị từ openssl>
   APP_SESSION_SECRET=<giá trị từ openssl>
   REPLY_ANTHROPIC_API_KEY=<key Anthropic của bạn>
   # tùy chọn
   VOYAGE_API_KEY=<key Voyage>
   REPLY_SELF_NAMES=<tên bạn hiện trong chat, cách nhau dấu phẩy>
   REPLY_DAILY_BUDGET_USD=2
   ```

   Các biến còn lại đều có mặc định; danh sách đầy đủ ở [SETUP.md](SETUP.md#environment-variables). Đừng đặt `PORT` (Railway tự cấp) và đừng đặt `REPLY_DB_PASSWORD` hay `APP_PORT` (hai biến đó dành cho Docker Compose).
4. Deploy lại sau khi lưu biến (thường Railway tự làm).
5. **Settings → Networking → Generate Domain** để có địa chỉ công khai `https://….up.railway.app`. Tên miền riêng cũng thêm ở đây.
6. Trong **Settings**, chọn **region** gần database.

## 4. Kiểm tra

- `https://<domain của bạn>/api/health` trả `{"status":"ok"}` mà không cần đăng nhập.
- Mọi trang khác, kể cả trang chủ `/`, chuyển sang `/login`; API trả 401 khi chưa có phiên.
- Đăng nhập bằng `APP_PASSCODE`. Viết một reply: các phương án phải hiện **dần từng phần**. Nếu hiện một lần cả cụm thì có thứ gì đó phía trước app đang buffer luồng.
- Chấm 👍/👎 một reply, mở **Stats** và **Usage** (chi phí của lần gọi vừa rồi phải có mặt), rồi **Sign out**.

Nếu `/api/health` ổn mà các trang lỗi, thủ phạm thường là `DATABASE_URL`: health check không đụng database nên URL sai chỉ lộ ra khi dùng. Hãy xem log của service.

## 5. An toàn khi để chạy lâu dài

1. **Anthropic Console**: dùng key riêng cho app và đặt **giới hạn chi tiêu hàng tháng**. `REPLY_DAILY_BUDGET_USD` chỉ đếm những gì app đã ghi lại, nên giới hạn ở console là chốt chặn cuối nếu passcode bị lộ.
2. **Passcode**: 16 ký tự ngẫu nhiên trở lên. Ngắn hơn vẫn chạy nhưng log cảnh báo. Sai 5 lần thì client đó bị khóa 15 phút, và 20 lần từ bất kỳ ai thì khóa mọi người 15 phút.
3. **Railway**: đặt giới hạn sử dụng trong phần billing của tài khoản để hóa đơn không tăng âm thầm.
4. Đổi `APP_SESSION_SECRET` sẽ đăng xuất mọi người.

## Cập nhật

Railway deploy lại khi bạn push lên branch nó theo dõi. Khi thay đổi có thêm file trong `drizzle/`, chạy lệnh migrate ở bước 2 **trước**, rồi mới push. Có thể rollback ở tab **Deployments**; migration chỉ thêm, nên bản cũ vẫn chạy được trên database mới.

## Chi phí

Railway tính theo mức dùng; app rảnh phần lớn thời gian thì tốn ít. Gói miễn phí của Neon sẽ tạm dừng database khi nhàn rỗi, nên request đầu tiên sau lúc yên ắng sẽ chậm. Chi phí thật nằm ở các lệnh gọi model: khoảng một phần tư cent cho một reply nhanh và khoảng một cent cho model cẩn thận, tất cả xem được ở trang **Usage**.

## Voyage AI (tùy chọn)

Không có `VOYAGE_API_KEY` thì memory tắt và ghi chú được lưu không kèm vector, bắt đầu như vậy vẫn ổn. Thêm key sau đó rồi chạy backfill một lần từ máy bạn để request và ghi chú cũ tìm được theo nghĩa:

```bash
DATABASE_URL='<neon direct url>?sslmode=require' ALLOW_REMOTE_BACKFILL=1 VOYAGE_API_KEY=<key> npm run backfill:memory
DATABASE_URL='<neon direct url>?sslmode=require' ALLOW_REMOTE_BACKFILL=1 VOYAGE_API_KEY=<key> npm run backfill:notes
```

Tài khoản chưa có thẻ bị giới hạn 3 request mỗi phút; app tự giữ mình trong mức đó.

## Sự cố thường gặp

| Triệu chứng | Nguyên nhân có thể |
|---|---|
| Build lỗi | Đọc log build. Bước build tải font từ Google Fonts nên lỗi mạng có thể làm hỏng |
| Deploy "unhealthy" hoặc restart liên tục | Service không lắng nghe: xem log deploy. Thiếu biến bắt buộc (`APP_PASSCODE`, `APP_SESSION_SECRET`, `REPLY_ANTHROPIC_API_KEY`, `DATABASE_URL`) làm các route lỗi trong khi `/api/health` vẫn trả lời |
| Trang đăng nhập báo chưa cấu hình, hoặc mọi trang quay về `/login` | Thiếu `APP_PASSCODE` hoặc `APP_SESSION_SECRET`, hoặc secret ngắn hơn 32 ký tự |
| Bị khóa sau vài lần thử | Đợi 15 phút hoặc deploy lại (bộ giới hạn nằm trong bộ nhớ) |
| Trang đọc dữ liệu báo 500 | `DATABASE_URL` sai, thiếu `?sslmode=require`, hoặc chưa chạy migration |
| Request đầu tiên sau lúc yên ắng chậm | Database Neon vừa được đánh thức |
| Reply hiện một lần cả cụm | Có proxy đang buffer; so sánh với domain `*.up.railway.app` mặc định trước khi nghi ngờ app |
| "The daily spending limit for replies is reached" | Đã chạm `REPLY_DAILY_BUDGET_USD`; reset lúc 00:00 UTC |

Hướng dẫn này viết dựa trên cấu hình của chính repo (`railway.toml`, `Dockerfile`) và việc chạy cùng image đó ở local bằng Docker Compose. Phần chưa kiểm chứng được là edge thật của Railway, cụ thể là việc buffer luồng; hãy tự xác nhận bằng bước 4.
