# Hướng dẫn dùng Reply Assistant

> Bản tiếng Việt của [SETUP.md](SETUP.md). Chạy mọi lệnh từ thư mục gốc của repo; dữ liệu mẫu để thử giao diện không cần API key: `npm run seed:demo` (chỉ database local, đang trống).

Viết reply tiếng Anh theo giọng của bạn: gõ ý bằng tiếng Việt, hoặc dán đoạn chat
tiếng Anh, app đưa ra vài phương án. App chỉ viết nháp — bạn tự copy và gửi.

### Dùng hằng ngày

- **Quick translate**: không thuộc cuộc trò chuyện nào. Gõ ý tiếng Việt → 4 phương án
  (short / medium / long / alt).
- **＋ New conversation**: tạo thread. Trong thread, chọn **Paste their message** để dán chat
  tiếng Anh (lần dán sau tự bỏ phần trùng) hoặc **Ý tiếng Việt** để trả lời có ngữ cảnh thread.
- Khi dán tin nhắn của họ, app còn hiện khung **Họ đang nói gì**: bản dịch tiếng Việt + ghi chú giọng điệu
  và thành ngữ/từ lóng. Nó chạy song song với việc viết reply nên không làm reply chậm hơn, và có thể tắt
  bằng ô **Explain in Vietnamese** (mỗi lần tốn thêm một lệnh gọi Haiku nhỏ, cỡ bằng một lần viết reply).
- Mỗi phương án có 👍 / 👎, ✏️ sửa, **Use this** (copy + đánh dấu đã dùng). Càng rate và sửa nhiều,
  memory và style profile càng sát giọng bạn.
- **Learn** tắt = request vẫn được lưu nhưng không dùng để học. **Use memory** bật = lấy các reply tốt
  trước đây làm ví dụ.
- ⚡ Fast (Haiku) / 🎯 Smart (Sonnet) / Auto. Nút **Better** chạy lại bằng Smart.
- `/reply/style`: tạo style profile từ feedback (cần ít nhất 5 reply đã sửa hoặc rate). Bản mới tạo
  ở trạng thái **tắt** — đọc từng quy tắc, **sửa lời, xóa hoặc thêm từng quy tắc** (**Edit rules**) rồi mới bật.
  Bản đang bật không sửa được: tắt nó đi trước. Trang có sẵn đoạn "How it works" giải thích profile là gì. `/reply/stats`: tỉ lệ 👍, memory có giúp không,
  tốc độ. `/reply/usage`: **tiền đã tiêu** hôm nay / tuần / tháng / tổng, theo ngày, tuần, tháng,
  theo loại lệnh gọi (viết reply, giải thích, tóm tắt, style profile, embedding, warm-up) và theo từng conversation.
  Đây là ước tính từ số token và bảng giá trong code, không phải hóa đơn; xóa conversation không làm mất chi phí đã ghi. **Export examples**: tải file JSONL các reply đã sửa hoặc được 👍.

### 🌱 Phát triển một reply (Develop)

