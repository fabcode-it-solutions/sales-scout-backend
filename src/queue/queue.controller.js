const { urlQueue } = require("./processor");
const Job = require("../models/Job");

class QueueController {
  async addJob(url, userId, type = "normal") {
    try {
      // Create job in database
      const job = await Job.create({
        url,
        userId,
        status: "pending",
        type,
      });

      // Add to queue
      await urlQueue.add("process-url", {
        jobId: job._id.toString(),
        url,
        type,
      });

      console.log(
        `📝 Added job ${job._id} to queue for ${url} (type: ${type})`,
      );

      return job;
    } catch (error) {
      console.error("Error adding job to queue:", error.message);
      throw error;
    }
  }

  async addBulkJobs(urls, userId) {
    try {
      const jobs = [];

      for (const url of urls) {
        const job = await this.addJob(url, userId);
        jobs.push(job);
      }

      return jobs;
    } catch (error) {
      console.error("Error adding bulk jobs:", error.message);
      throw error;
    }
  }

  async getJobStatus(jobId) {
    try {
      const job = await Job.findById(jobId);
      return job;
    } catch (error) {
      console.error("Error getting job status:", error.message);
      throw error;
    }
  }

  async getAllJobs(filters = {}, page = 1, limit = 10) {
    try {
      const skip = (page - 1) * limit;
      const limitNum = parseInt(limit);

      const [jobs, total] = await Promise.all([
        Job.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
        Job.countDocuments(filters),
      ]);

      return {
        jobs,
        pagination: {
          page: parseInt(page),
          limit: limitNum,
          total,
          totalPages: Math.ceil(total / limitNum),
        },
      };
    } catch (error) {
      console.error("Error getting jobs:", error.message);
      throw error;
    }
  }

  async getQueueStats() {
    try {
      const waiting = await urlQueue.getWaitingCount();
      const active = await urlQueue.getActiveCount();
      const completed = await urlQueue.getCompletedCount();
      const failed = await urlQueue.getFailedCount();

      return {
        waiting,
        active,
        completed,
        failed,
        total: waiting + active + completed + failed,
      };
    } catch (error) {
      console.error("Error getting queue stats:", error.message);
      throw error;
    }
  }

  async cleanQueue() {
    try {
      await urlQueue.obliterate({ force: true });
      return { success: true, message: "Queue cleared successfully" };
    } catch (error) {
      console.error("Error cleaning queue:", error.message);
      throw error;
    }
  }
}

module.exports = new QueueController();
