# Docker Container Management Guide

This document provides essential Docker commands for managing the development environment containers.

## Container Names

The project uses three main containers:
- `cow-frontend-local` - Frontend Vite dev server (port 3000)
- `cow-backend-local` - Backend Node.js server (port 5000)
- `cow-postgres-local` - PostgreSQL database (port 5432)

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

## Quick Reference

| Task | Command |
|------|---------|
| View all containers | `docker-compose ps` |
| Restart frontend | `docker-compose restart frontend` |
| Install package | `docker exec cow-frontend-local npm install <pkg>` |
| View logs | `docker logs cow-frontend-local --tail 30` |
| Clear Vite cache | `docker exec cow-frontend-local rm -rf node_modules/.vite` |
| Rebuild container | `docker-compose build frontend && docker-compose up -d` |
| Open shell | `docker exec -it cow-frontend-local sh` |