Mỗi phương án có nút **🌱 Phát triển**. Gõ hướng bằng tiếng Việt ("thêm là mình cũng mới dọn nhà, hỏi họ ở tầng
mấy") và/hoặc bấm nút nhanh: **Longer**, **Ask something back**, **Add a personal detail**, **More casual**.
App tạo **hai bản dài hơn** ngay dưới phương án gốc (phương án gốc giữ nguyên). "Add a personal detail" cần bạn
gõ chi tiết: app không tự bịa chuyện đời bạn. Chỉ phát triển được bản gốc, không phát triển bản đã phát triển.
**Use this** là loại trừ trong cả lượt: chọn một bản thì các bản khác (gốc và đã phát triển) bị bỏ chọn.
Mỗi lần Develop là một request riêng, tính vào ngân sách ngày (loại "Developing replies" trong `/reply/usage`).

### 🧑 About me: ghi chú về bạn (`/reply/about`)

Ghi chú ngắn về đời bạn (nghề, thói quen, chuyện mới xảy ra) để reply nhắc đúng chi tiết thật.

- **Thêm ghi chú**: gõ tay (bấm **Suggest English + tags** để model đề xuất bản tiếng Anh, loại, scope, ngày), hoặc
  **Import a diary** (dán nhật ký tối đa 12.000 ký tự, model tách thành các ghi chú để bạn tick, sửa rồi mới lưu).
  Mỗi ghi chú có: bản gốc, **bản tiếng Anh** (để khớp tin nhắn tiếng Anh; sửa được nếu model dịch sai), loại
  `fact` (luôn đúng) hoặc `event` (có ngày, càng cũ càng ít được chọn), scope **Work / Casual / Both**, và hai cờ
  **📌 pin** (luôn nằm trong prompt, tối đa 20) và **🔒 private**.
- **🔒 Private** = ghi chú chỉ nằm trong app: không dịch, không embed, không bao giờ gửi cho model, không pin được.
  Đổi một ghi chú thành private sẽ xóa bản tiếng Anh, vector **và cả bản sao lời ghi chú còn nằm trong hướng của các
  reply từng được phát triển bằng nó**. Xóa ghi chú cũng xóa các bản sao đó. Reply đã viết ra thì không xóa được.
- **Dùng trong reply** (ô **Use my notes**, mặc định bật): với **tin nhắn dán**, ghi chú ghim và ghi chú hợp
  được đưa cho model (bộ ghi chú nhỏ, tối đa 30, gửi nguyên; bộ lớn hơn thì tìm theo nghĩa, lấy tối đa 5); model
  báo ghi chú nào đã dùng và trang hiện **Used N notes** kèm **Don't use this one** (viết lại không dùng ghi chú
  đó), sửa và lưu trữ. Ghi chú khác scope với request (Work/Casual) không bao giờ vào prompt. Với **ý tiếng Việt bạn
  gõ**, app không tự chèn ghi chú nào: chỉ hiện 💡 gợi ý, bấm vào là phát triển reply bằng đúng ghi chú đó.
- **Tin dán có ghi chú → model Smart** (khi tốc độ là **Auto**): model nhanh từng tự bịa trải nghiệm cho bạn.
  Smart tốn khoảng $0,009 mỗi reply thay vì $0,002. Chọn ⚡ Fast bằng tay để giữ đường rẻ.
- **💡 Suggested notes (Inbox)**: sau mỗi reply, app đọc **chính những gì bạn gõ** (ý tiếng Việt, hướng Develop; không
  bao giờ tin nhắn dán, và không gì cả khi **Learn** tắt) và đề xuất tối đa 3 sự thật về bạn. Chúng nằm chờ trong
  Inbox trên trang About me (link "About me" ở trang Reply hiện "N new"). **Add to my notes** (sửa, chọn scope, pin
  được) hoặc **Dismiss** (app nhớ và không đề xuất lại). Chưa duyệt thì không bao giờ được dùng trong reply. Mỗi ý
  gõ tốn thêm khoảng $0,0009; Inbox tối đa 20 mục chờ.
- **⬇ Export my notes (JSON)**: tải ghi chú của bạn (kể cả đã lưu trữ). **Ghi chú private không có trong file**
  (file chỉ ghi số lượng đã bỏ qua), gợi ý chưa duyệt và vector cũng không.

### Tự chạy bằng Docker (app + database)

Cách đơn giản nhất để chạy trên server hoặc máy ở nhà: một lệnh dựng database, tạo bảng rồi chạy app.

```bash
cp .env.example .env
```

Điền `.env`: `REPLY_DB_PASSWORD` (mật khẩu mạnh bất kỳ), `APP_PASSCODE`, `APP_SESSION_SECRET`, `REPLY_ANTHROPIC_API_KEY`, tùy chọn `VOYAGE_API_KEY` và `APP_PORT`. Không cần sửa `DATABASE_URL`: ở chế độ này nó được ghép từ mật khẩu và trỏ vào container `db`.

```bash
docker compose up -d --build
docker compose ps          # app phải chuyển sang "healthy"
```

