FROM node:16-alpine

WORKDIR /usr/src/app

COPY package*.json ./

RUN npm install --production

COPY . .

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

USER appuser

ENV GPT_API_URL=http://api.openai.com/v1/chat/completions
ENV GPT_MODEL=gpt-4o-mini
ENV DEFAULT_USE_MULTI_STAGE=false
ENV MAX_RETRIES=3
ENV RETRY_DELAY=1000
ENV TEMPLATE_PATH=./custom_dockerfile_template.txt

EXPOSE 3000

CMD ["node", "app.js"] 

HEALTHCHECK --interval=30s --timeout=10s --retries=3 CMD curl -f http://localhost:3000/ || exit 1