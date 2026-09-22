const { Queue, Worker } = require('bullmq');
const path = require('path');
const { pathToFileURL } = require('url');
const { redisOptions } = require('../config/redis');

// Create queue
const fileQueue = new Queue('file-processing', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: true, // We want to clean up file processing jobs
    removeOnFail: false
  }
});

const processor = require('./file.processor');

const fileWorker = new Worker('file-processing', processor, {
  connection: redisOptions,
  concurrency: 1, // Process files one by one to avoid memory spikes
  limiter: {
    max: 10,
    duration: 60000
  }
});

fileWorker.on('completed', (job, result) => {
  console.log(`✅ File processing job ${job.id} completed`);
});

fileWorker.on('failed', (job, err) => {
  console.error(`❌ File processing job ${job.id} failed:`, err.message);
});

fileWorker.on('error', (err) => {
  console.error('File worker error:', err.message);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing file worker...');
  await fileWorker.close();
});

module.exports = { fileQueue, fileWorker };