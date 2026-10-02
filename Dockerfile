# ---------- Build stage ----------
FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . ./
RUN npm run build

# ---------- Migration stage ----------
# Not the default target. Used by docker-compose.yml to create the tables:
#   docker build --target migrator ...
# It has the full source and dev dependencies, which the runtime image does not.
FROM builder AS migrator
CMD ["npm", "run", "db:migrate"]

# ---------- Runtime stage (the default: the last stage) ----------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Next.js standalone server (no full node_modules) plus its static assets.
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

ENV PORT=8080
# The Next.js standalone server binds to HOSTNAME (not HOST). Docker sets HOSTNAME to the
# container id, which would leave the server unreachable on 127.0.0.1 (and the healthcheck failing).
ENV HOSTNAME=0.0.0.0
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/api/health || exit 1

CMD ["node", "server.js"]