Mở `http://localhost:3000` (hoặc `APP_PORT`) rồi đăng nhập. `db` không mở cổng ra ngoài, `migrate` chạy một lần rồi thoát (migration đã áp dụng thì bỏ qua), `app` chỉ khởi động sau khi `migrate` thành công. Cập nhật: lấy code mới rồi chạy lại `docker compose up -d --build`. Dừng: `docker compose down` (giữ dữ liệu; `down -v` mới xóa).

Trên server hãy đặt reverse proxy có HTTPS phía trước (Caddy, Nginx, Traefik), đừng mở cổng trực tiếp, và tắt buffer của proxy để reply hiện dần từng phần.

Nếu đã có database (ví dụ Neon): chỉ build image và chạy với `DATABASE_URL` của bạn (`docker build -t reply-assistant .` rồi `docker run -d -p 3000:8080 --env-file .env reply-assistant`), migrate một lần như các bước Railway bên dưới. Postgres trong mạng riêng thì thêm `?sslmode=disable` vào cuối URL; host khác luôn dùng TLS.

### Biến môi trường

Đặt trong `.env` / `.env.local` (local) hoặc Railway Variables (production). Không commit giá trị thật.

| Biến | Bắt buộc | Mặc định | Dùng để |
|---|---|---|---|
| `DATABASE_URL` | có | — | Postgres (Neon). Remote cần `?sslmode=require` |
| `APP_PASSCODE` | có | — | Passcode đăng nhập. Dùng ≥ 16 ký tự ngẫu nhiên |
| `APP_SESSION_SECRET` | có | — | Ký cookie đăng nhập, ≥ 32 ký tự ngẫu nhiên |
| `REPLY_ANTHROPIC_API_KEY` | không | dùng `ANTHROPIC_API_KEY` | Key riêng cho reply để đặt spend limit riêng |
| `VOYAGE_API_KEY` | không | — | Thiếu thì Use memory báo "chưa cài" và ghi chú lưu không có vector (chỉ tìm theo nghĩa được khi có) |
| `REPLY_EMBED_MODEL` | không | `voyage-3.5-lite` | Embedding (1024 chiều) |
| `REPLY_EMBED_RPM` | không | `3` | Số request embedding tối đa mỗi phút. Mặc định là giới hạn của tài khoản Voyage **chưa thêm thẻ** (3 request/phút). App tự giữ mình trong mức này, gọi vượt thì bỏ qua thay vì bị 429. Tài khoản có thẻ: đặt cao hơn (ví dụ `2000`) |
| `REPLY_EMBED_TPM` | không | `10000` | Số token embedding tối đa mỗi phút, cùng ý nghĩa như trên (tài khoản có thẻ: ví dụ `1000000`) |
| `REPLY_MODEL_FAST` | không | `claude-haiku-4-5` | Đường nhanh |
| `REPLY_MODEL_SMART` | không | `claude-sonnet-5-5` | Thread dài, nút Better, tin dán có ghi chú (Auto) |
| `REPLY_MODEL_SUMMARY` | không | `claude-haiku-4-5` | Tóm tắt thread |
| `REPLY_MODEL_STYLE` | không | `claude-sonnet-5-5` | Tạo style profile |
| `REPLY_MODEL_EXPLAIN` | không | `claude-haiku-4-5` | Dịch và giải thích tin nhắn đã dán |
| `REPLY_MODEL_NOTES` | không | `claude-haiku-4-5` | Ghi chú: bản tiếng Anh, tách nhật ký, đề xuất ghi chú từ lời bạn gõ |
| `REPLY_SMART_EFFORT` | không | `low` | `low` / `medium` / `high` |
| `REPLY_SMART_THINKING` | không | `adaptive` | hoặc `between_tools` |
| `REPLY_SELF_NAMES` | không | rỗng | Tên bạn trong chat đã dán (cách nhau dấu phẩy) để dòng của bạn được gắn "Me" |
| `REPLY_DAILY_BUDGET_USD` | không | `2` | Hết ngân sách (tính theo ngày UTC, cộng mọi lệnh gọi trả tiền) thì request mới bị từ chối |

