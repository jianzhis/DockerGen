FROM node:14-slim

# Set the working directory
WORKDIR /usr/src/app

# Copy package files and install dependencies
COPY package*.json ./
RUN npm install --production

# Copy the rest of the application code
COPY . .

# Set environment variables
ENV GPT_API_URL=
ENV GPT_MODEL=
ENV DEFAULT_USE_MULTI_STAGE=
ENV MAX_RETRIES=
ENV RETRY_DELAY=
ENV TEMPLATE_PATH=

# Keep the container running
CMD ["tail", "-f", "/dev/null"] 
# Use 'docker exec -it <container_id> node app.js <repo_url> [--multi-stage] [--template <template_path>]' to run the application.