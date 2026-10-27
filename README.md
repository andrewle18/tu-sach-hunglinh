# Tủ sách Hùng Linh

Site: https://small-voice-4cb4.lehunglinh18.workers.dev

**Thêm sách = thả một thư mục có file EPUB vào `public/books/`. Xoá sách = xoá thư mục đó.** Mọi thứ khác (thẻ sách, bìa, mục lục, nội dung đọc online, số chương, số từ) Cloudflare tự làm mỗi lần anh lưu thay đổi trên GitHub. Khoảng 1 đến 2 phút sau là site cập nhật.

---

## A. Thêm một cuốn sách

1. Trên máy, tạo một thư mục cho cuốn sách. **Tên thư mục viết không dấu, nối bằng gạch ngang**, ví dụ `cai-thuoc-ve-ta`. Tên này sẽ nằm trong đường link đọc sách.
2. Bỏ vào thư mục:
   - file `.epub` (bắt buộc, tên gì cũng được)
   - file `.pdf` (nếu có; không có thì site tự ẩn nút PDF)
   - `thong-tin.txt` (không bắt buộc, xem mục D)
   - `cover.png` hoặc `cover.jpg` (không bắt buộc; không có thì lấy bìa trong EPUB)
3. Vào repo trên github.com, bấm lần lượt vào thư mục `public`, rồi `books`.
4. Bấm nút **Add file** (góc trên bên phải) → **Upload files**.
5. **Kéo nguyên thư mục** (không phải từng file) từ máy thả vào trang. GitHub giữ nguyên tên thư mục.
6. Kéo xuống dưới, bấm nút xanh **Commit changes**.

Xong. Muốn xem tiến trình: Cloudflare → `small-voice-4cb4` → tab **Deployments**.

Giới hạn: mỗi file tối đa 25 MB (giới hạn của cả GitHub khi tải qua trình duyệt lẫn Cloudflare).

## B. Xoá một cuốn sách

1. Trên GitHub, vào `public` → `books` → bấm vào thư mục cuốn cần xoá.
2. Bấm nút **…** (ba chấm, góc trên bên phải) → **Delete directory**.
3. Bấm **Commit changes**.

Chỉ muốn **ẩn tạm** mà không xoá: mở `thong-tin.txt` của cuốn đó, thêm một dòng `an: co`. Muốn hiện lại thì xoá dòng đó.

## C. Thay file (bản EPUB/PDF mới, bìa mới)

1. Vào đúng thư mục cuốn sách trên GitHub.
2. **Add file** → **Upload files** → thả file mới vào → **Commit changes**.
   - Cùng tên với file cũ: GitHub tự ghi đè.
   - Khác tên: xoá file cũ đi (bấm vào file → **…** → **Delete file** → Commit), vì mỗi thư mục chỉ nên có một EPUB và một PDF.

Lưu ý riêng hai cuốn cũ (Tôn giáo thế giới, Triết học): trong thư mục có `content.js` làm tay từ trước, site dùng file này để đọc online. Nếu thay EPUB mới cho hai cuốn này, xoá luôn `content.js` để site đọc theo EPUB mới.

## D. Sửa tên, giới thiệu, thứ tự trên kệ: file `thong-tin.txt`

Mỗi dòng một mục, dạng `ten-muc: nội dung`. Dòng nào bỏ trống thì site tự lấy từ EPUB.

```
tieu-de: Cái Thuộc Về Ta
phu-de: Chủ nghĩa Khắc kỷ từ Athens tới mạng xã hội
tac-gia: Lê Hùng Linh
nam: 2026
nhan: Sách phổ thông
thu-tu: 1
gioi-thieu: Một đoạn giới thiệu ngắn hiện trên thẻ sách, viết liền trên một dòng.
```

- `nhan`: chữ nhỏ màu vàng phía trên tên sách (mặc định "Sách"; ví dụ "Giáo trình", "Tiểu thuyết").
- `thu-tu`: số nhỏ đứng trước trên kệ. Không ghi thì xếp theo tên, sau các cuốn có số.
- `gioi-thieu`: không ghi thì lấy phần mô tả trong EPUB (nếu có).
- Có thể thêm `so-chuong: 40` hoặc `so-tu: ≈ 85.700` nếu muốn ghi đè con số tự đếm.
- `an: co` để ẩn cuốn sách.

Sửa trực tiếp trên GitHub: bấm vào file `thong-tin.txt` → biểu tượng **bút chì** → sửa → **Commit changes**. Chưa có file thì trong thư mục sách bấm **Add file** → **Create new file**, đặt tên `thong-tin.txt`.

---

## Cài đặt lần đầu (chỉ làm một lần)

### Bước 1. Tạo repo và tải code lên GitHub

