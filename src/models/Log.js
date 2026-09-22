const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
  level: {
    type: String,
    enum: ['info', 'success', 'warning', 'error'],
    required: true
  },
  message: {
    type: String,
    required: true
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true // adds createdAt and updatedAt
});

// Index for faster queries
logSchema.index({ createdAt: -1 });
logSchema.index({ level: 1 });

module.exports = mongoose.model('Log', logSchema);