Tạo giá trị ngẫu nhiên:

```bash
openssl rand -base64 24   # APP_PASSCODE
openssl rand -base64 48   # APP_SESSION_SECRET
```

### Chạy local với Postgres trong Docker

Cài Docker trước:

- **macOS only:** Docker Desktop hoặc OrbStack, mở app lên trước khi chạy compose.
- **Ubuntu only:** `sudo apt-get install docker.io docker-compose-v2`, rồi `sudo usermod -aG docker $USER` và đăng nhập lại.
- **Fedora only:** cài Docker CE từ repo dnf của Docker (`sudo dnf install docker-ce docker-compose-plugin`), rồi `sudo systemctl enable --now docker`.

Các bước sau giống nhau trên cả 3 OS:

```bash
docker compose -f compose.dev.yml up -d --wait
```

Compose đọc `REPLY_DB_PASSWORD` từ `.env` và mở cổng `5433`. Postgres bỏ qua mật khẩu mới nếu volume đã
tồn tại — muốn đổi thì `docker compose -f compose.dev.yml down -v` (xóa dữ liệu local).

**Luôn truyền URL local trực tiếp khi chạy lệnh DB**, đừng tin `.env` — `drizzle-kit` tự đọc `.env`
và có thể trỏ vào database thật:

```bash
DATABASE_URL=postgres://reply:<REPLY_DB_PASSWORD>@127.0.0.1:5433/reply npm run db:migrate
```

Dòng `[drizzle] database target: 127.0.0.1:5433/reply` phải hiện ra; nếu host khác thì dừng lại.
`drizzle.config.ts` từ chối migrate vào host không phải local trừ khi có `ALLOW_REMOTE_MIGRATE=1`.

Để chạy app với DB local mà không đụng `.env`, tạo `.env.local` (đã bị gitignore, Next ưu tiên hơn `.env`)
chứa `DATABASE_URL`, `APP_PASSCODE`, `APP_SESSION_SECRET`, rồi `npm run dev`. Xóa file này khi xong.

### Production: Railway + Neon

Bạn tự làm các bước này (assistant không chạy lệnh vào database hay deploy thật):

1. **Neon**: tạo database (chọn vùng gần bạn, có pgvector). Dùng một branch `dev` cho local và `main` cho dùng thật,
   để dữ liệu thử không lẫn vào memory. Lấy URL **direct** (không phải `-pooler`) cho migration, thêm `?sslmode=require`.
   Đừng thêm `channel_binding=require` (postgres.js không hỗ trợ).
2. **Migration** (chạy từ máy bạn, mỗi khi có file mới trong `drizzle/`, **trước khi deploy code mới**, và cho mọi
   branch Neon sẽ chạy code này). Hiện có bốn file: `0000_reply_foundation`; **`0001_reply_usage_and_explanation`**
   (bảng `reply_usage`, cột `generations.explanation`, chép chi phí cũ sang); **`0002_reply_refine`** (cột để lưu reply
   đã phát triển và hướng của nó, loại chi phí `refine`); **`0003_reply_notes`** (bảng `profile_notes`, cột
   `generations.note_ids`, loại chi phí `notes`). Code ghi các cột này ở **mọi request**, nên deploy trước khi migrate là lỗi
   ngay request đầu, không chỉ riêng Develop hay ghi chú. Các migration chỉ **thêm**, không xóa gì:

   ```bash
   DATABASE_URL='<neon direct url>?sslmode=require' ALLOW_REMOTE_MIGRATE=1 npm run db:migrate
   ```

   Đọc dòng `[drizzle] database target:` trước khi tin kết quả. Kiểm tra: trong Neon SQL editor,
   `select extname from pg_extension` có `vector`, và bảng `profile_notes` tồn tại.
3. **Railway Variables** của service reply-assistant: đặt các biến ở bảng trên. `DATABASE_URL` là URL Neon `main`
   (có thể dùng URL pooled ở đây, app tự tắt prepared statements). Health check đã trỏ vào `/api/health`.
