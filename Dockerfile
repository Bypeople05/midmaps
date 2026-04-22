FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY server.js ./
COPY mind_map_editor_interativo_projeto_administradora.html ./
COPY assets ./assets

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
