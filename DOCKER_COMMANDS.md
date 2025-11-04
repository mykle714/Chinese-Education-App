# Docker Container Management Guide

This document provides essential Docker commands for managing both development and production environment containers.

## Container Names

### Development Environment
- `cow-frontend-local` - Frontend Vite dev server (port 3000)
- `cow-backend-local` - Backend Node.js server (port 5000)
- `cow-postgres-local` - PostgreSQL database (port 5432)

### Production Environment
- `cow-frontend-prod` - Frontend Nginx server (ports 80, 443)
- `cow-backend-prod` - Backend Node.js server (port 5000)
- `cow-postgres-prod` - PostgreSQL database (port 5432)

---

# DEVELOPMENT COMMANDS

All development commands use the default `docker-compose.yml` file.

## Basic Container Operations

### List Running Containers
```bash
docker-compose ps
```

### List All Docker Compose Services
```bash
docker-compose config --services
```

### Start All Containers
```bash
docker-compose up -d
```

### Stop All Containers
```bash
docker-compose down
```

### Restart Specific Container
```bash
docker-compose restart frontend
docker-compose restart backend
docker-compose restart postgres
```

### Restart All Containers
```bash
docker-compose restart
```

## Package Management in Containers

### Install npm Package in Frontend Container
```bash
docker exec cow-frontend-local npm install <package-name>
```

### Install npm Package in Backend Container
```bash
docker exec cow-backend-local npm install <package-name>
```

### Uninstall npm Package
```bash
docker exec cow-frontend-local npm uninstall <package-name>
```

### Example: Installing lodash
```bash
docker exec cow-frontend-local npm install lodash @types/lodash
```

## Viewing Container Logs

### View Recent Logs
```bash
docker logs cow-frontend-local --tail 30
```

### Follow Logs in Real-Time
```bash
docker logs cow-frontend-local -f
```

### View Logs from Last N Minutes
```bash
docker logs cow-frontend-local --since 5m
```

### View Logs with Filtering
```bash
docker logs cow-frontend-local 2>&1 | grep -i error
docker logs cow-frontend-local 2>&1 | grep -E "(ready|Network)"
```

## Cache and Build Management

### Clear Vite Cache (Frontend)
```bash
docker exec cow-frontend-local rm -rf node_modules/.vite
```

### Rebuild Containers
```bash
docker-compose build
docker-compose up -d
```

### Rebuild Specific Container
```bash
docker-compose build frontend
docker-compose up -d frontend
```

### Full Clean Rebuild (Nuclear Option)
```bash
docker-compose down -v  # Removes volumes too
docker-compose build --no-cache
docker-compose up -d
```

## File System Operations

### List Files in Container
```bash
docker exec cow-frontend-local ls -la
docker exec cow-frontend-local ls node_modules | grep lodash
```

### Execute Commands in Container
```bash
docker exec cow-frontend-local <command>
```

### Open Shell in Container
```bash
docker exec -it cow-frontend-local sh
# or for bash
docker exec -it cow-frontend-local bash
```

## Troubleshooting Steps

### When Frontend Won't Start
1. Check logs: `docker logs cow-frontend-local --tail 50`
2. Clear Vite cache: `docker exec cow-frontend-local rm -rf node_modules/.vite`
3. Restart container: `docker-compose restart frontend`
4. If still failing, rebuild: `docker-compose build frontend && docker-compose up -d frontend`

### When Package Import Fails (e.g., "Failed to resolve import")
1. Verify package is installed: `docker exec cow-frontend-local ls node_modules | grep <package>`
2. Install if missing: `docker exec cow-frontend-local npm install <package>`
3. Clear Vite cache: `docker exec cow-frontend-local rm -rf node_modules/.vite`
4. Restart container: `docker-compose restart frontend`

### When Backend Has Issues
1. Check logs: `docker logs cow-backend-local --tail 50`
2. Restart: `docker-compose restart backend`
3. Check database connection: Verify postgres container is running

