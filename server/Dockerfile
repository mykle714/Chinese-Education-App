# Backend Dockerfile - Multi-stage build for Express + TypeScript app

# Development stage
FROM node:20-alpine as development
WORKDIR /app

# Install dependencies for development
COPY server/package*.json ./
RUN npm ci

# Copy server source code
COPY server/ .

# Expose port for backend server
EXPOSE 5000

# Start development server with hot reload
CMD ["npm", "run", "dev"]

# Build stage
FROM node:20-alpine as build
WORKDIR /app

# Copy package files
COPY server/package*.json ./
RUN npm ci

# Copy server source code and build
COPY server/ .
RUN npm run build

# Production stage
FROM node:20-alpine as production
WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

# Copy package files and install production dependencies only
COPY server/package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules

# Copy TypeScript scripts for dictionary imports
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/tsconfig.json ./tsconfig.json

# Copy CHANGELOG.md from project root
COPY CHANGELOG.md /app/CHANGELOG.md

# Change ownership to nodejs user
RUN chown -R nodejs:nodejs /app
USER nodejs

# Expose port
EXPOSE 5000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD node -e "require('http').get('http://localhost:5000/api/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })"

# Start the application
CMD ["node", "dist/server.js"]
