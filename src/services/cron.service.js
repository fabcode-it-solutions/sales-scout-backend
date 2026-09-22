const cron = require("node-cron");
const Job = require("../models/Job");
const { urlQueue } = require("../queue/processor");
const { sendEmail } = require("../utils/smtp.util");
const redis = require("../config/redis");

// Schedule: Run every 3 minutes
// This processes pending jobs in small batches to respect limits, but runs frequently.
const jobScheduler = cron.schedule("*/3 * * * *", async () => {
  console.log("⏰ [Cron] Checking for pending jobs...");

  try {
    // Check if we are currently processing a batch
    // We use a Redis key to track this state to ensure we send the completion email only once
    const PROCESSING_KEY = "sales_scout:processing_batch_active";

    // Fetch pending jobs in batches of 50
    const batchSize = 50;

    const pendingJobs = await Job.find({ status: "pending" })
      .select("_id url type")
      .sort({ createdAt: 1 })
      .limit(batchSize);

    if (pendingJobs.length === 0) {
      console.log("ℹ️ [Cron] No pending jobs found in DB.");

      // Check if the queue is empty
      const counts = await urlQueue.getJobCounts("wait", "active", "delayed");
      const totalInQueue = counts.wait + counts.active + counts.delayed;

      if (totalInQueue === 0) {
        // Queue is empty and no pending jobs.
        // Check if we were previously processing (and thus need to send a completion email)
        const isProcessing = await redis.get(PROCESSING_KEY);

        if (isProcessing === "1") {
          console.log("🎉 [Cron] All jobs completed! Sending notification...");

          // Send completion email
          const recipient = process.env.PENDING_EMAIL;
          if (recipient) {
            try {
              await sendEmail(
                recipient,
                "SalesScout Alert: All Jobs Completed",
                `
                <div style="font-family: Arial, sans-serif; padding: 20px;">
                  <h2>All Jobs Completed</h2>
                  <p>The system has finished processing all pending URLs.</p>
                  <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
                  <p>No more pending jobs in database or queue.</p>
                </div>
                `,
              );
              console.log(
                `📧 [Cron] Completion notification sent to ${recipient}`,
              );
            } catch (emailError) {
              console.error(
                "❌ [Cron] Failed to send completion email:",
                emailError,
              );
            }
          }

          // Reset the processing flag
          await redis.set(PROCESSING_KEY, "0");
        } else {
          console.log("💤 [Cron] System idle. No action needed.");
        }
      } else {
        console.log(
          `⏳ [Cron] Jobs still in queue: Wait: ${counts.wait}, Active: ${counts.active}, Delayed: ${counts.delayed}`,
        );
      }

      return;
    }

    // Found pending jobs
    console.log(
      `🚀 [Cron] Found ${pendingJobs.length} pending jobs. Adding to queue...`,
    );

    // Mark processing as active
    await redis.set(PROCESSING_KEY, "1");

    // Add to BullMQ
    const queueJobs = pendingJobs.map((job) => ({
      name: "process-url",
      data: {
        jobId: job._id.toString(),
        url: job.url,
        type: job.type || "normal",
      },
    }));

    await urlQueue.addBulk(queueJobs);

    // Update status to 'queued'
    await Job.updateMany(
      { _id: { $in: pendingJobs.map((j) => j._id) } },
      { status: "queued" },
    );

    console.log(`✅ [Cron] Successfully queued ${pendingJobs.length} jobs.`);
  } catch (error) {
    console.error("❌ [Cron] Error processing pending jobs:", error);
  }
});

module.exports = jobScheduler;
