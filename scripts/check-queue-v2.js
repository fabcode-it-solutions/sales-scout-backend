require('dotenv').config(); // Load env vars first!
const { Queue } = require('bullmq');
const mongoose = require('mongoose');
const { redisOptions } = require('../src/config/redis');
const connectDB = require('../src/config/database');
const Job = require('../src/models/Job');

async function checkQueue() {
  console.log('Using Redis Host:', process.env.REDIS_HOST || 'localhost');
  
  // Connect to Redis Queue
  const urlQueue = new Queue('url-processing', {
    connection: redisOptions
  });

  try {
      // Connect to MongoDB
      await connectDB();

      console.log('\n--- Redis Queue Status ---');
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
      } else {
        console.log('Redis Queue is empty.');
      }

      console.log('\n--- MongoDB Job Status ---');
      const pendingCount = await Job.countDocuments({ status: 'pending' });
      const queuedCount = await Job.countDocuments({ status: 'queued' });
      const processingCount = await Job.countDocuments({ status: 'processing' });
      const completedDbCount = await Job.countDocuments({ status: 'completed' });
      const failedDbCount = await Job.countDocuments({ status: 'failed' });

      console.log({
        pending: pendingCount,
        queued: queuedCount,
        processing: processingCount,
        completed: completedDbCount,
        failed: failedDbCount
      });

      if (pendingCount > 0) {
        console.log(`\n⚠️  You have ${pendingCount} pending jobs in the database.`);
        console.log('   Restart the server to process the next batch of 70.');
      } else {
        console.log('\n✅ No pending jobs in database.');
      }

  } catch (err) {
      console.error('Error checking status:', err);
  } finally {
    await urlQueue.close();
    await mongoose.disconnect();
    process.exit(0);
  }
}

checkQueue().catch(console.error);