### When Database Connection Fails
1. Check postgres is running: `docker-compose ps`
2. Check logs: `docker logs cow-postgres-local --tail 30`
3. Restart postgres: `docker-compose restart postgres`

## Common Workflow After Code Changes

### After Installing New Dependencies
```bash
# In host machine (updates package.json and package-lock.json)
npm install <package>

# Then install in container
docker exec cow-frontend-local npm install

# Restart to ensure changes are picked up
docker-compose restart frontend
```

### After Making Code Changes
- Frontend: Changes hot-reload automatically (no restart needed)
- Backend: May need restart: `docker-compose restart backend`

### After Modifying Docker Configuration
```bash
docker-compose down
docker-compose up -d
```

### After Modifying Dockerfile
```bash
docker-compose build frontend
docker-compose up -d frontend
```

## Performance Monitoring

### Check Container Resource Usage
```bash
docker stats
```

### Check Container Health
```bash
docker inspect cow-frontend-local | grep -A 10 State
```

## Network Troubleshooting

### Check Container Network
```bash
docker network ls
docker network inspect cow-network
```

### Test Backend from Frontend Container
```bash
docker exec cow-frontend-local curl http://backend:5000/api/health
```

## Best Practices

1. **Always use docker-compose commands** instead of raw docker commands when possible
2. **Check logs first** when debugging issues
3. **Clear caches** when experiencing import/build issues
4. **Restart containers** after installing new packages
5. **Use `docker-compose restart`** instead of `down/up` to preserve volumes
6. **Run package installs in containers** to ensure consistency with container environment

## Quick Reference - Development

| Task | Command |
|------|---------|
| View all containers | `docker-compose ps` |
| Restart frontend | `docker-compose restart frontend` |
| Install package | `docker exec cow-frontend-local npm install <pkg>` |
| View logs | `docker logs cow-frontend-local --tail 30` |
| Clear Vite cache | `docker exec cow-frontend-local rm -rf node_modules/.vite` |
| Rebuild container | `docker-compose build frontend && docker-compose up -d` |
| Open shell | `docker exec -it cow-frontend-local sh` |

---

# PRODUCTION COMMANDS

All production commands use `docker-compose -f docker-compose.prod.yml`.

## Basic Container Operations

### Navigate to Project Directory
```bash
cd /var/www/vocabulary-app
```

### List Running Containers
```bash
docker-compose -f docker-compose.prod.yml ps
```

### List All Services
```bash
docker-compose -f docker-compose.prod.yml config --services
```

### Start All Containers
```bash
docker-compose -f docker-compose.prod.yml up -d
```

### Start with Rebuild (After Code Changes)
```bash
docker-compose -f docker-compose.prod.yml up -d --build
```

### Stop All Containers
```bash
docker-compose -f docker-compose.prod.yml down
```

### Stop and Remove Volumes (Clean Slate)
```bash
docker-compose -f docker-compose.prod.yml down -v
```

### Restart Specific Container
```bash
docker-compose -f docker-compose.prod.yml restart frontend
docker-compose -f docker-compose.prod.yml restart backend
docker-compose -f docker-compose.prod.yml restart postgres
```

### Restart All Containers
```bash
docker-compose -f docker-compose.prod.yml restart
```

## Viewing Container Logs

### View Recent Logs (All Services)
```bash
docker-compose -f docker-compose.prod.yml logs
```

### View Logs for Specific Service
```bash
docker-compose -f docker-compose.prod.yml logs frontend
docker-compose -f docker-compose.prod.yml logs backend
docker-compose -f docker-compose.prod.yml logs postgres
```

### Follow Logs in Real-Time
```bash
docker-compose -f docker-compose.prod.yml logs -f
docker-compose -f docker-compose.prod.yml logs -f frontend
docker-compose -f docker-compose.prod.yml logs -f backend
```