1. Vào github.com, đăng nhập. Bấm dấu **+** góc trên bên phải → **New repository**.
2. Repository name: `tu-sach-hunglinh`. Chọn **Private** (hoặc Public tuỳ anh). **Không** tick "Add a README". Bấm **Create repository**.
3. Ở trang repo trống, bấm dòng chữ **uploading an existing file**.
4. Giải nén file zip trên máy, mở thư mục `tu-sach-hunglinh`, **chọn tất cả bên trong** (`public`, `scripts`, `src`, `README.md`, `wrangler.toml`, `package.json`, `package-lock.json`, `.gitignore`) rồi kéo thả vào trang. Trên Mac, file `.gitignore` bị ẩn, bấm `Cmd + Shift + .` trong Finder để hiện (thiếu file này cũng không sao).
5. Bấm **Commit changes**. Đợi tải xong (khoảng 4 MB).

### Bước 2. Nối GitHub vào Worker trên Cloudflare

1. Vào dash.cloudflare.com → **Workers & Pages** → bấm `small-voice-4cb4`.
2. Tab **Settings** → kéo tới mục **Build** → dòng **Git repository** → bấm **Connect**.
3. Chọn **GitHub**. Lần đầu sẽ mở cửa sổ cài ứng dụng "Cloudflare Workers and Pages" vào GitHub: chọn tài khoản của anh, cho phép truy cập repo `tu-sach-hunglinh` (hoặc All repositories) → **Install & Authorize**.
4. Quay lại Cloudflare, chọn repository `tu-sach-hunglinh`, nhánh `main`.
5. Build configuration:
   - Build command: **để trống**
   - Deploy command: `npx wrangler deploy`
   - Root directory / Path: `/`
6. Bấm **Connect** (hoặc **Save**). Cloudflare build và deploy lần đầu ngay. Xem ở tab **Deployments**; dòng trạng thái chuyển sang Success là xong.

Nếu build báo lỗi, bấm vào lần build đó → **View build log**, chụp màn hình gửi lại.

### Bước 3. Bật ô chat (nhận tin nhắn của độc giả qua Telegram)

Tạo bot (bỏ qua nếu đã có bot từ lần trước):

1. Trong Telegram, tìm **@BotFather** → gửi `/newbot` → đặt tên → đặt username kết thúc bằng `bot`.
2. BotFather trả về token dạng `123456789:AAE...`. Đây là **TELEGRAM_BOT_TOKEN**.
3. Tìm **@userinfobot** → bấm Start → nó trả về `Id` (dãy số). Đây là **TELEGRAM_CHAT_ID**.
4. Mở cuộc trò chuyện với bot vừa tạo, bấm **Start** một lần (bắt buộc, không thì bot không nhắn được cho anh).

Đặt vào Cloudflare:

1. `small-voice-4cb4` → **Settings** → **Variables and Secrets** → **+ Add**.
2. Type: **Secret**. Variable name: `TELEGRAM_BOT_TOKEN`. Value: dán token. 
3. **+ Add** thêm cái thứ hai: Type **Secret**, name `TELEGRAM_CHAT_ID`, value là dãy số Id.
4. Bấm **Deploy** (hoặc **Save and deploy**).

Mở site, bấm nút tròn góc dưới bên phải, gửi thử một tin. Tin sẽ vào Telegram của anh. Ô chat là một chiều: anh trả lời độc giả qua email/số điện thoại họ để lại.

**Đừng dùng nút "New deployment" kéo thả thư mục nữa.** Cách đó chỉ đưa file tĩnh lên, bỏ qua bước tự dựng kệ sách và ô chat. Từ giờ mọi thay đổi đi qua GitHub.

---

## Cho người rành kỹ thuật

```
npm install
npm run build          # dựng kệ sách từ public/books/ (sinh public/books.js và */auto/)
npx wrangler dev       # chạy thử ở http://localhost:8787 (tự build trước)
npx wrangler deploy    # deploy tay, không qua GitHub
```

- `scripts/build.mjs`: đọc từng EPUB (không cần thư viện ngoài), tách theo mục lục thành phần/chương, xuất hình ảnh, lấy bìa, đếm chương và từ, viết `public/books.js`. `wrangler.toml` khai báo `[build] command` nên script tự chạy trước mỗi `wrangler deploy`/`wrangler dev`.
- `src/index.js`: Worker nhận `POST /api/message` (honeypot, giới hạn 5 tin/phút/IP) rồi gửi về Telegram. Mọi đường dẫn khác phục vụ thẳng từ `public/`.
- Thử ô chat trên máy: tạo `.dev.vars` gồm `TELEGRAM_BOT_TOKEN=...` và `TELEGRAM_CHAT_ID=...` (đã nằm trong `.gitignore`).

© 2026 Hùng Linh.
