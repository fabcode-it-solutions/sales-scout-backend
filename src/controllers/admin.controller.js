const fs = require('fs');
const path = require('path');
const Activity = require('../models/Activity');
const Log = require('../models/Log');
const User = require('../models/User');
const Notification = require('../models/Notification');
const Job = require('../models/Job');
const logger = require('../utils/logger');

async function getLogs(req, res) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    const skip = (page - 1) * limit;

    const [logs, total] = await Promise.all([
      Log.find().sort({ createdAt: -1 }).skip(skip).limit(limit),
      Log.countDocuments()
    ]);
    
    res.json({ 
      source: 'database',
      entries: logs,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    // Fallback to file system if DB fails (or just return empty)
    const dir = path.join(__dirname, '../../logs');
    if (!fs.existsSync(dir)) return res.json({ logs: [] });
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.log')).sort().reverse();
    const file = files[0];
    if (!file) return res.json({ logs: [] });
    const content = fs.readFileSync(path.join(dir, file), 'utf-8').trim().split('\n').slice(-200).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
    res.json({ file, entries: content });
  }
}

async function getActivity(req, res) {
  const page = parseInt(req.query.page || '1', 10);
  const limit = parseInt(req.query.limit || '10', 10);
  const skip = (page - 1) * limit;

  const [items, total] = await Promise.all([
    Activity.aggregate([
      { $sort: { createdAt: -1 } },
      { $skip: skip },
      { $limit: limit },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user'
        }
      },
      {
        $unwind: {
          path: '$user',
          preserveNullAndEmptyArrays: true
        }
      },
      {
        $project: {
          _id: 1,
          type: 1,
          details: 1,
          createdAt: 1,
          userId: {
            name: '$user.name',
            email: '$user.email'
          }
        }
      }
    ]),
    Activity.countDocuments()
  ]);

  res.json({ 
    items,
    pagination: {
      page,
      limit,
      totalItems: total,
      totalPages: Math.ceil(total / limit)
    }
  });
}