### View Last N Lines
```bash
docker logs cow-frontend-prod --tail 50
docker logs cow-backend-prod --tail 50
docker logs cow-postgres-prod --tail 50
```

### View Logs with Filtering
```bash
docker logs cow-frontend-prod 2>&1 | grep -i error
docker logs cow-backend-prod 2>&1 | grep -E "(Error|Warning)"
```

## Package Management

### Install npm Package in Backend Container
```bash
docker exec cow-backend-prod npm install <package-name>
```

### After Installing, Rebuild Container
```bash
docker-compose -f docker-compose.prod.yml build backend
docker-compose -f docker-compose.prod.yml up -d backend
```

## Build and Deployment

### Rebuild All Containers
```bash
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d
```

### Rebuild Specific Container
```bash
docker-compose -f docker-compose.prod.yml build frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

### Full Clean Rebuild (Nuclear Option)
```bash
docker-compose -f docker-compose.prod.yml down -v
docker-compose -f docker-compose.prod.yml build --no-cache
docker-compose -f docker-compose.prod.yml up -d
```

### Pull Latest Code and Rebuild
```bash
cd /var/www/vocabulary-app
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
```

## File System Operations

### Execute Commands in Container
```bash
docker exec cow-backend-prod <command>
docker exec cow-frontend-prod <command>
```

### Open Shell in Container
```bash
docker exec -it cow-backend-prod sh
docker exec -it cow-frontend-prod sh
docker exec -it cow-postgres-prod sh
```

### View Nginx Configuration
```bash
docker exec cow-frontend-prod cat /etc/nginx/conf.d/default.conf
```

### Test Nginx Configuration
```bash
docker exec cow-frontend-prod nginx -t
```

## Database Operations

### Access PostgreSQL Shell
```bash
docker exec -it cow-postgres-prod psql -U cow_user -d cow_db
```

### Run SQL Query
```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT version();"
```

### Check Database Connection
```bash
docker exec cow-postgres-prod pg_isready -U cow_user -d cow_db
```

### View Database Tables
```bash
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "\dt"
```

### Backup Database
```bash
docker exec cow-postgres-prod pg_dump -U cow_user cow_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore Database
```bash
cat backup.sql | docker exec -i cow-postgres-prod psql -U cow_user -d cow_db
```

## Health Checks

### Check Backend Health Endpoint
```bash
curl http://localhost:5000/api/health
```

### Check Frontend
```bash
curl http://localhost/
```

### Check All Container Health
```bash
docker inspect cow-frontend-prod | grep -A 10 Health
docker inspect cow-backend-prod | grep -A 10 Health
```

## Troubleshooting

### Frontend Issues (Nginx)

**Check if container is running:**
```bash
docker-compose -f docker-compose.prod.yml ps
```

**View Nginx logs:**
```bash
docker logs cow-frontend-prod --tail 100
```

**Check Nginx configuration syntax:**
```bash
docker exec cow-frontend-prod nginx -t
```

**Restart Nginx:**
```bash
docker-compose -f docker-compose.prod.yml restart frontend
```

**Rebuild if configuration changed:**
```bash
docker-compose -f docker-compose.prod.yml build frontend
docker-compose -f docker-compose.prod.yml up -d frontend
```

### Backend Issues

**Check logs:**
```bash
docker logs cow-backend-prod --tail 100 -f
```

**Test backend directly:**
```bash
curl http://localhost:5000/api/health
```

**Check environment variables:**
```bash
docker exec cow-backend-prod env | grep -E "(NODE_ENV|DB_|CLIENT_URL)"
```

**Restart backend:**
```bash
docker-compose -f docker-compose.prod.yml restart backend
```

### Database Issues

**Check if postgres is running:**
```bash
docker-compose -f docker-compose.prod.yml ps postgres
```

**View postgres logs:**
```bash
docker logs cow-postgres-prod --tail 50
```

**Test connection:**
```bash
docker exec cow-postgres-prod pg_isready -U cow_user -d cow_db
```

