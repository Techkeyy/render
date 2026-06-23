# render — backend container (seller + orchestrator in one process)
# Slim Node base; Playwright installs Chromium AND its system libraries.
FROM node:20-bookworm-slim

WORKDIR /app

# Skip the browser download during `npm ci` — we install Chromium explicitly
# below (with --with-deps) so the OS libraries come along too.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Chromium + the apt packages it needs to run headless in a container.
RUN npx playwright install --with-deps chromium

COPY . .

ENV NODE_ENV=production \
    RENDER_SERVICE_PORT=4000 \
    RENDER_SERVICE_URL=http://127.0.0.1:4000

# Render injects $PORT at runtime; the orchestrator binds it (see config.ts).
# This is documentation only — Render maps the port automatically.
EXPOSE 10000

# One process, both services: seller internal on :4000, orchestrator on :$PORT.
CMD ["npx", "tsx", "src/serve.ts"]
