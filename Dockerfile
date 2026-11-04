FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN npm install -g typescript tsx
RUN npm run build

EXPOSE 3000

CMD ["node", "dist/server.js"]
