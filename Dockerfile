FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=development
EXPOSE 3000

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0"]
