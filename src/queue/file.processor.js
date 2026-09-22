const xlsx = require('xlsx');
const fs = require('fs');
const mongoose = require('mongoose');
const { Queue } = require('bullmq');
const Job = require('../models/Job');
const connectDB = require('../config/database');
const { redisOptions } = require('../config/redis');

// Initialize queue for adding jobs
// We create a new instance because this runs in a separate process
const urlQueue = new Queue('url-processing', {
  connection: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: false,
    removeOnFail: false
  }
});

let isDBConnected = false;

module.exports = async (job) => {
  const { filePath, userId, type = 'normal' } = job.data;
  
  try {
    // Ensure DB is connected
    if (!isDBConnected) {
      await connectDB();
      isDBConnected = true;
    }

    console.log(`📂 [FileProcessor] Processing file: ${filePath}`);

    // Read Excel file
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(sheet);
    
    // Extract URLs
    let urls = data.map(row => {
      return row.url || row.URL || row.Url || row.website || row.Website;
    }).filter(Boolean);
    
    // Remove duplicates within the file itself
    urls = [...new Set(urls)];

    if (urls.length === 0) {
      throw new Error('No URLs found in Excel file');
    }

    console.log(`Found ${urls.length} URLs in file. Checking for duplicates in DB...`);

    // Check for existing URLs in DB to avoid re-visiting
    // We process in chunks to avoid massive queries
    const chunkSize = 1000;
    const newJobs = [];
    const duplicates = [];

    for (let i = 0; i < urls.length; i += chunkSize) {
      const chunk = urls.slice(i, i + chunkSize);
      
      // Find existing URLs
      const existingJobs = await Job.find({
        url: { $in: chunk }
        // We could filter by userId if we wanted user-specific uniqueness
        // userId: userId 
      }).select('url');

      const existingUrls = new Set(existingJobs.map(j => j.url));
      
      const uniqueChunk = chunk.filter(url => !existingUrls.has(url));
      duplicates.push(...chunk.filter(url => existingUrls.has(url)));

      // Prepare new job objects
      const jobsToInsert = uniqueChunk.map(url => ({
        url,
        userId,
        type,
        status: 'pending',
      }));

      if (jobsToInsert.length > 0) {
        // Bulk insert to DB
        const insertedJobs = await Job.insertMany(jobsToInsert);
        newJobs.push(...insertedJobs);
      }
      
      // Report progress
      const progress = Math.round(((i + chunkSize) / urls.length) * 50); // First 50% is DB insertion
      await job.updateProgress(progress);
    }

    console.log(`Database insertion complete. New: ${newJobs.length}, Duplicates: ${duplicates.length}`);

    // Process only the first batch immediately (50 URLs) as per requirement
    // The rest will be picked up by the cron job
    const initialBatchSize = 50;
    const initialBatch = newJobs.slice(0, initialBatchSize);
    
    if (initialBatch.length > 0) {
      const queueJobs = initialBatch.map(jobDoc => ({
        name: 'process-url',
        data: {
          jobId: jobDoc._id.toString(),
          url: jobDoc.url,
          type
        }
      }));

      await urlQueue.addBulk(queueJobs);
      
      // Update status to queued for these 50
      await Job.updateMany(
        { _id: { $in: initialBatch.map(j => j._id) } },
        { status: 'queued' }
      );
      
      console.log(`🚀 Immediately queued first ${initialBatch.length} jobs.`);
    }

    await job.updateProgress(100);

    // Clean up file
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (err) {
      console.error('Failed to delete file:', err);
    }

    return {
      processed: urls.length,
      added: newJobs.length,
      duplicates: duplicates.length
    };

  } catch (error) {
    console.error('File processing error:', error);
    throw error;
  }
};
