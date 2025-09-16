# PM2 Process Management Commands

## View All Running Processes

### Basic Status View
```bash
pm2 status
# or
pm2 list
# or
pm2 ls
```
Shows a table with all processes, their status, CPU usage, memory usage, and restart count.

### Detailed Process Information
```bash
pm2 show <process-name>
# Example:
pm2 show vocabulary-backend
```
Shows detailed information about a specific process.

### Real-time Monitoring
```bash
pm2 monit
```
Opens a real-time monitoring dashboard with CPU/memory usage graphs.

## Process Logs

### View Logs for All Processes
```bash
pm2 logs
```

### View Logs for Specific Process
```bash
pm2 logs vocabulary-backend
```

### View Last 100 Lines of Logs
```bash
pm2 logs --lines 100
```

### Follow Logs in Real-time
```bash
pm2 logs --follow
```

## Process Control

### Restart All Processes
```bash
pm2 restart all
```

### Restart Specific Process
```bash
pm2 restart vocabulary-backend
```

### Stop All Processes
```bash
pm2 stop all
```

### Stop Specific Process
```bash
pm2 stop vocabulary-backend
```

### Delete Process (removes from PM2 list)
```bash
pm2 delete vocabulary-backend
```

### Reload Process (zero-downtime restart)
```bash
pm2 reload vocabulary-backend
```

## Useful Information Commands

### Show Process Details with Environment Variables
```bash
pm2 env <process-id>
```

### Show PM2 Configuration
```bash
pm2 startup
pm2 save
```

### Clear All Logs
```bash
pm2 flush
```

### Show PM2 Version and Info
```bash
pm2 info
```

## Quick Troubleshooting

### If No Processes Are Running
```bash
pm2 list
# Should show empty list or stopped processes

# Start your process again
pm2 start ecosystem.config.cjs
```

### If Process Shows as "errored"
```bash
pm2 logs vocabulary-backend
# Check the error logs

pm2 restart vocabulary-backend
# Try restarting
```

### Check Process Resource Usage
```bash
pm2 monit
# Real-time monitoring

# Or for a quick snapshot:
pm2 status
```

## Most Common Commands You'll Use

1. **Check status:** `pm2 status`
2. **View logs:** `pm2 logs`
3. **Restart app:** `pm2 restart vocabulary-backend`
4. **Monitor resources:** `pm2 monit`
5. **Stop all:** `pm2 stop all`

Run `pm2 status` first to see all your processes and their current state!
