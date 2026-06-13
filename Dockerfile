# Stage 1: Build the frontend and backend inside a node container
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency configurations
COPY package.json package-lock.json ./

# Install all packages (including development packages for compilation)
RUN npm ci

# Copy the rest of the application code
COPY . .

# Run the production build (compiles Vite frontend & bundles Express server via esbuild)
RUN npm run build

# Stage 2: Create the minimal production runner image
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Copy necessary production configurations
COPY package.json ./

# Install only production dependencies to keep the run container lightweight
RUN npm install --only=production

# Copy compiled distributed artifacts from the builder stage
COPY --from=builder /app/dist ./dist

# Copy local JSON database and standard upload directories
COPY --from=builder /app/db.json ./db.json
COPY --from=builder /app/uploads ./uploads

# Expose the designated runner port (mapped dynamically at runtime on Google Cloud Run)
EXPOSE 3000

# Start command
CMD ["npm", "run", "start"]
