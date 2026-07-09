# Cloud Run image for the Cohortex Studio Express API.
FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src

# Cloud Run injects PORT and expects the container to listen on it.
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "src/server.js"]
