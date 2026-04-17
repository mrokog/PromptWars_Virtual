FROM node:20-alpine

WORKDIR /app

# Copy only what's needed for serving
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY index.html ./
COPY js/ ./js/
COPY styles/ ./styles/
COPY workers/ ./workers/

EXPOSE 8080

CMD ["npx", "serve", ".", "-l", "8080", "--no-request-logging", "--single"]