4. **Anthropic Console**: tạo key riêng cho reply (`REPLY_ANTHROPIC_API_KEY`) và đặt **spend limit** hàng tháng.
   Đây là chốt chặn cuối cùng nếu passcode bị lộ; `REPLY_DAILY_BUDGET_USD` chỉ đếm request đã ghi trong DB.
5. **Backfill embedding** (chỉ khi có request lưu trước khi có `VOYAGE_API_KEY`; script chạy từng request một, cách nhau khoảng 30 giây theo `REPLY_EMBED_RPM`; script vẫn đọc `VOYAGE_API_KEY` từ `.env`, còn `DATABASE_URL` truyền trực tiếp thì được ưu tiên):

   ```bash
   DATABASE_URL='<neon url>?sslmode=require' ALLOW_REMOTE_BACKFILL=1 npx tsx scripts/reply-backfill-embeddings.ts
   ```

6. **Smoke test sau deploy**:
   - `/api/health` trả `{"status":"ok"}` mà không cần đăng nhập; mọi trang khác chuyển sang `/login`.
   - Đăng nhập → viết 1 reply: phương án hiện dần từng phần (nếu hiện một lần là stream bị đệm giữa chừng).
   - Rate 👍 → mở `/reply/stats` thấy số tăng. **Sign out** (menu bên trái, hoặc **More** trên điện thoại) quay về `/login`.

### Voyage: có nên thêm thẻ thanh toán?

Tài khoản Voyage **chưa có thẻ** bị giới hạn **3 request/phút và 10.000 token/phút** (đã kiểm tra bằng API). App tự
giữ mình trong mức đó: gom nhiều ghi chú vào một request, tách "đường chờ" (tra memory và ghi chú lúc viết reply) khỏi
"đường nền" (lập chỉ mục), và **bỏ qua** một lần tra thay vì bị 429. Dùng bình thường vẫn ổn; khi hết lượt trong phút,
memory/ghi chú bị bỏ qua cho request đó và được lập chỉ mục bù sau.

Thêm thẻ chỉ để bỏ giới hạn này, không bắt buộc. Nếu thêm: đặt `REPLY_EMBED_RPM` và `REPLY_EMBED_TPM` cao hơn
(ví dụ `2000` và `1000000`). Lưu ý nạp tiền trước ở Voyage **không phải là mức chi tiêu tối đa cứng**; nếu lo, hãy dùng
thẻ ảo có hạn mức. Bộ giới hạn nằm trong từng process: dev, script và production dùng chung một key thì chung
một hạn mức, thỉnh thoảng vẫn có thể gặp 429 thật (app xử lý như cũ).

### Bảo mật

- Cả app nằm sau passcode (trừ `/login` và `/api/health`), vì các endpoint reply tốn tiền API.
- Đăng nhập sai 5 lần từ một client thì khóa 15 phút, và tổng 20 lần sai từ mọi nguồn cũng khóa 15 phút
  (header `x-forwarded-for` có thể bị giả nên không chỉ dựa vào IP). Giới hạn này nằm trong bộ nhớ của process:
  restart là xóa. Nếu bị khóa nhầm, đợi hoặc restart service.
- Passcode ngắn hơn 16 ký tự vẫn chạy nhưng log cảnh báo `[auth] APP_PASSCODE is shorter than 16 characters`.
- Cookie đăng nhập sống 30 ngày. Muốn đăng xuất mọi nơi: đổi `APP_SESSION_SECRET`.
- Tin nhắn đã dán được gửi tới Anthropic (và Voyage nếu bật memory) và lưu trong Postgres. Đừng dán thông tin
  khách hàng hoặc bí mật công ty; kiểm tra chính sách dùng AI của nơi bạn làm. Xóa thread sẽ xóa luôn các reply của nó.

**Mỗi lệnh gọi gửi gì, cho ai** (đã đối chiếu với code):

