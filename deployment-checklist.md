# Docker Deployment Checklist

## Pre-Deployment
- [ ] SSH access to deployment server (174.127.171.180)
- [ ] Router admin access for port forwarding
- [ ] Secure database password and JWT secret ready

## Server Setup (SSH into 174.127.171.180)
- [ ] Update system: `sudo apt update && sudo apt upgrade -y`
- [ ] Install Docker: `curl -fsSL https://get.docker.com -o get-docker.sh && sudo sh get-docker.sh`
- [ ] Install Docker Compose: `sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose`
- [ ] Make Docker Compose executable: `sudo chmod +x /usr/local/bin/docker-compose`
- [ ] Add user to docker group: `sudo usermod -aG docker $USER`
- [ ] Install Git and UFW: `sudo apt install -y git ufw`
- [ ] Verify installations: `docker --version && docker-compose --version`
- [ ] Log out and back in for docker group changes

## Application Setup
- [ ] Clone repository to `/var/www/vocabulary-app`
- [ ] Set ownership: `sudo chown -R $USER:$USER /var/www/vocabulary-app`
- [ ] Create `.env.production` with secure credentials
- [ ] Set secure permissions: `chmod 600 .env.production`

## Docker Services
- [ ] Build and start services: `docker-compose -f docker-compose.prod.yml up --build -d`
- [ ] Verify containers running: `docker-compose -f docker-compose.prod.yml ps`
- [ ] Check service logs: `docker-compose -f docker-compose.prod.yml logs -f`
- [ ] Test backend health: `curl http://localhost:5000/api/health`
- [ ] Test frontend: `curl http://localhost:3000`

## Web Server (Optional - Docker handles this)
- [ ] Create Nginx reverse proxy configuration (optional)
- [ ] Enable Nginx site (if using external proxy)
- [ ] Test Nginx configuration (if used)
- [ ] Reload Nginx (if used)

## Security & Network
- [ ] Configure UFW firewall: `sudo ufw allow ssh && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 3000/tcp && sudo ufw allow 5000/tcp && sudo ufw enable`
- [ ] Set up router port forwarding (80 → 3000 for Docker frontend)
- [ ] Test internal access: `curl http://localhost:5000/api/health`
- [ ] Test database connection via Docker

## Final Testing
- [ ] Check Docker container status: `docker ps`
- [ ] Check Docker service logs: `docker-compose -f docker-compose.prod.yml logs`
- [ ] Test external access: http://174.127.171.180
- [ ] Test from mobile data (outside network)
- [ ] Verify database connectivity and data persistence

## Important Notes
- **Your App URL:** http://174.127.171.180
- **Frontend Container:** localhost:3000 (Docker managed)
- **Backend Container:** localhost:5000 (Docker managed)
- **Database Container:** PostgreSQL with automatic setup
- **Logs:** `docker-compose -f docker-compose.prod.yml logs`

## If Something Goes Wrong
- Check Docker logs: `docker-compose -f docker-compose.prod.yml logs -f`
- Check container status: `docker ps`
- Restart services: `docker-compose -f docker-compose.prod.yml restart`
- Rebuild services: `docker-compose -f docker-compose.prod.yml up --build -d`
- Check resource usage: `docker stats`
- Access container shell: `docker-compose -f docker-compose.prod.yml exec backend sh`

## Docker-Specific Troubleshooting
- [ ] Verify Docker daemon running: `sudo systemctl status docker`
- [ ] Check Docker disk usage: `docker system df`
- [ ] Clean up if needed: `docker system prune -f`
- [ ] Check container logs individually: `docker logs <container-name>`
- [ ] Verify environment variables: `docker-compose -f docker-compose.prod.yml config`