async function getUsers(req, res) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    const skip = (page - 1) * limit;

    const [users, total] = await Promise.all([
      User.find().select('-passwordHash').sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments()
    ]);

    res.json({ 
      users,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching users', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
}

const { sendEmail } = require('../utils/smtp.util');

async function createUser(req, res) {
  try {
    const { name, email, role, isActive } = req.body;
    
    // Check if user exists
    const exists = await User.findOne({ email });
    if (exists) {
      return res.status(409).json({ error: 'Email already in use' });
    }

    // Generate random password
    const generatedPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();

    const user = await User.create({
      name,
      email,
      passwordHash: generatedPassword,
      role: role || 'customer',
      isActive: isActive !== undefined ? isActive : true
    });

    // Send email to user
    try {
      await sendEmail(
        email,
        'Welcome to SalesScout - Your Credentials',
        `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #e2e8f0;">
          <div style="background-color: #2563eb; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">SalesScout</h1>
          </div>
          <div style="padding: 32px 24px;">
            <h2 style="color: #1e293b; margin-top: 0; font-size: 20px;">Welcome Aboard, ${name || 'User'}!</h2>
            <p style="color: #475569; line-height: 1.6; margin-bottom: 24px;">Your account has been successfully created. We're excited to have you with us.</p>
            
            <div style="background-color: #f1f5f9; border-left: 4px solid #2563eb; padding: 16px; margin-bottom: 24px; border-radius: 4px;">
              <p style="margin: 0 0 8px 0; color: #475569; font-size: 14px;">Email Address</p>
              <p style="margin: 0 0 16px 0; color: #1e293b; font-weight: 600; font-size: 16px;">${email}</p>
              <p style="margin: 0 0 8px 0; color: #475569; font-size: 14px;">Temporary Password</p>
              <p style="margin: 0; color: #1e293b; font-weight: 600; font-size: 16px; font-family: monospace; background: #e2e8f0; padding: 4px 8px; display: inline-block; border-radius: 4px;">${generatedPassword}</p>
            </div>

            <p style="color: #475569; line-height: 1.6; margin-bottom: 32px;">For your security, please log in and change your password immediately.</p>
            
            <div style="text-align: center;">
              <a href="${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/login" style="background-color: #2563eb; color: #ffffff; padding: 12px 32px; text-decoration: none; border-radius: 6px; font-weight: 600; display: inline-block; transition: background-color 0.2s;">Access Your Account</a>
            </div>
          </div>
          <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} SalesScout. All rights reserved.</p>
            <p style="color: #94a3b8; font-size: 12px; margin: 8px 0 0 0;">This is an automated message, please do not reply.</p>
          </div>
        </div>
        `
      );
    } catch (emailError) {
      logger.error('Failed to send welcome email', { error: emailError.message, email });
      // Don't fail the request, just log it
    }

    logger.success('Admin created user', { adminId: req.user._id, newUserId: user._id, email });
    
    res.status(201).json({ 
      user: { 
        id: user._id, 
        name: user.name, 
        email: user.email, 
        role: user.role, 
        isActive: user.isActive 
      } 
    });
  } catch (error) {
    logger.error('Error creating user', { error: error.message });
    res.status(500).json({ error: 'Failed to create user' });
  }
}

async function updateUserStatus(req, res) {
  try {
    const { id } = req.params;
    const { isActive } = req.body;
    
    const user = await User.findByIdAndUpdate(
      id, 
      { isActive }, 
      { new: true }
    ).select('-passwordHash');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info('Admin updated user status', { adminId: req.user._id, targetUserId: id, isActive });
    res.json({ user });
  } catch (error) {
    logger.error('Error updating user status', { error: error.message });
    res.status(500).json({ error: 'Failed to update user status' });
  }
}

async function updateUser(req, res) {
  try {
    const { id } = req.params;
    const { name, email, password, role } = req.body;
    
    const updates = {};
    if (name) updates.name = name;
    if (email) updates.email = email;
    if (role) updates.role = role;
    if (password) {
      // Manually hash password since findByIdAndUpdate bypasses pre-save middleware
      const bcrypt = require('bcryptjs');
      const salt = await bcrypt.genSalt(10);
      updates.passwordHash = await bcrypt.hash(password, salt);
    }

    // Check email uniqueness if changing
    if (email) {
      const exists = await User.findOne({ email, _id: { $ne: id } });
      if (exists) {
        return res.status(409).json({ error: 'Email already in use' });
      }
    }

    const user = await User.findByIdAndUpdate(
      id,
      updates,
      { new: true, runValidators: true }
    ).select('-passwordHash');

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.success('Admin updated user details', { adminId: req.user._id, targetUserId: id, updates: Object.keys(updates) });
    res.json({ user });
  } catch (error) {
    logger.error('Error updating user', { error: error.message });
    res.status(500).json({ error: 'Failed to update user' });
  }
}

async function getNotifications(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const skip = (page - 1) * limit;

    const [notifications, total] = await Promise.all([
      Notification.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Notification.countDocuments()
    ]);
    
    res.json({ 
      notifications,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching notifications', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch notifications' });
  }
}

async function resolveNotification(req, res) {
  try {
    const { id } = req.params;
    const notification = await Notification.findByIdAndUpdate(
      id,
      { 
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: req.user._id
      },
      { new: true }
    );
    
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    
    res.json({ notification });
  } catch (error) {
    logger.error('Error resolving notification', { error: error.message });
    res.status(500).json({ error: 'Failed to resolve notification' });
  }
}

