const IORedis = require('ioredis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
console.log('Testing connection to:', redisUrl);

const redis = new IORedis(redisUrl, {
  maxRetriesPerRequest: null
});

redis.on('connect', () => {
  console.log('✅ Connected to Redis successfully!');
  redis.quit();
});

redis.on('error', (err) => {
  console.error('❌ Redis Connection Error:', err.message);
  process.exit(1);
});
