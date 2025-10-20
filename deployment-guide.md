# Docker Deployment Guide for Vocabulary App
**Target Server IP:** 174.127.171.180
**Repository:** https://github.com/mykle714/Chinese-Education-App.git

## Step 1: SSH into Your Deployment Server
```bash
ssh username@174.127.171.180
```

## Step 2: Update System and Install Docker
```bash
# Update system packages
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install Docker Compose
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Add user to docker group
sudo usermod -aG docker $USER

# Install additional dependencies
sudo apt install -y nginx git ufw

# Verify installations
docker --version
docker-compose --version
nginx -v

# Log out and back in for docker group changes to take effect
exit
# SSH back in
ssh username@174.127.171.180
```

## Step 3: Clone and Setup Application
```bash
# Create web directory and clone repository
sudo mkdir -p /var/www
cd /var/www
sudo git clone https://github.com/mykle714/Chinese-Education-App.git vocabulary-app
sudo chown -R $USER:$USER /var/www/vocabulary-app
cd /var/www/vocabulary-app
```

## Step 4: Configure Production Environment
```bash
# Create production environment file
cat > .env.production << EOF
# Database Configuration
POSTGRES_PASSWORD=your-secure-production-password-here
DB_HOST=postgres
DB_PORT=5432
DB_NAME=cow_db
DB_USER=cow_user

# Application Configuration
JWT_SECRET=your-super-secure-jwt-secret-here-make-it-32-plus-characters
CLIENT_URL=http://174.127.171.180
NODE_ENV=production
PORT=5000
EOF

# Set secure permissions on environment file
chmod 600 .env.production
```

**Important:** Replace the database password and JWT secret with secure values!

## Step 5: Build and Start Docker Services
```bash
# Build and start production services
docker-compose -f docker-compose.prod.yml up --build -d

# Verify services are running
docker-compose -f docker-compose.prod.yml ps

# Check service logs
docker-compose -f docker-compose.prod.yml logs -f
```

## Step 6: Import Multi-Language Dictionaries
**IMPORTANT:** This step is required to populate the database with dictionary data for Chinese, Japanese, Korean, and Vietnamese. This process takes 15-30 minutes.

```bash
# Make the import script executable
chmod +x /var/www/vocabulary-app/server/scripts/import-all-dictionaries.sh

# Run the complete dictionary import process
# This will:
# - Run all database migrations (including multi-language support)
# - Download all 4 language dictionary files
# - Import all dictionaries into the database
bash /var/www/vocabulary-app/server/scripts/import-all-dictionaries.sh production
```

**What this script does:**
- ✅ Runs database migrations (05-09) for multi-language support and texts table
- ✅ Downloads dictionary files:
  - Chinese (CC-CEDICT) - ~120,000 entries
  - Japanese (JMdict) - ~180,000 entries
  - Korean (CC-KEDICT) - ~50,000 entries
  - Vietnamese - ~40,000 entries
- ✅ Imports all dictionaries with progress tracking
- ✅ Verifies each import and displays a summary

**Expected output:**
```
🇨🇳 Chinese dictionary imported: ~120,000 entries
🇯🇵 Japanese dictionary imported: ~180,000 entries
🇰🇷 Korean dictionary imported: ~50,000 entries
🇻🇳 Vietnamese dictionary imported: ~40,000 entries
Total dictionary entries: ~390,000
```

**Note:** The dictionary data is stored in a Docker volume (`postgres_data`) and will persist across container restarts. You only need to run this import process once per deployment, or after a database reset.

## Step 7: Verify Docker Services and Database
```bash
# Check if all containers are running
docker ps

# Test backend health endpoint
curl http://localhost:5000/api/health

# Test database connection
docker-compose -f docker-compose.prod.yml exec backend node -e "
const { Pool } = require('pg');
const pool = new Pool({
  host: 'postgres',
  port: 5432,
  database: 'cow_db',
  user: 'cow_user',
  password: process.env.POSTGRES_PASSWORD
});
pool.query('SELECT NOW()', (err, res) => {
  console.log(err ? err : 'Database connected successfully');
  pool.end();
});
"
```

## Step 8: Configure Nginx (Optional - Docker handles this)
**Note**: The Docker production setup includes Nginx in the container, but you can optionally set up an external reverse proxy:

