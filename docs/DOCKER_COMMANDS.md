# Docker Container Management Guide

This document provides essential Docker commands for managing both development and PPE environment containers.

## Container Names

### Development Environment (`name: cow-dev`)
- `cow-frontend` - Frontend Vite dev server (host port 3000)
- `cow-backend` - Backend Node.js server (host port 5001 → internal 5000)
- `cow-postgres` - PostgreSQL database (host port 5433 → internal 5432)
- `cow-adminer` - Adminer DB UI (host port 8080)

### PPE Environment (`name: cow-ppe`)
- `cow-frontend` - Frontend Nginx server (ports 80, 443)
- `cow-backend` - Backend Node.js server (host port 5002 → internal 5000)
- `cow-postgres` - PostgreSQL database (host port 127.0.0.1:5432 → internal 5432)

**Note:** Only the PPE compose file sets `name:` (`cow-ppe`); the dev file has none, so its
project defaults to the directory name (`cow`). Both pin the Postgres volume to
`cow_postgres_data`, so the project name never decides which data a stack mounts.

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
docker exec cow-frontend npm install <package-name>
```

### Install npm Package in Backend Container
```bash
docker exec cow-backend npm install <package-name>
```

### Uninstall npm Package
```bash
docker exec cow-frontend npm uninstall <package-name>
```

### Example: Installing lodash
```bash
docker exec cow-frontend npm install lodash @types/lodash
```

## Viewing Container Logs

### View Recent Logs
```bash
docker logs cow-frontend --tail 30
```

### Follow Logs in Real-Time
```bash
docker logs cow-frontend -f
```

### View Logs from Last N Minutes
```bash
docker logs cow-frontend --since 5m
```

### View Logs with Filtering
```bash
docker logs cow-frontend 2>&1 | grep -i error
docker logs cow-frontend 2>&1 | grep -E "(ready|Network)"
```

## Cache and Build Management

### Clear Vite Cache (Frontend)
```bash
docker exec cow-frontend rm -rf node_modules/.vite
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
docker exec cow-frontend ls -la
docker exec cow-frontend ls node_modules | grep lodash
```

### Execute Commands in Container
```bash
docker exec cow-frontend <command>
```

### Open Shell in Container
```bash
docker exec -it cow-frontend sh
# or for bash
docker exec -it cow-frontend bash
```

## Troubleshooting Steps

### When Frontend Won't Start
1. Check logs: `docker logs cow-frontend --tail 50`
2. Clear Vite cache: `docker exec cow-frontend rm -rf node_modules/.vite`
3. Restart container: `docker-compose restart frontend`
4. If still failing, rebuild: `docker-compose build frontend && docker-compose up -d frontend`

### When Package Import Fails (e.g., "Failed to resolve import")
1. Verify package is installed: `docker exec cow-frontend ls node_modules | grep <package>`
2. Install if missing: `docker exec cow-frontend npm install <package>`
3. Clear Vite cache: `docker exec cow-frontend rm -rf node_modules/.vite`
4. Restart container: `docker-compose restart frontend`

### When Backend Has Issues
1. Check logs: `docker logs cow-backend --tail 50`
2. Restart: `docker-compose restart backend`
3. Check database connection: Verify postgres container is running

### When Database Connection Fails
1. Check postgres is running: `docker-compose ps`
2. Check logs: `docker logs cow-postgres --tail 30`
3. Restart postgres: `docker-compose restart postgres`

## Common Workflow After Code Changes

### After Installing New Dependencies
```bash
# In host machine (updates package.json and package-lock.json)
npm install <package>

# Then install in container
docker exec cow-frontend npm install

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
docker inspect cow-frontend | grep -A 10 State
```

## Network Troubleshooting

### Check Container Network
```bash
docker network ls
docker network inspect cow-network
```

### Test Backend from Frontend Container
```bash
docker exec cow-frontend curl http://backend:5000/api/health
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
| Install package | `docker exec cow-frontend npm install <pkg>` |
| View logs | `docker logs cow-frontend --tail 30` |
| Clear Vite cache | `docker exec cow-frontend rm -rf node_modules/.vite` |
| Rebuild container | `docker-compose build frontend && docker-compose up -d` |
| Open shell | `docker exec -it cow-frontend sh` |

---

# PPE COMMANDS

All PPE commands use `docker-compose -f docker-compose.ppe.yml`.

## Basic Container Operations

### Navigate to Project Directory
```bash
cd ~/vocabulary-app
```

### List Running Containers
```bash
docker-compose -f docker-compose.ppe.yml ps
```

### List All Services
```bash
docker-compose -f docker-compose.ppe.yml config --services
```

### Start All Containers
```bash
docker-compose -f docker-compose.ppe.yml up -d
```

### Start with Rebuild (After Code Changes)
```bash
docker-compose -f docker-compose.ppe.yml up -d --build
```

