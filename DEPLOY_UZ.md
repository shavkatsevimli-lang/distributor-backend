# DistributorPro Render Deploy

## 1. Renderga qaysi papkani ulang

Repo ichida backend papka:

`backend-app`

## 2. Render build/start

- Build Command: `npm install && npm run build`
- Start Command: `npm run start:prod`

## 3. Render Environment Variables

Quyidagilarni kiriting:

```env
PORT=10000
OWNER_PHONE=111
OWNER_PASSWORD=111
OWNER_FULL_NAME=Platform Owner
ADMIN_PHONE=999
ADMIN_PASSWORD=999
ADMIN_STATUS_KEY=
CLIENT_PHONE=998901234567
CLIENT_PASSWORD=12345
DATABASE_URL=postgresql://...
CORS_ORIGIN=*
```

## 4. Deploy tekshirish

Deploy bo'lgandan keyin brauzerda oching:

`https://YOUR-RENDER-URL/version`

Javobda shu ko'rinishi kerak:

- `ownerLoginEnabled: true`
- `version: 2026.04.20-owner-panel`

## 5. Owner login

- Telefon: `111`
- Parol: `111`

## 6. Agar 401 chiqsa

Demak Renderda eski kod turibdi yoki env yozilmagan.
