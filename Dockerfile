FROM gradle:8.5-jdk17
USER root
RUN apt-get update && apt-get install -y nodejs npm
WORKDIR /app
COPY package.json .
RUN npm install
COPY . .
CMD ["node", "server.js"]