### Stop All Containers
```bash
docker-compose -f docker-compose.ppe.yml down
```

### Stop and Remove Volumes (Clean Slate)
```bash
docker-compose -f docker-compose.ppe.yml down -v
```

### Restart Specific Container
```bash
docker-compose -f docker-compose.ppe.yml restart frontend
docker-compose -f docker-compose.ppe.yml restart backend
docker-compose -f docker-compose.ppe.yml restart postgres
```

### Restart All Containers
```bash
docker-compose -f docker-compose.ppe.yml restart
```

## Viewing Container Logs

### View Recent Logs (All Services)
```bash
docker-compose -f docker-compose.ppe.yml logs
```

### View Logs for Specific Service
```bash
docker-compose -f docker-compose.ppe.yml logs frontend
docker-compose -f docker-compose.ppe.yml logs backend
docker-compose -f docker-compose.ppe.yml logs postgres
```

### Follow Logs in Real-Time
```bash
docker-compose -f docker-compose.ppe.yml logs -f
docker-compose -f docker-compose.ppe.yml logs -f frontend
docker-compose -f docker-compose.ppe.yml logs -f backend
```

### View Last N Lines
```bash
docker logs cow-frontend --tail 50
docker logs cow-backend --tail 50
docker logs cow-postgres --tail 50
```

### View Logs with Filtering
```bash
docker logs cow-frontend 2>&1 | grep -i error
docker logs cow-backend 2>&1 | grep -E "(Error|Warning)"
```

## Package Management

### Install npm Package in Backend Container
```bash
docker exec cow-backend npm install <package-name>
```

### After Installing, Rebuild Container
```bash
docker-compose -f docker-compose.ppe.yml build backend
docker-compose -f docker-compose.ppe.yml up -d backend
```

## Build and Deployment

### Rebuild All Containers
```bash
docker-compose -f docker-compose.ppe.yml build
docker-compose -f docker-compose.ppe.yml up -d
```

### Rebuild Specific Container
```bash
docker-compose -f docker-compose.ppe.yml build frontend
docker-compose -f docker-compose.ppe.yml up -d frontend
```

### Full Clean Rebuild (Nuclear Option)
```bash
docker-compose -f docker-compose.ppe.yml down -v
docker-compose -f docker-compose.ppe.yml build --no-cache
docker-compose -f docker-compose.ppe.yml up -d
```

### Pull Latest Code and Rebuild
```bash
cd ~/vocabulary-app
git pull origin main
docker-compose -f docker-compose.ppe.yml down
docker-compose -f docker-compose.ppe.yml up -d --build
```

## File System Operations

### Execute Commands in Container
```bash
docker exec cow-backend <command>
docker exec cow-frontend <command>
```

### Open Shell in Container
```bash
docker exec -it cow-backend sh
docker exec -it cow-frontend sh
docker exec -it cow-postgres sh
```

### View Nginx Configuration
```bash
docker exec cow-frontend cat /etc/nginx/conf.d/default.conf
```

### Test Nginx Configuration
```bash
docker exec cow-frontend nginx -t
```

## Database Operations

### Access PostgreSQL Shell
```bash
docker exec -it cow-postgres psql -U cow_user -d cow_db
```

### Run SQL Query
```bash
docker exec -i cow-postgres psql -U cow_user -d cow_db -c "SELECT version();"
```

### Check Database Connection
```bash
docker exec cow-postgres pg_isready -U cow_user -d cow_db
```

### View Database Tables
```bash
docker exec -i cow-postgres psql -U cow_user -d cow_db -c "\dt"
```

### Backup Database
```bash
docker exec cow-postgres pg_dump -U cow_user cow_db > backup_$(date +%Y%m%d_%H%M%S).sql
```

### Restore Database
```bash
cat backup.sql | docker exec -i cow-postgres psql -U cow_user -d cow_db
```

## Health Checks

### Check Backend Health Endpoint
```bash
# PPE backend is bound to host port 5002
curl http://localhost:5002/api/health
```

### Check Frontend
```bash
curl http://localhost/
```

### Check All Container Health
```bash
docker inspect cow-frontend | grep -A 10 Health
docker inspect cow-backend | grep -A 10 Health
```

## Troubleshooting

### Frontend Issues (Nginx)

**Check if container is running:**
```bash
docker-compose -f docker-compose.ppe.yml ps
```

**View Nginx logs:**
```bash
docker logs cow-frontend --tail 100
```

**Check Nginx configuration syntax:**
```bash
docker exec cow-frontend nginx -t
```

**Restart Nginx:**
```bash
docker-compose -f docker-compose.ppe.yml restart frontend
```

**Rebuild if configuration changed:**
```bash
docker-compose -f docker-compose.ppe.yml build frontend
docker-compose -f docker-compose.ppe.yml up -d frontend
```

