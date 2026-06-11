# ==========================================
# GIAI ĐOẠN 1: DỰNG ỨNG DỤNG (BUILD ENGINE)
# ==========================================
FROM node:20-slim AS builder

WORKDIR /app

# Sao chép các tệp cấu hình package để cài đặt dependencies
COPY package*.json ./

# Cài đặt toàn bộ dependencies (bao gồm cả devDependencies cần thiết để chạy npm run build)
RUN npm install

# Sao chép toàn bộ mã nguồn của ứng dụng (ngoại trừ các thư mục đã bị loại bỏ trong .dockerignore)
COPY . .

# Tiến hành biên dịch Front-end (Vite) và Back-end (esbuild ra dist/server.cjs)
RUN npm run build


# ==========================================
# GIAI ĐOẠN 2: CHẠY THỰC TẾ (PRODUCTION RUNNER)
# ==========================================
FROM node:20-slim AS runner

WORKDIR /app

# Đặt biến môi trường production nhằm tăng tốc vận hành và tắt các cảnh báo dev
ENV NODE_ENV=production

# Sao chép các file thực thi và config đã qua biên dịch từ Giai đoạn 1 sang
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist

# Sao chép cấu hình Firebase hoặc tệp dữ liệu cục bộ dự phòng (sử dụng wildcard * để tránh lỗi dừng build nếu tệp chưa khởi tạo)
COPY --from=builder /app/db.json* ./
COPY --from=builder /app/firebase-applet-config.json* ./
COPY --from=builder /app/firestore.rules* ./

# Tạo thư mục uploads tĩnh để phục vụ lưu trữ tài liệu tệp tin nội bộ
RUN mkdir -p uploads

# Chỉ cài đặt dependencies cần thiết cho runtime (loại bỏ devDependencies giúp Docker Image cực kỳ gọn nhẹ)
RUN npm install --only=production

# Thiết lập cổng mặc định mà Cloud Run sẽ tự động lắng nghe (Port 8080)
EXPOSE 8080

# Khởi chạy ứng dụng Express server đã bundled
CMD ["npm", "start"]
