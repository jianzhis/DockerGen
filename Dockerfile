FROM node:16-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install --production

COPY . .

ENV GPT_API_URL=http://api.openai.com/v1/chat/completions \
    GPT_MODEL=gpt-4o-mini \
    DEFAULT_USE_MULTI_STAGE=false \
    MAX_RETRIES=3 \
    RETRY_DELAY=1000 \
    TEMPLATE_PATH=./custom_dockerfile_template.txt

ENTRYPOINT ["node", "app.js"]