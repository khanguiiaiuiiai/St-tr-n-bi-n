# RAFT: OCEAN SURVIVORS — online trên Render

## Chạy thử trên máy
    npm install
    npm start          # mở http://localhost:3000

## Đưa lên Render
1. Tạo repo GitHub, đẩy toàn bộ thư mục này lên (có `public/index.html`, `server.js`, `package.json`, `render.yaml`).
2. Vào render.com → New → Blueprint (hoặc Web Service) → chọn repo.
   Nếu tạo Web Service thủ công: Build `npm install`, Start `npm start`, Health Check `/healthz`.
3. Deploy xong có link `https://ten-app.onrender.com`. Mở link đó, bạn bè mở cùng link.
4. Một người tạo map (tên + mật khẩu), người kia chọn "Vào map" và nhập tên/mã mời + mật khẩu.

## Lưu ý
- Gói Free ngủ sau ~15 phút không có ai, lần mở đầu mất ~30 giây.
- Gói Free không có ổ đĩa bền: map trên server mất khi khởi động lại. Client tự đẩy lại map mỗi lần vào/thoát,
  và map vẫn nằm ở localStorage của người tạo. Muốn bền hẳn: gắn Render Disk và đặt biến `DATA_DIR` trỏ tới nó.
