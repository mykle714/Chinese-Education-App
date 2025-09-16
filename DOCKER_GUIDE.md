# Docker Guide for Vocabulary Entry Manager

This guide explains how to run the Vocabulary Entry Manager application using Docker containers for development and production environments.

## Overview

The application consists of three main services:
- **Frontend**: React + Vite application
- **Backend**: Express + TypeScript API server
- **Database**: PostgreSQL with initialization scripts

## Prerequisites

- Docker Engine 20.10+
- Docker Compose 2.0+
- Git (for cloning the repository)

## Quick Start (Development)

1. **Clone and navigate to the project**:
   ```bash
   git clone <repository-url>
   cd <project-directory>
   ```

2. **Start all services**:
   ```bash
   docker-compose up --build
   ```

3. **Access the application**:
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:5000
   - Database: localhost:5432

## Development Environment

### Starting Services

```bash
# Start all services with build
docker-compose up --build

# Start in background
docker-compose up -d --build

# Start specific service
docker-compose up frontend
docker-compose up backend
docker-compose up postgres
```

### Development Features

- **Hot Reload**: Both frontend and backend support hot reload
- **Volume Mounting**: Source code changes are reflected immediately
- **Database Persistence**: Data persists between container restarts
- **Environment Variables**: Uses `.env.docker` files for container-specific config

### Stopping Services

```bash
# Stop all services
docker-compose down

# Stop and remove volumes (clears database)
docker-compose down -v

# Stop and remove images
docker-compose down --rmi all
```

## Production Environment

### Environment Setup

1. **Create production environment file**:
   ```bash
   cp .env.example .env.production
   ```

2. **Set required environment variables**:
   ```bash
   # Required for production
   export POSTGRES_PASSWORD="your-secure-password"
   export JWT_SECRET="your-jwt-secret-key"
   export CLIENT_URL="https://yourdomain.com"
   ```

### Starting Production Services

```bash
# Start production environment
docker-compose -f docker-compose.prod.yml up --build -d

# View logs
docker-compose -f docker-compose.prod.yml logs -f

# Check service health
docker-compose -f docker-compose.prod.yml ps
```

### Production Features

- **Optimized Builds**: Multi-stage builds for smaller images
- **Security**: Non-root users, localhost binding for sensitive services
- **Health Checks**: Automatic health monitoring
- **Nginx**: Static file serving with compression and caching
- **SSL Ready**: HTTPS port 443 exposed for SSL termination

## Service Details

### Frontend Service

**Development**:
- Port: 3000
- Hot reload enabled
- API proxy to backend
- Volume mounted source code

**Production**:
- Port: 80 (HTTP), 443 (HTTPS)
- Nginx serving static files
- Gzip compression
- Security headers
- Client-side routing support

### Backend Service

**Development**:
- Port: 5000
- Hot reload with nodemon
- TypeScript compilation on-the-fly
- Volume mounted source code

**Production**:
- Port: 5000 (localhost only)
- Compiled JavaScript
- Health check endpoint
- Non-root user execution

### Database Service

**Configuration**:
- PostgreSQL 15 Alpine
- UTF-8 encoding
- Automatic schema initialization
- Performance optimizations

**Access**:
- Host: postgres (container) / localhost (external)
- Port: 5432
- Database: cow_db
- User: cow_user

## Environment Variables

### Development (.env.docker)
```bash
DB_HOST=postgres
DB_PORT=5432
DB_NAME=cow_db
DB_USER=cow_user
DB_PASSWORD=cow_password_local
JWT_SECRET=your-jwt-secret
CLIENT_URL=http://localhost:3000
PORT=5000
NODE_ENV=development
```

### Production (.env.production)
```bash
DB_HOST=postgres
DB_PORT=5432
DB_NAME=cow_db
DB_USER=cow_user
DB_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
CLIENT_URL=${CLIENT_URL}
PORT=5000
NODE_ENV=production
```

## Container Hard Reset

### Complete Reset (Nuclear Option)

When you need a completely fresh start with clean test data:

```bash
# Stop and remove everything
docker-compose down -v --remove-orphans

# Remove all containers, networks, images, and build cache
docker system prune -a -f

# Remove all volumes (this will delete your database data!)
docker volume prune -f

# Rebuild and start fresh
docker-compose up --build -d
```

### Quick Reset (Recommended)

For most situations, this is sufficient:

```bash
# Stop containers and remove volumes (deletes database data)
docker-compose down -v

# Start fresh (will recreate test users automatically)
docker-compose up --build -d
```

### Preserve Code Changes Reset

If you want to keep your code changes but reset the database:

