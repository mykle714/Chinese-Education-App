# Deployment Guide for Vocabulary App
**Target Server IP:** 174.127.171.180
**Repository:** https://github.com/mykle714/Chinese-Education-App.git

## Step 1: SSH into Your Deployment Server
```bash
ssh username@174.127.171.180
```

## Step 2: Update System and Install Dependencies
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Node.js 22.x
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install additional dependencies
sudo apt install -y nginx git ufw

# Install PM2 globally
sudo npm install -g pm2

# Verify installations
node --version  # Should show v22.x.x
npm --version
nginx -v
```

## Step 3: Clone and Setup Application
```bash
# Create web directory and clone repository
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/mykle714/Chinese-Education-App.git vocabulary-app
sudo chown -R $USER:$USER /var/www/vocabulary-app
cd /var/www/vocabulary-app

# Install frontend dependencies
npm install

# Install backend dependencies
cd server
npm install
cd ..
```

## Step 4: Create Environment Files

### Frontend Environment File
```bash
# Create frontend environment file
cat > .env.production << EOF
VITE_API_BASE_URL=http://174.127.171.180
EOF
```

### Backend Environment File
```bash
# Create backend environment file
cat > server/.env << EOF
NODE_ENV=production
PORT=3001
JWT_SECRET=your-super-secure-jwt-secret-here-make-it-32-plus-characters
AZURE_SQL_SERVER=your-server.database.windows.net
AZURE_SQL_DATABASE=your-database-name
AZURE_CLIENT_ID=your-azure-client-id
AZURE_CLIENT_SECRET=your-azure-client-secret
AZURE_TENANT_ID=your-azure-tenant-id
EOF
```

**Important:** Replace the Azure database credentials with your actual values!

## Step 5: Build the Application
```bash
# Build frontend for production
npm run build

# The build files will be in the 'dist' directory
```

## Step 6: Configure PM2 Process Manager
```bash
# Create PM2 ecosystem file
cat > ecosystem.config.js << EOF
module.exports = {
  apps: [{
    name: 'vocabulary-backend',
    script: './server/server.ts',
    cwd: '/var/www/vocabulary-app',
    interpreter: 'node',
    interpreter_args: '--loader ts-node/esm',
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
EOF

# Create logs directory
mkdir -p logs

# Install ts-node for TypeScript support
npm install -g ts-node

# Start the backend with PM2
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Follow the instructions to enable auto-start
```

## Step 7: Configure Nginx
```bash
# Create Nginx configuration
sudo tee /etc/nginx/sites-available/vocabulary-app << EOF
server {
    listen 80;
    server_name 174.127.171.180;

    # Frontend (React build)
    location / {
        root /var/www/vocabulary-app/dist;
        index index.html;
        try_files \$uri \$uri/ /index.html;
        
        # Cache static assets
        location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
            expires 1y;
            add_header Cache-Control "public, immutable";
        }
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
}
EOF

# Enable the site
sudo ln -s /etc/nginx/sites-available/vocabulary-app /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl reload nginx
```

## Step 8: Configure Firewall
```bash
# Configure UFW firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp  # For future HTTPS
sudo ufw enable

# Check firewall status
sudo ufw status
```

## Step 9: Router Port Forwarding
**On your router admin panel (usually 192.168.1.1 or 192.168.0.1):**

1. Find "Port Forwarding" or "Virtual Server" section
2. Add this rule:
   - **Service Name:** Web Server HTTP
   - **External Port:** 80
   - **Internal IP:** [Your server's internal IP]
   - **Internal Port:** 80
   - **Protocol:** TCP

## Step 10: Test Deployment
```bash
# Check PM2 status
pm2 status

# Check Nginx status
sudo systemctl status nginx

# Check if backend is responding
curl http://localhost:3001/api/

# Test from external network
# Visit: http://174.127.171.180
```

## Troubleshooting Commands
```bash
# View PM2 logs
pm2 logs

# Restart services
pm2 restart all
sudo systemctl reload nginx

# Check ports
sudo netstat -tlnp | grep :80
sudo netstat -tlnp | grep :3001
```

## Future Updates
```bash
# To update the application
cd /var/www/vocabulary-app
git pull origin main
npm install
npm run build
cd server && npm install
pm2 restart all
```

Your vocabulary app will be accessible at: **http://174.127.171.180**
