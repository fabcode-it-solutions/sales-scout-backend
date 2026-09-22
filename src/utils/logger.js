const fs = require('fs');
const path = require('path');
const Log = require('../models/Log');

class Logger {
  constructor() {
    this.logDir = path.join(__dirname, '../../logs');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }
  
  async log(level, message, data = {}) {
    const timestamp = new Date().toISOString();
    const logEntry = {
      timestamp,
      level,
      message,
      ...data
    };
    
    // Console output
    const color = {
      info: '\x1b[36m',    // Cyan
      success: '\x1b[32m', // Green
      warning: '\x1b[33m', // Yellow
      error: '\x1b[31m',   // Red
      reset: '\x1b[0m'
    };
    
    console.log(
      `${color[level] || ''}[${timestamp}] [${level.toUpperCase()}] ${message}${color.reset}`
    );
    
    // File output
    try {
      const logFile = path.join(this.logDir, `${new Date().toISOString().split('T')[0]}.log`);
      fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
    } catch (err) {
      console.error('Failed to write to log file:', err.message);
    }

    // Database output
    try {
      // We don't await this to avoid blocking execution flow, but we catch errors
      Log.create({
        level,
        message,
        details: data,
        timestamp: new Date()
      }).catch(err => console.error('Failed to write log to DB:', err.message));
    } catch (err) {
      console.error('Failed to initiate DB log:', err.message);
    }
  }
  
  info(message, data) {
    this.log('info', message, data);
  }
  
  success(message, data) {
    this.log('success', message, data);
  }
  
  warning(message, data) {
    this.log('warning', message, data);
  }
  
  error(message, data) {
    this.log('error', message, data);
  }
}

module.exports = new Logger();
