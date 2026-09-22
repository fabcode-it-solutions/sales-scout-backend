require('dotenv').config();
const mongoose = require('mongoose');
const User = require('../models/User');

const createAdmin = async () => {
  try {
    console.log('🔄 Connecting to MongoDB...',process.env.MONGODB_URI);
    // Connect to MongoDB
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is not defined in environment variables');
    }
    
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Admin details
    const adminEmail = 'admin@salesscout.com';
    const adminPassword = 'adminPassword123!';
    const adminName = 'Admin User';

    // Check if admin exists
    const existingAdmin = await User.findOne({ email: adminEmail });
    if (existingAdmin) {
      console.log('⚠️ Admin user already exists with email:', adminEmail);
      process.exit(0);
    }

    // Create admin user
    // Note: The User model has a pre-save hook that hashes the passwordHash field
    const admin = await User.create({
      name: adminName,
      email: adminEmail,
      passwordHash: adminPassword, // Will be hashed by pre-save hook
      role: 'admin',
      isActive: true
    });

    console.log('🎉 Admin user created successfully!');
    console.log('-----------------------------------');
    console.log('Email:', admin.email);
    console.log('Password:', adminPassword);
    console.log('Role:', admin.role);
    console.log('-----------------------------------');

  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
};

createAdmin();
