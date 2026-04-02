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

## 4) AI/GPS API Key 주입 (app-ai-secret)

`app-db-secret`는 DB 연결 전용으로 유지하고, AI/GPS 키는 별도 `app-ai-secret`으로 관리하세요.

- `GPS_API_KEY`
- `GPS_GEOCODE_URL` (기본값: `https://maps.googleapis.com/maps/api/geocode/json`)
- `GPS_REVERSE_GEOCODE_URL` (기본값: `https://maps.googleapis.com/maps/api/geocode/json`)
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (예: `gemini-2.5-flash`)
- `GEMINI_BASE_URL` (기본값: `https://generativelanguage.googleapis.com`)
- `TOUR_API_KEY` (한국관광공사 TourAPI 서비스키)
- `TOUR_API_BASE_URL` (기본값: `https://apis.data.go.kr/B551011/KorService2/locationBasedList2`)
- `TOUR_API_MOBILE_OS` (기본값: `ETC`)
- `TOUR_API_MOBILE_APP` (기본값: `JejuReVillage`)
- `TOUR_API_RADIUS_METERS` (기본값: `3000`)
- `TOUR_API_NUM_ROWS` (기본값: `5`)

예시:

```bash
kubectl create secret generic app-ai-secret -n goormthon-6 \
  --from-literal=GPS_API_KEY='YOUR_GPS_KEY' \
  --from-literal=GPS_GEOCODE_URL='https://maps.googleapis.com/maps/api/geocode/json' \
  --from-literal=GPS_REVERSE_GEOCODE_URL='https://maps.googleapis.com/maps/api/geocode/json' \
  --from-literal=GEMINI_API_KEY='YOUR_GEMINI_KEY' \
  --from-literal=GEMINI_MODEL='gemini-2.5-flash' \
  --from-literal=GEMINI_BASE_URL='https://generativelanguage.googleapis.com' \
  --from-literal=TOUR_API_KEY='YOUR_TOUR_API_KEY' \
  --from-literal=TOUR_API_BASE_URL='https://apis.data.go.kr/B551011/KorService2/locationBasedList2' \
  --from-literal=TOUR_API_MOBILE_OS='ETC' \
  --from-literal=TOUR_API_MOBILE_APP='JejuReVillage' \
  --from-literal=TOUR_API_RADIUS_METERS='3000' \
  --from-literal=TOUR_API_NUM_ROWS='5' \
  --dry-run=client -o yaml | kubectl apply -f -
```