### Backend Issues

**Check logs:**
```bash
docker logs cow-backend --tail 100 -f
```

**Test backend directly:**
```bash
curl http://localhost:5000/api/health
```

**Check environment variables:**
```bash
docker exec cow-backend env | grep -E "(NODE_ENV|DB_|CLIENT_URL)"
```

**Restart backend:**
```bash
docker-compose -f docker-compose.ppe.yml restart backend
```

### Database Issues

**Check if postgres is running:**
```bash
docker-compose -f docker-compose.ppe.yml ps postgres
```

**View postgres logs:**
```bash
docker logs cow-postgres --tail 50
```

**Test connection:**
```bash
docker exec cow-postgres pg_isready -U cow_user -d cow_db
```

**Restart database:**
```bash
docker-compose -f docker-compose.ppe.yml restart postgres
```

### SSL Certificate Issues

**Check if certificates exist:**
```bash
docker exec cow-frontend ls -la /etc/letsencrypt/live/
```

**View Nginx SSL configuration:**
```bash
docker exec cow-frontend cat /etc/nginx/conf.d/default.conf | grep ssl
```

**Test SSL locally:**
```bash
curl -I https://localhost
```

## Performance Monitoring

### Check Resource Usage
```bash
docker stats cow-frontend cow-backend cow-postgres
```

### Check Disk Usage
```bash
docker system df
```

### View Container Processes
```bash
docker-compose -f docker-compose.ppe.yml top
```

## Network Troubleshooting

### Check Network
```bash
docker network ls
# Dev network
docker network inspect cow-dev_cow-network
# PPE network
docker network inspect cow-ppe_cow-network
```

### Test Backend Connection from Frontend
```bash
docker exec cow-frontend wget -O- http://backend:5000/api/health
```

## Common PPE Workflows

### After Deploying Code Changes
```bash
cd ~/vocabulary-app
git pull origin main
docker-compose -f docker-compose.ppe.yml down
docker-compose -f docker-compose.ppe.yml up -d --build
docker-compose -f docker-compose.ppe.yml logs -f
```

### After Updating Environment Variables
```bash
# Edit .env file
nano .env

# IMPORTANT: restart does NOT reload env vars — they are baked in at container creation.
# You must force-recreate the affected container:
sudo docker compose -f docker-compose.ppe.yml up -d --force-recreate backend
```

### After Updating Nginx Configuration
```bash
# Test configuration first
docker exec cow-frontend nginx -t

# If OK, restart
docker-compose -f docker-compose.ppe.yml restart frontend
```

### Checking Application Status
```bash
# Quick status check
docker-compose -f docker-compose.ppe.yml ps

# Detailed health check
curl http://localhost:5000/api/health
curl http://localhost/

# View recent logs
docker-compose -f docker-compose.ppe.yml logs --tail 20
```

## Best Practices - PPE

1. **Always check logs** before and after operations
2. **Test configuration** before restarting services
3. **Use `restart`** instead of `down/up` when possible to avoid downtime
4. **Back up database** before major changes
5. **Monitor resource usage** regularly with `docker stats`
6. **Keep volumes** unless doing a complete reset
7. **Pull latest code** before rebuilding containers
8. **Check health endpoints** after deployments

## Quick Reference - PPE

| Task | Command |
|------|---------|
| View containers | `docker-compose -f docker-compose.ppe.yml ps` |
| Start all | `docker-compose -f docker-compose.ppe.yml up -d` |
| Stop all | `docker-compose -f docker-compose.ppe.yml down` |
| Restart service | `docker-compose -f docker-compose.ppe.yml restart frontend` |
| View logs | `docker logs cow-frontend --tail 50` |
| Follow logs | `docker-compose -f docker-compose.ppe.yml logs -f` |
| Rebuild & restart | `docker-compose -f docker-compose.ppe.yml up -d --build` |
| Open shell | `docker exec -it cow-backend sh` |
| Check health | `curl http://localhost:5000/api/health` |
| Database shell | `docker exec -it cow-postgres psql -U cow_user -d cow_db` |
| View Nginx config | `docker exec cow-frontend cat /etc/nginx/conf.d/default.conf` |
| Test Nginx config | `docker exec cow-frontend nginx -t` |

---

## Environment Comparison

| Aspect | Development | PPE |
|--------|-------------|------------|
| Compose File | `docker-compose.yml` | `docker-compose.ppe.yml` |
| Frontend Container | `cow-frontend` | `cow-frontend` |
| Backend Container | `cow-backend` | `cow-backend` |
| Database Container | `cow-postgres` | `cow-postgres` |
| Frontend Server | Vite Dev Server | Nginx |
| Frontend Port | 3000 | 80, 443 |
| Hot Reload | Yes | No |
| Build Optimization | No | Yes |
| SSL/TLS | No | Yes (via Nginx) |
