# PM2 ES Module Fix

## The Problem
You're getting this error because your project uses ES modules (`"type": "module"` in package.json), but PM2 ecosystem config was using CommonJS syntax.

## Quick Fix (Run these commands on your server)

### 1. Remove the old ecosystem file
```bash
rm ecosystem.config.js
```

### 2. Create the correct ecosystem file with .cjs extension
```bash
cat > ecosystem.config.cjs << EOF
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
```

### 3. Start PM2 with the correct file
```bash
pm2 start ecosystem.config.cjs
```

### 4. Save PM2 configuration
```bash
pm2 save
pm2 startup
```

## Why This Happened
- Your project has `"type": "module"` in package.json
- This makes all `.js` files ES modules by default
- PM2 ecosystem configs use CommonJS syntax (`module.exports`)
- Solution: Use `.cjs` extension to force CommonJS mode

## Verify It's Working
```bash
pm2 status
pm2 logs
```

