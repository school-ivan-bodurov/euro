# Backend (OCR API)

## Start (dev)
```bash
cd backend
npm install
npm run dev
```

## Start (prod)
```bash
cd backend
npm install
npm start
```

### Endpoints
- `GET /api/health` → `{ ok, rate }`
- `GET /api/convert?amount=12.34&from=BGN` → `{ bgn, eur }`
- `POST /api/ocr` (multipart field `image`) → OCR + кандидати за цена
