const Redis = require('ioredis');

const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  maxRetriesPerRequest: null,
};

const redis = new Redis(redisOptions);

redis.on('connect', () => {
  console.log('✅ Redis Connected');
});

redis.on('error', (err) => {
  console.error('❌ Redis Error:', err);
});

module.exports = redis;
module.exports.redisOptions = redisOptions;
