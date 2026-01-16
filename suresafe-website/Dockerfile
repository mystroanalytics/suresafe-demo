FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install --production

# Copy application files
COPY . .

# Copy Box config from parent directory during build
# Note: The Box config will be provided via environment variable in production

# Expose port
EXPOSE 8080

# Set environment variable for Cloud Run port
ENV PORT=8080

# Start the application
CMD ["node", "server.js"]
