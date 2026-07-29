# FaceHub ERP — Backend

Node.js + Express + TypeScript + Prisma (MySQL) API. Phase 1 foundation: JWT auth (access + refresh), RBAC scaffolding, and Super Admin Organization management. See `../loyixa.md` for the full product spec and `../README.md` for what's built vs. planned.

## Setup

```bash
cp .env.example .env      # edit DATABASE_URL / secrets as needed
docker compose up -d      # local MySQL + Redis
npm install
npm run prisma:migrate    # creates tables
npm run prisma:seed       # creates the super admin (see console output for credentials)
npm run dev                # http://localhost:4001, docs at /api/docs
```

## Scripts

- `npm run dev` — tsx watch mode
- `npm run build` / `npm start` — production build + run
- `npm run prisma:studio` — inspect data visually
- `npm run lint` — ESLint
