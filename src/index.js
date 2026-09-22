require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const connectDB = require('./config/database');
const jobRoutes = require('./routes/job.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const { authenticate, authorize } = require('./middleware/auth.middleware');

// Initialize app
const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
// app.use(helmet());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
}));
app.use(cors({
  origin: true, // Reflects the request origin to support credentials on different devices/IPs
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Connect to database
const startServer = async () => {
  try {
    await connectDB();
    
    // Initialize queue worker
    require('./queue/processor');
    require('./queue/file.queue');
    require('./services/cron.service');

    // Routes
    app.get('/', (req, res) => {
      res.json({
        message: 'SalesScout API is running!',
        version: '1.0.0',
        endpoints: {
          'POST /api/upload-excel': 'Upload Excel file with URLs',
          'POST /api/add-url': 'Add single URL to queue',
          'GET /api/job/:id': 'Get job status',
          'GET /api/jobs': 'Get all jobs',
          'GET /api/stats': 'Get queue statistics',
          'GET /api/results': 'Get completed results'
        }
      });
    });

    app.use('/api/auth', authRoutes);
    app.use('/api/admin', authenticate, authorize(['admin']), adminRoutes);
    app.use('/api', authenticate, authorize(['customer', 'admin']), jobRoutes);

    // Health check
    app.get('/health', (req, res) => {
      res.json({ status: 'healthy', timestamp: new Date() });
    });

    // Error handling middleware
    app.use((err, req, res, next) => {
      console.error('Error:', err.message);
      res.status(500).json({ 
        error: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      });
    });

    // Start server
    app.listen(PORT, () => {
      console.log(`
    ╔═══════════════════════════════════════════╗
    ║                                           ║
    ║   🚀 SalesScout Backend Server Started   ║
    ║                                           ║
    ║   Port: ${PORT}                              ║
    ║   Environment: ${process.env.NODE_ENV || 'development'}              ║
    ║   API: http://localhost:${PORT}              ║
    ║                                           ║
    ╚═══════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  process.exit(0);
});