```bash
# Create Nginx configuration for external reverse proxy (optional)
sudo tee /etc/nginx/sites-available/vocabulary-app << EOF
server {
    listen 80;
    server_name 174.127.171.180;

    # Proxy to Docker frontend container
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Backend API (already handled by frontend container)
    location /api/ {
        proxy_pass http://localhost:5000;
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
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer-when-downgrade" always;
    add_header Content-Security-Policy "default-src 'self' http: https: data: blob: 'unsafe-inline'" always;
}
EOF

# Enable the site (optional)
sudo ln -s /etc/nginx/sites-available/vocabulary-app /etc/nginx/sites-enabled/
sudo nginx -t  # Test configuration
sudo systemctl reload nginx
```

## Step 9: Configure Firewall
```bash
# Configure UFW firewall
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp  # For future HTTPS
sudo ufw allow 3000/tcp  # Docker frontend
sudo ufw allow 5000/tcp  # Docker backend
sudo ufw enable

# Check firewall status
sudo ufw status
```

## Step 10: Router Port Forwarding
**On your router admin panel (usually 192.168.1.1 or 192.168.0.1):**

1. Find "Port Forwarding" or "Virtual Server" section
2. Add these rules:
   - **Service Name:** Web Server HTTP
   - **External Port:** 80
   - **Internal IP:** [Your server's internal IP]
   - **Internal Port:** 3000 (Docker frontend)
   - **Protocol:** TCP

## Step 11: Test Deployment
```bash
# Check Docker container status
docker-compose -f docker-compose.prod.yml ps

# Check Docker service logs
docker-compose -f docker-compose.prod.yml logs

# Check if backend is responding
curl http://localhost:5000/api/health

# Check if frontend is responding
curl http://localhost:3000

# Test from external network
# Visit: http://174.127.171.180
```

## Step 12: Verify Multi-Language Support
```bash
# Check dictionary counts for each language
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "
    SELECT 
        language,
        COUNT(*) as entries,
        CASE language
            WHEN 'zh' THEN '🇨🇳 Chinese'
            WHEN 'ja' THEN '🇯🇵 Japanese'
            WHEN 'ko' THEN '🇰🇷 Korean'
            WHEN 'vi' THEN '🇻🇳 Vietnamese'
            ELSE language
        END as language_name
    FROM \"DictionaryEntries\"
    GROUP BY language
    ORDER BY language;
"

# Test a dictionary lookup for each language
# Chinese
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT word1, word2, pronunciation FROM \"DictionaryEntries\" WHERE language='zh' LIMIT 3;"

# Japanese
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT word1, word2, pronunciation FROM \"DictionaryEntries\" WHERE language='ja' LIMIT 3;"

# Korean
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT word1, word2, pronunciation FROM \"DictionaryEntries\" WHERE language='ko' LIMIT 3;"

# Vietnamese
docker exec -i cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT word1, definitions FROM \"DictionaryEntries\" WHERE language='vi' LIMIT 3;"
```

## Troubleshooting Commands
```bash
# View Docker service logs
docker-compose -f docker-compose.prod.yml logs -f

# Restart Docker services
docker-compose -f docker-compose.prod.yml restart

# Rebuild and restart services
docker-compose -f docker-compose.prod.yml up --build -d

# Check container resource usage
docker stats

# Check ports
sudo netstat -tlnp | grep :80
sudo netstat -tlnp | grep :3000
sudo netstat -tlnp | grep :5000
```

## Dictionary Re-import (If Needed)
If you need to re-import dictionaries (e.g., after a database reset):

```bash
cd /var/www/vocabulary-app

# Re-run the import script
bash server/scripts/import-all-dictionaries.sh production
```

**Note:** The script is idempotent - it will clear existing entries for each language before importing, so it's safe to run multiple times.

## Future Updates
```bash
# To update the application
cd /var/www/vocabulary-app
git pull origin main

# Rebuild and restart Docker services
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d

# Check updated services
docker-compose -f docker-compose.prod.yml ps

# Note: Dictionary data persists in the postgres_data volume
# You don't need to re-import dictionaries after updates unless:
# - The database schema changed (new migrations)
# - You explicitly want to update dictionary data
```

## Data Persistence
Your dictionary data and user data are stored in Docker volumes:
- `postgres_data`: Contains all database data including dictionaries
- This volume persists across container restarts and rebuilds
- To backup: `docker run --rm -v postgres_data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-backup.tar.gz /data`
- To restore: `docker run --rm -v postgres_data:/data -v $(pwd):/backup alpine tar xzf /backup/postgres-backup.tar.gz -C /`

Your vocabulary app will be accessible at: **http://174.127.171.180**
