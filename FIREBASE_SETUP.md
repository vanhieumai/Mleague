# Bật tài khoản, lưu giải và chia sẻ MLeague

MLeague dùng Firebase Authentication và Cloud Firestore. Trước khi các chức năng tài khoản hoạt động:

1. Tạo Firebase project và thêm một Web App trong Firebase Console.
2. Trong **Authentication → Sign-in method**, bật **Email/Password**.
3. Trong **Firestore Database**, tạo database và áp dụng nội dung [firestore.rules](./firestore.rules).
4. Sao chép cấu hình Web App vào [firebase-config.js](./firebase-config.js): `apiKey`, `authDomain`, `projectId`, `appId` và các trường còn lại Firebase cung cấp.
5. Triển khai MLeague trên HTTPS và thêm tên miền vào **Authentication → Settings → Authorized domains**.

`firebase-config.js` chỉ chứa cấu hình Firebase Web App, không chứa mật khẩu hay service-account private key. Không đưa service-account key vào trình duyệt.

Sau khi cấu hình:

- Người dùng có thể đăng ký/đăng nhập bằng email và mật khẩu.
- Giải đấu được lưu trong vùng dữ liệu riêng của tài khoản; các thay đổi sau đó tự lưu.
- Chủ giải có thể chia sẻ link công khai. Link chỉ đọc, không thể chỉnh sửa; liên hệ của chủ giải không được đưa vào bản công khai.
- Chủ giải có thể tắt chia sẻ từ danh sách giải đã lưu; link cũ sẽ không còn đọc được.

Khi mở trực tiếp bằng `file://`, Firebase module không hoạt động ổn định. Hãy chạy qua máy chủ web cục bộ hoặc triển khai HTTPS để kiểm thử tính năng tài khoản và liên kết chia sẻ.