```bash
# Stop containers but keep images
docker-compose down -v --remove-orphans

# Start fresh
docker-compose up -d
```

### What Gets Reset

**`docker-compose down -v`:**
- ✅ Stops all containers
- ✅ Removes all volumes (database data deleted)
- ✅ Triggers automatic test user creation on next startup

**`docker system prune -a -f`:**
- ✅ Removes all unused containers
- ✅ Removes all unused networks  
- ✅ Removes all unused images
- ✅ Removes all build cache

**After Reset, You Get:**
- 🆕 Fresh database with clean schema
- 👥 3 test users automatically created:
  - `empty@test.com` (0 cards)
  - `small@test.com` (11 cards) 
  - `large@test.com` (52 cards)
- 🔑 All users use password: `testing123`

## Troubleshooting

### Common Issues

1. **Port conflicts**:
   ```bash
   # Check what's using the port
   lsof -i :3000
   lsof -i :5000
   lsof -i :5432
   
   # Stop conflicting services or change ports in docker-compose.yml
   ```

2. **Database connection issues**:
   ```bash
   # Check database logs
   docker-compose logs postgres
   
   # Verify database is ready
   docker-compose exec postgres pg_isready -U cow_user -d cow_db
   ```

3. **Build failures**:
   ```bash
   # Clean build cache
   docker-compose build --no-cache
   
   # Remove all containers and rebuild
   docker-compose down
   docker system prune -f
   docker-compose up --build
   ```

4. **Permission issues**:
   ```bash
   # Fix file permissions (Linux/Mac)
   sudo chown -R $USER:$USER .
   ```

### Logs and Debugging

```bash
# View all logs
docker-compose logs

# View specific service logs
docker-compose logs frontend
docker-compose logs backend
docker-compose logs postgres

# Follow logs in real-time
docker-compose logs -f backend

# Execute commands in running containers
docker-compose exec backend sh
docker-compose exec postgres psql -U cow_user -d cow_db
```

### Health Checks

```bash
# Check service health
curl http://localhost:5000/api/health

# Check frontend
curl http://localhost:3000

# Check database connection
docker-compose exec backend node -e "
const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres',
  port: 5432,
  database: 'cow_db',
  user: 'cow_user',
  password: 'cow_password_local'
});
pool.query('SELECT NOW()', (err, res) => {
  console.log(err ? err : res.rows[0]);
  pool.end();
});
"
```

## Database Management

### Backup Database

```bash
# Create backup
docker-compose exec postgres pg_dump -U cow_user cow_db > backup.sql

# Or use the backup script
./database/backup.sh
```

### Restore Database

```bash
# Restore from backup
docker-compose exec -T postgres psql -U cow_user cow_db < backup.sql

# Or use the restore script
./database/restore.sh backup.sql
```

### Reset Database

```bash
# Stop services and remove volumes
docker-compose down -v

# Start services (will reinitialize database)
docker-compose up --build
```

## Performance Optimization

### Development

- Use `.dockerignore` to exclude unnecessary files
- Leverage Docker layer caching
- Use volume mounts for faster development

### Production

- Multi-stage builds reduce image size
- Nginx serves static files efficiently
- Health checks ensure service reliability
- Resource limits prevent resource exhaustion

## Security Considerations

### Development

- Database exposed on localhost only
- Default passwords (change for production)
- CORS configured for development origins

### Production

- Services bound to localhost for security
- Non-root users in containers
- Environment variables for secrets
- Security headers in Nginx
- Health checks for monitoring

## Deployment

### Local Production Testing

```bash
# Test production build locally
docker-compose -f docker-compose.prod.yml up --build

# Access via http://localhost
```

### Server Deployment

1. **Copy files to server**:
   ```bash
   scp -r . user@server:/path/to/app
   ```

2. **Set environment variables**:
   ```bash
   export POSTGRES_PASSWORD="secure-password"
   export JWT_SECRET="secure-jwt-secret"
   export CLIENT_URL="https://yourdomain.com"
   ```

3. **Start services**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d --build
   ```

4. **Setup SSL** (recommended):
   - Use reverse proxy (nginx, traefik)
   - Configure SSL certificates
   - Update CLIENT_URL to HTTPS

## Maintenance

### Updates

```bash
# Pull latest images
docker-compose pull

# Rebuild and restart
docker-compose up --build -d

# Clean up old images
docker image prune -f
```

### Monitoring

```bash
# Check resource usage
docker stats

# Check disk usage
docker system df

# View container processes
docker-compose top
```

This Docker setup provides a complete development and production environment for the Vocabulary Entry Manager application with proper isolation, scalability, and maintainability.
