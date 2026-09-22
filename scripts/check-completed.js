require('dotenv').config();
const { Queue } = require('bullmq');
const redis = require('../src/config/redis');

async function checkCompleted() {
  console.log('Checking completed jobs...');
  
  const urlQueue = new Queue('url-processing', {
    connection: redis
  });

  const jobs = await urlQueue.getJobs(['completed'], 0, 5, true); // true to include return values
  
  for (const job of jobs) {
    console.log(`\nJob ${job.id} (Completed):`);
    console.log('Data:', JSON.stringify(job.data));
    console.log('Result:', JSON.stringify(job.returnvalue));
    console.log('Finished On:', new Date(job.finishedOn).toLocaleString());
  }

  // await urlQueue.close();
  // process.exit(0);
}

checkCompleted().catch(console.error);
