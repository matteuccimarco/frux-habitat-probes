# Probe Agents Kit - Dockerfile
# Node 20 LTS Alpine for minimal image size

FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package.json tsconfig.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY src/ ./src/

# Build TypeScript
RUN npm run build

# Production stage
FROM node:20-alpine AS runner

WORKDIR /app

# Copy built files and package.json
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Environment variables with defaults
ENV HABITAT_CORE_URL=http://host.docker.internal:9670
ENV HABITAT_PERCEPTION_URL=http://host.docker.internal:9671
ENV PROBE_QS_COUNT=10
ENV PROBE_CBC_COUNT=3
ENV PROBE_JAP_COUNT=2
ENV PROBE_BASE_SEED=42
ENV PROBE_TICK_INTERVAL_MS=1000
ENV PROBE_MAX_RETRIES=3
ENV PROBE_VERBOSE=false

# Run
CMD ["node", "dist/runner.js"]
