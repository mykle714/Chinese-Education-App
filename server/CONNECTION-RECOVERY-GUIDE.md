# Database Connection Recovery System

## Overview

This system implements robust database connection recovery for Azure SQL Database to handle idle connection timeouts and ensure 24/7 production reliability with PM2.

## Problem Solved

- **Idle Connection Timeouts**: Azure SQL automatically closes idle connections after ~30 minutes
- **Sensitive Information Exposure**: Database errors previously exposed server names and connection details to clients
- **Production Reliability**: Ensures the app can recover from connection drops without manual intervention

## Architecture

### On-Demand Connection Creation

Instead of maintaining persistent connection pools, the system creates fresh connections on demand:

```typescript
// Old approach (problematic)
const poolPromise = new sql.ConnectionPool(config).connect();

// New approach (resilient)
async function createConnection(): Promise<sql.ConnectionPool> {
  const pool = new sql.ConnectionPool(config);
  await pool.connect();
  return pool;
}
```

### Retry Logic with Exponential Backoff

When connections fail, the system automatically retries with increasing delays:

- Attempt 1: Immediate
- Attempt 2: 1 second delay
- Attempt 3: 2 seconds delay
- Attempt 4: 4 seconds delay

### Error Sanitization

All database errors are sanitized before reaching clients:

```typescript
// Server logs (detailed for debugging)
console.error('Database Connection Failed:', {
  message: err.message,
  code: err.code,
  number: err.number,
  timestamp: new Date().toISOString()
});

// Client response (sanitized)
throw new Error('Database connection unavailable');
```

## Key Components

### 1. Database Connection (`server/db.ts`)

- **Purpose**: Creates fresh database connections on demand
- **Key Feature**: Logs detailed errors server-side, throws generic errors to prevent info leakage

### 2. DatabaseManager (`server/dal/base/DatabaseManager.ts`)

- **Purpose**: Manages connections with retry logic and performance monitoring
- **Key Features**:
  - 3-attempt retry with exponential backoff
  - Connection health monitoring
  - Performance statistics tracking
  - Transaction support with recovery

### 3. Error Sanitization (`server/types/dal.ts`)

- **Purpose**: Provides sanitized error responses for clients
- **Key Method**: `toClientError()` removes sensitive information

### 4. Controller Updates

All controllers now use sanitized error handling:
- `UserController.ts`
- `VocabEntryController.ts` 
- `OnDeckVocabController.ts`

## Production Monitoring

### Health Check Endpoint

The system provides connection health monitoring:

```typescript
const healthStatus = await dbManager.healthCheck();
// Returns: { isHealthy, connectionTime, lastChecked, error? }
```

### Connection Statistics

Track connection performance:

```typescript
const stats = dbManager.getConnectionStats();
// Returns: { activeConnections, totalConnections, averageResponseTime }
```

### Server Logs

Monitor these log patterns in production:

#### Successful Connection Recovery
```
Database connection attempt 1/3 failed: [error details]
Retrying database connection in 1000ms...
Connected to Azure SQL Database
```

#### Connection Health Issues
```
Database Connection Failed: {
  message: "Failed to connect to mykle.database.windows.net:1433 in 15000ms",
  code: "ECONNREFUSED",
  timestamp: "2025-01-15T10:30:00.000Z"
}
```

#### Sanitized Client Responses
```
UserController error: [detailed server logs]
Client receives: { error: "Service temporarily unavailable. Please try again later.", code: "ERR_SERVICE_UNAVAILABLE" }
```

## PM2 Configuration

### Recommended PM2 Settings

```javascript
// ecosystem.config.cjs
module.exports = {
  apps: [{
    name: 'vocabulary-backend',
    script: './server/server.ts',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    
    // Connection recovery settings
    max_restarts: 10,
    min_uptime: '10s',
    
    // Environment variables
    env: {
      NODE_ENV: 'production',
      PORT: 3001
    },
    
    // Logging
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_file: './logs/combined.log',
    time: true
  }]
};
```

### PM2 Monitoring Commands

