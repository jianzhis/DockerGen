FROM node:14-alpine

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm install --production

COPY . .

ENV GPT_API_URL=http://api.openai.com/v1/chat/completions
ENV GPT_MODEL=gpt-4o-mini
ENV DEFAULT_USE_MULTI_STAGE=false
ENV MAX_RETRIES=3
ENV RETRY_DELAY=1000
ENV TEMPLATE_PATH=./custom_dockerfile_template.txt

RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

CMD ["node", "app.js"]