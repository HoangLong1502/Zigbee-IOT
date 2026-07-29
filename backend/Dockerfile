# --- build stage ------------------------------------------------------------
FROM node:22-alpine AS builder

WORKDIR /app

# Build toolchain for the optional native `serialport` dependency
RUN apk add --no-cache python3 make g++ linux-headers

COPY package*.json ./
RUN npm install --no-audit --no-fund

COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build

# --- runtime stage ----------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache python3 make g++ linux-headers

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/main.js"]