| Lệnh gọi | Gửi cho Anthropic | Gửi cho Voyage |
|---|---|---|
| Viết reply / Develop | Ý bạn gõ hoặc đoạn chat dán + tóm tắt thread, quy tắc style profile đang bật, ghi chú **không private, đang dùng, đúng scope** (ghim và ghi chú hợp), ví dụ memory (ý và reply cũ), ngày hôm nay | Ý bạn gõ, hoặc 600 ký tự cuối của đoạn dán (để tra memory và ghi chú) |
| Giải thích tin nhắn / tóm tắt thread | Tin nhắn đã dán / các tin cũ của thread | — |
| Tạo style profile | Reply bạn đã sửa, 👍, 👎, ý bạn gõ và hướng Develop (cắt 400 ký tự mỗi mục); **không bao giờ** tin nhắn dán của người khác | — |
| Ghi chú: bản tiếng Anh, tách nhật ký | Chỉ ghi chú hoặc nhật ký bạn chọn gửi; **không bao giờ** ghi chú private | — |
| Lập chỉ mục ghi chú | — | Bản gốc và bản tiếng Anh của ghi chú **không private** |
| Đề xuất ghi chú (Inbox) | Ý bạn gõ hoặc hướng Develop bạn gõ (tối đa 1.500 ký tự); không bao giờ tin dán, không gì khi Learn tắt | Các sự thật được đề xuất (bản gốc và tiếng Anh) |
| Warm-up | Quy tắc style profile + ghi chú ghim của scope đang dùng | — |

**Không bao giờ được gửi đi:** ghi chú private (và vector của nó, vì không có), ghi chú khác scope, ghi chú đã lưu trữ,
gợi ý chưa duyệt hoặc đã bỏ qua. Danh sách này nằm ở **một chỗ** trong code (các câu truy vấn của `notes-read.ts`) và được kiểm
tra bằng dữ liệu thật. Ngoại lệ phải biết: một reply đã viết ra (và các ví dụ memory lấy từ nó) có thể nhắc một chi tiết từ
ghi chú lúc nó còn được dùng; đổi ghi chú thành private không xóa được chữ đã nằm trong reply cũ.

### Sự cố thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `db:migrate` thoát ngay, không in lỗi | Thiếu TLS: URL remote cần `?sslmode=require` |
| Request đầu tiên sau lúc rảnh chậm | Neon tự ngủ khi không dùng; lần gọi đầu đánh thức nó |
| Memory báo "skipped" | Đã dùng hết ngân sách embedding của phút đó (mặc định 3 request/phút, `REPLY_EMBED_RPM`). App bỏ qua memory cho request này và tự embed bù sau response (gom nhiều request vào một lần gọi). Thử lại sau chừng một phút. Muốn nới: thêm thẻ ở Voyage rồi tăng `REPLY_EMBED_RPM` / `REPLY_EMBED_TPM` |
| Ghi chú "not searchable yet" | Lưu lúc hết ngân sách embedding. Mở lại trang About me là app tự embed bù (một request); hoặc chạy `scripts/reply-backfill-note-embeddings.ts` |
| Tin nhắn của mình trong chat dán vào bị gắn "Them" | Đặt `REPLY_SELF_NAMES` bằng tên bạn hiện trong chat |
| "The daily spending limit for replies is reached" | Đã chạm `REPLY_DAILY_BUDGET_USD`; reset lúc 00:00 UTC |
| Inbox "Suggested notes" trống dù đã gõ chuyện về mình | Chỉ ý gõ và hướng Develop mới được đọc; Learn phải bật; ý ngắn dưới 15 ký tự, Inbox đã đủ 20 mục, hoặc đã chạm ngân sách ngày thì bị bỏ qua. Câu thoáng qua ("mai mình đến muộn"), chuyện người khác và thứ chỉ suy ra được không được đề xuất |
| Gợi ý trùng với ghi chú đã có | Trùng nguyên văn (bỏ dấu, hoa thường) thì bị loại, và nghĩa gần giống (≥ 0,80) cũng vậy khi có vector; nói khác đi nhiều thì có thể lọt. Bấm **Dismiss**, app nhớ và không đề xuất lại |
| Style profile báo "Not enough rated or edited replies" | Cần ít nhất 5 reply đã sửa hoặc rate (từ request để Learn bật) |
