# Kubernetes DB + Prisma 연동 가이드

## 1) DB 리소스 배포

```bash
kubectl apply -k k8s/database/overlays
```

## 2) 백엔드 Deployment에 DATABASE_URL 연결

백엔드 컨테이너 env에 아래를 추가하세요.

```yaml
env:
  - name: DATABASE_URL
    valueFrom:
      secretKeyRef:
        name: app-db-secret
        key: DATABASE_URL
```

## 3) Prisma 마이그레이션 반영

백엔드 이미지/Pod에서 아래 명령을 실행하세요.

```bash
bunx prisma migrate deploy
```

필요 시 시드:

```bash
bun run db:seed
```

## 4) AI/GPS API Key 주입 (app-db-secret)

`app-db-secret`에 아래 값을 넣어주세요.

- `GPS_API_KEY`
- `GPS_GEOCODE_URL` (기본값: `https://maps.googleapis.com/maps/api/geocode/json`)
- `GPS_REVERSE_GEOCODE_URL` (기본값: `https://maps.googleapis.com/maps/api/geocode/json`)
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (예: `gemini-2.5-flash`)
- `GEMINI_BASE_URL` (기본값: `https://generativelanguage.googleapis.com`)

예시:

```bash
kubectl patch secret app-db-secret -n goormthon-6 --type merge -p '{
  "stringData": {
    "GPS_API_KEY": "YOUR_GPS_KEY",
    "GPS_GEOCODE_URL": "https://maps.googleapis.com/maps/api/geocode/json",
    "GPS_REVERSE_GEOCODE_URL": "https://maps.googleapis.com/maps/api/geocode/json",
    "GEMINI_API_KEY": "YOUR_GEMINI_KEY",
    "GEMINI_MODEL": "gemini-2.5-flash",
    "GEMINI_BASE_URL": "https://generativelanguage.googleapis.com"
  }
}'
```
