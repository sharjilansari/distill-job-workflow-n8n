# Playwright's own image already carries the browsers and every system library
# they need — building from node:alpine means chasing missing .so files forever.
FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY src ./src

# Persisted browser sessions and submission screenshots live on volumes so a
# container restart does not log you out of every job board.
RUN mkdir -p /app/sessions /app/artifacts

ENV NODE_ENV=production \
    PORT=3000 \
    HEADLESS=true

EXPOSE 3000
CMD ["node", "src/server.js"]
