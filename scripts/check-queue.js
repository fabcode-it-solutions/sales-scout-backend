const { Queue } = require('bullmq');
const redis = require('../src/config/redis');

async function checkQueue() {
  console.log('Connecting to Redis...');
  
  const urlQueue = new Queue('url-processing', {
    connection: redis
  });

  console.log('Checking queue status...');
  
  const waiting = await urlQueue.getWaitingCount();
  const active = await urlQueue.getActiveCount();
  const completed = await urlQueue.getCompletedCount();
  const failed = await urlQueue.getFailedCount();
  const delayed = await urlQueue.getDelayedCount();
  
  console.log({
    waiting,
    active,
    completed,
    failed,
    delayed
  });

  if (waiting > 0 || active > 0) {
    console.log('Jobs are in the queue.');
    const jobs = await urlQueue.getJobs(['waiting', 'active'], 0, 5);
    jobs.forEach(job => {
      console.log(`Job ${job.id}: Status=${job.state}, Data=${JSON.stringify(job.data)}`);
      if (job.stacktrace && job.stacktrace.length > 0) {
          console.log('Stacktrace:', job.stacktrace);
      }
    });
  } else {
    console.log('Queue is empty of pending work.');
  }

  await urlQueue.close();
  // Don't close redis connection immediately if it's shared, but here it's fine
  process.exit(0);
}

checkQueue().catch(console.error);