```bash
# Check application status
pm2 status

# View real-time logs
pm2 logs vocabulary-backend

# Monitor connection recovery
pm2 logs vocabulary-backend | grep -E "(Database connection|retry|Connected)"

# Check memory usage
pm2 monit

# Restart if needed
pm2 restart vocabulary-backend
```

## Testing

### Manual Testing

Run the connection recovery test:

```bash
cd server
node tests/test-connection-recovery.js
```

### Expected Test Output

```
🧪 Testing Database Connection Recovery System
============================================================
✅ Services initialized successfully

📋 Test 1: Basic Connection Test
✅ Successfully retrieved X users

📋 Test 2: Multiple Rapid Requests
✅ Successful requests: 5
❌ Failed requests: 0

📋 Test 3: Connection Health Check
Health Status: { isHealthy: true, connectionTime: "45ms", lastChecked: "2025-01-15T10:30:00.000Z" }
✅ Database connection is healthy

📋 Test 4: Connection Statistics
Connection Statistics: { activeConnections: 0, totalConnections: 8, averageResponseTime: "42.50ms" }
✅ Connection statistics retrieved successfully

🎉 Connection recovery tests completed!
```

## Troubleshooting

### Common Issues

#### 1. Connection Timeouts After Idle Period

**Symptoms**: Users get "Service temporarily unavailable" after app is idle
**Solution**: System automatically handles this with retry logic
**Monitoring**: Check logs for retry attempts

#### 2. High Connection Count

**Symptoms**: Many active connections in statistics
**Solution**: Connections are created on-demand and should close automatically
**Monitoring**: Check `activeConnections` in statistics

#### 3. Persistent Connection Failures

**Symptoms**: All retry attempts fail consistently
**Possible Causes**:
- Azure SQL database is down
- Network connectivity issues
- Authentication problems
- Database server overloaded

**Actions**:
1. Check Azure SQL Database status
2. Verify environment variables
3. Test network connectivity
4. Check database server metrics

### Log Analysis

#### Healthy Operation
```bash
# Look for successful connections
grep "Connected to Azure SQL Database" logs/combined.log

# Check retry success rate
grep -c "Database connection attempt" logs/combined.log
grep -c "Connected to Azure SQL Database" logs/combined.log
```

#### Connection Issues
```bash
# Find connection failures
grep "Database Connection Failed" logs/combined.log

# Check retry patterns
grep "Retrying database connection" logs/combined.log

# Monitor error sanitization
grep "toClientError" logs/combined.log
```

## Security Features

### Information Sanitization

The system removes sensitive information from client responses:

- Server names (e.g., `mykle.database.windows.net` → `[server]`)
- IP addresses
- Port numbers
- Connection timeouts
- Internal error codes

### Server-Side Logging

Full error details are logged server-side for debugging while clients receive generic messages.

## Performance Impact

### Connection Creation Overhead

- **Impact**: ~50-100ms per new connection
- **Mitigation**: Connections are reused within request lifecycle
- **Acceptable**: For once-daily user interaction patterns

### Memory Usage

- **Before**: Persistent connection pool
- **After**: On-demand connections (lower memory footprint)
- **Monitoring**: Track via PM2 memory statistics

## Future Enhancements

### Potential Improvements

1. **Connection Pooling**: Implement short-lived connection pools (5-10 minutes)
2. **Circuit Breaker**: Add circuit breaker pattern for cascading failures
3. **Metrics Dashboard**: Create real-time connection health dashboard
4. **Alerting**: Set up alerts for connection failure rates

### Monitoring Enhancements

1. **Health Check Endpoint**: Add HTTP endpoint for external monitoring
2. **Prometheus Metrics**: Export connection metrics for monitoring systems
3. **Database Metrics**: Track query performance and connection patterns

## Conclusion

This connection recovery system ensures:

✅ **Automatic Recovery**: From idle connection timeouts  
✅ **Security**: No sensitive information exposed to clients  
✅ **Reliability**: 24/7 operation with PM2  
✅ **Monitoring**: Comprehensive logging and statistics  
✅ **Performance**: Acceptable delays for recovery scenarios  

The system is production-ready and handles the specific challenges of Azure SQL Database idle timeouts while maintaining security and reliability standards.
