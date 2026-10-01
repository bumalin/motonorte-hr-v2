# Motonorte Payroll — one image for the app, migrations and create-user (TASK-021).
# Plain `next start` with production node_modules (no standalone trimming: 3 users, simplicity wins).

FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 TZ=Asia/Manila
RUN addgroup -S app && adduser -S app -G app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY next.config.ts tsconfig.json ./
COPY db ./db
COPY lib ./lib
COPY scripts/create-user.ts ./scripts/create-user.ts
RUN chown -R app:app /app/.next
USER app
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
