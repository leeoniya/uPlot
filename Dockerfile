FROM node:12

WORKDIR /uplot

COPY package.json .
RUN npm install

COPY . .
RUN npm run build