async function getJobStats(req, res) {
  try {
    const { range = 'daily' } = req.query; // daily, weekly, monthly, yearly
    
    let groupBy = {};
    const now = new Date();
    let startDate = new Date();
    
    if (range === 'daily') {
       startDate.setDate(now.getDate() - 30); // Last 30 days
       groupBy = {
         year: { $year: "$createdAt" },
         month: { $month: "$createdAt" },
         day: { $dayOfMonth: "$createdAt" }
       };
    } else if (range === 'weekly') {
       startDate.setDate(now.getDate() - 90); // Last 12 weeks
       groupBy = {
         year: { $year: "$createdAt" },
         week: { $week: "$createdAt" }
       };
    } else if (range === 'monthly') {
       startDate.setMonth(now.getMonth() - 12); // Last 12 months
       groupBy = {
         year: { $year: "$createdAt" },
         month: { $month: "$createdAt" }
       };
    } else if (range === 'yearly') {
       startDate.setFullYear(now.getFullYear() - 5); // Last 5 years
       groupBy = {
         year: { $year: "$createdAt" }
       };
    }

    const stats = await Job.aggregate([
      { 
        $match: { 
          createdAt: { $gte: startDate }
        } 
      },
      {
        $group: {
          _id: groupBy,
          count: { $sum: 1 },
          completed: { 
            $sum: { $cond: [{ $eq: ["$status", "completed"] }, 1, 0] } 
          },
          failed: { 
            $sum: { $cond: [{ $eq: ["$status", "failed"] }, 1, 0] } 
          }
        }
      },
      { $sort: { "_id.year": 1, "_id.month": 1, "_id.day": 1, "_id.week": 1 } }
    ]);

    const formattedStats = stats.map(item => {
      let label = '';
      const id = item._id;
      if (range === 'daily') {
        label = `${id.year}-${String(id.month).padStart(2, '0')}-${String(id.day).padStart(2, '0')}`;
      } else if (range === 'weekly') {
        label = `Week ${id.week}, ${id.year}`;
      } else if (range === 'monthly') {
        label = `${id.year}-${String(id.month).padStart(2, '0')}`;
      } else if (range === 'yearly') {
        label = `${id.year}`;
      }
      return {
        name: label,
        total: item.count,
        completed: item.completed,
        failed: item.failed
      };
    });

    res.json({ stats: formattedStats });
  } catch (error) {
    logger.error('Error fetching job stats', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch job stats' });
  }
}

async function getGlobalQueueStats(req, res) {
  try {
    const dbStats = await Job.aggregate([
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const statusCounts = {};
    dbStats.forEach(stat => {
      statusCounts[stat._id] = stat.count;
    });

    const waiting = statusCounts['pending'] || 0;
    const active = (statusCounts['crawling'] || 0) + 
                   (statusCounts['analyzing'] || 0) + 
                   (statusCounts['finding_contact'] || 0) + 
                   (statusCounts['generating_email'] || 0) + 
                   (statusCounts['creating_campaign'] || 0);
    const completed = statusCounts['completed'] || 0;
    const failed = statusCounts['failed'] || 0;
    const total = waiting + active + completed + failed;
    
    res.json({
      success: true,
      queue: {
        waiting,
        active,
        completed,
        failed,
        total
      },
      database: statusCounts
    });
  } catch (error) {
    logger.error('Error fetching global queue stats', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch global queue stats' });
  }
}

async function getAllJobs(req, res) {
  try {
    const page = parseInt(req.query.page || '1', 10);
    const limit = parseInt(req.query.limit || '10', 10);
    const skip = (page - 1) * limit;

    const [jobs, total] = await Promise.all([
      Job.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', 'name email'),
      Job.countDocuments()
    ]);

    res.json({
      jobs,
      pagination: {
        page,
        limit,
        totalItems: total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    logger.error('Error fetching all jobs', { error: error.message });
    res.status(500).json({ error: 'Failed to fetch jobs' });
  }
}

module.exports = { getLogs, getActivity, getUsers, createUser, updateUserStatus, updateUser, getNotifications, resolveNotification, getJobStats, getGlobalQueueStats, getAllJobs };

