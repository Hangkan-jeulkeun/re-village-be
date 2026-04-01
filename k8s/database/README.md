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