**Restart database:**
```bash
docker-compose -f docker-compose.prod.yml restart postgres
```

### SSL Certificate Issues

**Check if certificates exist:**
```bash
docker exec cow-frontend-prod ls -la /etc/letsencrypt/live/
```

**View Nginx SSL configuration:**
```bash
docker exec cow-frontend-prod cat /etc/nginx/conf.d/default.conf | grep ssl
```

**Test SSL locally:**
```bash
curl -I https://localhost
```

## Performance Monitoring

### Check Resource Usage
```bash
docker stats cow-frontend-prod cow-backend-prod cow-postgres-prod
```

### Check Disk Usage
```bash
docker system df
```

### View Container Processes
```bash
docker-compose -f docker-compose.prod.yml top
```

## Network Troubleshooting

### Check Network
```bash
docker network ls
docker network inspect cow-network
```

### Test Backend Connection from Frontend
```bash
docker exec cow-frontend-prod wget -O- http://backend:5000/api/health
```

## Common Production Workflows

### After Deploying Code Changes
```bash
cd /var/www/vocabulary-app
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up -d --build
docker-compose -f docker-compose.prod.yml logs -f
```

### After Updating Environment Variables
```bash
# Edit .env file
nano .env

# Restart containers
docker-compose -f docker-compose.prod.yml restart
```

### After Updating Nginx Configuration
```bash
# Test configuration first
docker exec cow-frontend-prod nginx -t

# If OK, restart
docker-compose -f docker-compose.prod.yml restart frontend
```

### Checking Application Status
```bash
# Quick status check
docker-compose -f docker-compose.prod.yml ps

# Detailed health check
curl http://localhost:5000/api/health
curl http://localhost/

# View recent logs
docker-compose -f docker-compose.prod.yml logs --tail 20
```

## Best Practices - Production

1. **Always check logs** before and after operations
2. **Test configuration** before restarting services
3. **Use `restart`** instead of `down/up` when possible to avoid downtime
4. **Back up database** before major changes
5. **Monitor resource usage** regularly with `docker stats`
6. **Keep volumes** unless doing a complete reset
7. **Pull latest code** before rebuilding containers
8. **Check health endpoints** after deployments

## Quick Reference - Production

| Task | Command |
|------|---------|
| View containers | `docker-compose -f docker-compose.prod.yml ps` |
| Start all | `docker-compose -f docker-compose.prod.yml up -d` |
| Stop all | `docker-compose -f docker-compose.prod.yml down` |
| Restart service | `docker-compose -f docker-compose.prod.yml restart frontend` |
| View logs | `docker logs cow-frontend-prod --tail 50` |
| Follow logs | `docker-compose -f docker-compose.prod.yml logs -f` |
| Rebuild & restart | `docker-compose -f docker-compose.prod.yml up -d --build` |
| Open shell | `docker exec -it cow-backend-prod sh` |
| Check health | `curl http://localhost:5000/api/health` |
| Database shell | `docker exec -it cow-postgres-prod psql -U cow_user -d cow_db` |
| View Nginx config | `docker exec cow-frontend-prod cat /etc/nginx/conf.d/default.conf` |
| Test Nginx config | `docker exec cow-frontend-prod nginx -t` |

---

## Environment Comparison

| Aspect | Development | Production |
|--------|-------------|------------|
| Compose File | `docker-compose.yml` | `docker-compose.prod.yml` |
| Frontend Container | `cow-frontend-local` | `cow-frontend-prod` |
| Backend Container | `cow-backend-local` | `cow-backend-prod` |
| Database Container | `cow-postgres-local` | `cow-postgres-prod` |
| Frontend Server | Vite Dev Server | Nginx |
| Frontend Port | 3000 | 80, 443 |
| Hot Reload | Yes | No |
| Build Optimization | No | Yes |
| SSL/TLS | No | Yes (via Nginx) |
