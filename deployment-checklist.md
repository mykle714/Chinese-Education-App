# Deployment Checklist

## Pre-Deployment
- [ ] SSH access to deployment server (174.127.171.180)
- [ ] Router admin access for port forwarding
- [ ] Azure SQL Database credentials ready

## Server Setup (SSH into 174.127.171.180)
- [ ] Update system: `sudo apt update && sudo apt upgrade -y`
- [ ] Install Node.js 22.x
- [ ] Install Nginx, Git, UFW
- [ ] Install PM2 globally
- [ ] Verify installations

## Application Setup
- [ ] Clone repository to `/var/www/vocabulary-app`
- [ ] Install frontend dependencies: `npm install`
- [ ] Install backend dependencies: `cd server && npm install`
- [ ] Create `.env.production` with IP: 174.127.171.180
- [ ] Create `server/.env` with Azure credentials
- [ ] Build frontend: `npm run build`

## Process Management
- [ ] Create PM2 ecosystem config
- [ ] Install ts-node globally
- [ ] Start backend with PM2
- [ ] Configure PM2 auto-startup

## Web Server
- [ ] Create Nginx configuration for IP 174.127.171.180
- [ ] Enable Nginx site
- [ ] Test Nginx configuration
- [ ] Reload Nginx

## Security & Network
- [ ] Configure UFW firewall (allow SSH, 80, 443)
- [ ] Set up router port forwarding (80 → server)
- [ ] Test internal access: `curl http://localhost:3001/api/`

## Final Testing
- [ ] Check PM2 status: `pm2 status`
- [ ] Check Nginx status: `sudo systemctl status nginx`
- [ ] Test external access: http://174.127.171.180
- [ ] Test from mobile data (outside network)

## Important Notes
- **Your App URL:** http://174.127.171.180
- **Backend runs on:** localhost:3001 (internal only)
- **Frontend served from:** /var/www/vocabulary-app/dist
- **Logs location:** /var/www/vocabulary-app/logs/

## If Something Goes Wrong
- Check PM2 logs: `pm2 logs`
- Check Nginx logs: `sudo tail -f /var/log/nginx/error.log`
- Restart services: `pm2 restart all && sudo systemctl reload nginx`
