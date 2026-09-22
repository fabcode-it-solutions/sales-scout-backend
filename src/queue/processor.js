const { Queue, Worker } = require("bullmq");
const { redisOptions } = require("../config/redis");
const workflowService = require("../services/workflow.service");
const Job = require("../models/Job");

// Create queue
const urlQueue = new Queue("url-processing", {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 2000,
    },
    removeOnComplete: false,
    removeOnFail: false,
  },
});

// Create worker
const worker = new Worker(
  "url-processing",
  async (job) => {
    const { jobId, url, type = "normal" } = job.data;

    console.log(
      `\n🚀 Processing job ${job.id} for URL: ${url} (type: ${type})`,
    );

    try {
      const result = await workflowService.processURL(jobId, url, type);
      return result;
    } catch (error) {
      console.error(`Failed to process ${url}:`, error.message);
      throw error;
    }
  },
  {
    connection: redisOptions,
    // Reduce concurrency to avoid hitting rate limits immediately
    concurrency: 1,
    // Add rate limiting: Max 5 jobs per 60 seconds
    // limiter: {
    //   max: 5,
    //   duration: 60000
    // }
  },
);

// --- Queue Monitoring ---
setInterval(async () => {
  try {
    const counts = await urlQueue.getJobCounts(
      "wait",
      "active",
      "completed",
      "failed",
      "delayed",
    );
    const waiting = await urlQueue.getWaiting();
    const active = await urlQueue.getActive();
    const delayed = await urlQueue.getDelayed(); // Get delayed jobs

    console.log("---------------------------------------------------");
    console.log(
      `📊 Queue Status: Wait: ${counts.wait} | Active: ${counts.active} | Fail: ${counts.failed} | Done: ${counts.completed} | Delayed: ${counts.delayed}`,
    );
    if (waiting.length > 0)
      console.log(`⏳ Waiting IDs: ${waiting.map((j) => j.id).join(", ")}`);
    if (active.length > 0)
      console.log(`▶️ Active IDs: ${active.map((j) => j.id).join(", ")}`);
    if (delayed.length > 0)
      console.log(`zzz Delayed IDs: ${delayed.map((j) => j.id).join(", ")}`); // Print delayed IDs
    console.log("---------------------------------------------------");
  } catch (err) {
    console.error("Monitor Error:", err.message);
  }
}, 10000); // Check every 10 seconds

// Event handlers
worker.on("active", (job) => {
  console.log(`✅ Job ${job.id} active`);
});
worker.on("completed", (job, result) => {
  console.log(`✅ Job ${job.id} completed successfully`);
});

worker.on("failed", async (job, err) => {
  console.error(`❌ Job ${job.id} failed:`, err.message);

  // Update retry count
  if (job?.data?.jobId) {
    await Job.findByIdAndUpdate(job.data.jobId, {
      $inc: { retryCount: 1 },
    });
  }
});

worker.on("progress", (job, progress) => {
  console.log(`📊 Job ${job.id} progress: ${progress}%`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("SIGTERM received, closing worker...");
  await worker.close();
  // No need to quit redis here as we are using separate connections per worker/queue
});

module.exports = { urlQueue, worker };
