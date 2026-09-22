const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { body } = require('express-validator');
const rateLimit = require('express-rate-limit');
const User = require('../models/User');
const Notification = require('../models/Notification');
const redis = require('../config/redis');
const logger = require('../utils/logger');

function signAccessToken(user) {
  return jwt.sign(
    { sub: user._id.toString(), role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
}

function signRefreshToken(user, jti) {
  return jwt.sign(
    { sub: user._id.toString(), jti },
    process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET,
    { expiresIn: process.env.REFRESH_TOKEN_EXPIRES_IN || '7d' }
  );
}

async function storeRefresh(jti) {
  const ttlSec = parseTtl(process.env.REFRESH_TOKEN_EXPIRES_IN || '7d');
  await redis.set(`refresh:${jti}`, '1', 'EX', ttlSec);
}

async function invalidateRefresh(jti) {
  await redis.del(`refresh:${jti}`);
}

async function isRefreshValid(jti) {
  const v = await redis.get(`refresh:${jti}`);
  return !!v;
}

function parseTtl(ttl) {
  const m = ttl.match(/^([0-9]+)([smhd])$/);
  if (!m) return 7 * 24 * 60 * 60;
  const num = parseInt(m[1], 10);
  const unit = m[2];
  if (unit === 's') return num;
  if (unit === 'm') return num * 60;
  if (unit === 'h') return num * 3600;
  if (unit === 'd') return num * 86400;
  return 7 * 24 * 60 * 60;
}

const validators = {
  signup: [
    body('name').isString().isLength({ min: 2, max: 50 }).withMessage('Name must be between 2 and 50 characters'),
    body('email').isEmail().normalizeEmail().withMessage('Invalid email address'),
    body('password').isString().isLength({ min: 3 }).withMessage('Password must be at least 3 characters long')
  ],
  login: [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email address'),
    body('password').isString().isLength({ min: 3 }).withMessage('Password must be at least 3 characters long')
  ],
  forgotPassword: [
    body('email').isEmail().normalizeEmail().withMessage('Invalid email address')
  ],
  refresh: [body('refreshToken').optional().isString()]
};

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10
});

async function signup(req, res, next) {
  try {
    logger.info('Signup request received', { email: req.body.email });
    const { name, email, password } = req.body;
    
    const exists = await User.findOne({ email });
    if (exists) {
      logger.warning('Signup failed: User already exists', { email });
      return res.status(409).json({ error: 'Email already in use' });
    }
    
    const user = await User.create({
      name,
      email,
      passwordHash: password
    });
    
    logger.success('User created successfully', { userId: user._id, email });
    
    const jti = uuidv4();
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user, jti);
    
    await storeRefresh(jti);
    
    setAuthCookies(res, accessToken, refreshToken);
    
    res.status(201).json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    logger.error('Signup error', { error: error.message, stack: error.stack });
    next(error);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    
    const user = await User.findOne({ email });
    if (!user) {
      logger.warning('Login failed: User not found', { email });
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    if (user.isActive === false) {
      logger.warning('Login failed: User account deactivated', { email });
      return res.status(403).json({ error: 'Account is deactivated. Please contact administrator.' });
    }
    
    const ok = await user.comparePassword(password);
    if (!ok) {
      logger.warning('Login failed: Password mismatch', { email });
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    
    const jti = uuidv4();
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user, jti);
    
    await storeRefresh(jti);
    setAuthCookies(res, accessToken, refreshToken);
    
    logger.success('User logged in successfully', { userId: user._id, email });
    
    res.json({ user: { id: user._id, name: user.name, email: user.email, role: user.role } });
  } catch (error) {
    logger.error('Login error', { error: error.message, email: req.body.email });
    next(error);
  }
}

async function refresh(req, res, next) {
  try {
    const token = req.body.refreshToken || req.cookies.refresh_token;
    if (!token) return res.status(400).json({ error: 'Invalid username or password' });
    
    const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET);
    const valid = await isRefreshValid(payload.jti);
    if (!valid) return res.status(401).json({ error: 'Invalid refresh token' });
    
    await invalidateRefresh(payload.jti);
    const user = await User.findById(payload.sub);
    
    const jti = uuidv4();
    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user, jti);
    
    await storeRefresh(jti);
    setAuthCookies(res, accessToken, refreshToken);
    res.json({ ok: true });
  } catch (error) {
    console.error('[DEBUG] Refresh error:', error);
    // JWT verify throws, or Redis error
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
       return res.status(401).json({ error: 'Invalid refresh token' });
    }
    next(error);
  }
}

async function logout(req, res) {
  const token = req.body.refreshToken || req.cookies.refresh_token;
  if (token) {
    try {
      const payload = jwt.verify(token, process.env.REFRESH_TOKEN_SECRET || process.env.JWT_SECRET);
      await invalidateRefresh(payload.jti);
    } catch {}
  }
  clearAuthCookies(res);
  res.json({ ok: true });
}

async function me(req, res) {
  res.json({ user: { id: req.user._id, name: req.user.name, email: req.user.email, role: req.user.role } });
}

function csrf(req, res) {
  res.json({ csrfToken: req.csrfToken() });
}

function setAuthCookies(res, accessToken, refreshToken) {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('access_token', accessToken, {
    httpOnly: true,
    // sameSite: 'lax',
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 15 * 60 * 1000
  });
  res.cookie('refresh_token', refreshToken, {
    httpOnly: true,
    // sameSite: 'lax',
    sameSite: 'Strict',
    secure: isProd,
    maxAge: 7 * 24 * 60 * 60 * 1000
  });
}

function clearAuthCookies(res) {
  res.clearCookie('access_token');
  res.clearCookie('refresh_token');
}

const { sendEmail } = require('../utils/smtp.util');

async function forgotPassword(req, res) {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    
    if (!user) {
      return res.status(404).json({ error: 'User not found, please enter a correct email.' });
    }

    // Generate 4-digit OTP
    const otp = Math.floor(1000 + Math.random() * 9000).toString();
    const expires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    user.resetPasswordOtp = otp;
    user.resetPasswordExpires = expires;
    await user.save();

    // Send email
    try {
      await sendEmail(
        email,
        'SalesScout - Password Reset OTP',
        `
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 6px rgba(0,0,0,0.1); border: 1px solid #e2e8f0;">
          <div style="background-color: #2563eb; padding: 24px; text-align: center;">
            <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">SalesScout</h1>
          </div>
          <div style="padding: 32px 24px; text-align: center;">
            <h2 style="color: #1e293b; margin-top: 0; font-size: 20px;">Password Reset Request</h2>
            <p style="color: #475569; line-height: 1.6; margin-bottom: 24px;">We received a request to reset your password. Use the OTP below to proceed.</p>
            
            <div style="background-color: #f1f5f9; padding: 16px; margin-bottom: 24px; border-radius: 4px; display: inline-block;">
              <span style="color: #1e293b; font-weight: 700; font-size: 32px; letter-spacing: 4px; font-family: monospace;">${otp}</span>
            </div>

            <p style="color: #475569; font-size: 14px; margin-bottom: 0;">This OTP is valid for 10 minutes.</p>
            <p style="color: #475569; font-size: 14px;">If you didn't request this, you can safely ignore this email.</p>
          </div>
          <div style="background-color: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
            <p style="color: #94a3b8; font-size: 12px; margin: 0;">&copy; ${new Date().getFullYear()} SalesScout. All rights reserved.</p>
          </div>
        </div>
        `
      );
    } catch (emailError) {
      logger.error('Failed to send OTP email', { error: emailError.message });
      return res.status(500).json({ error: 'Failed to send OTP email' });
    }

    res.json({ message: 'OTP sent successfully' });
  } catch (error) {
    logger.error('Forgot password error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function verifyOtp(req, res) {
  try {
    const { email, otp } = req.body;
    console.log(`[DEBUG] verifyOtp called for email: ${email}, otp: ${otp}`);
    
    const user = await User.findOne({ 
      email, 
      resetPasswordOtp: otp,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      console.log(`[DEBUG] verifyOtp failed: User not found or OTP expired/invalid for email: ${email}`);
      // Check if user exists but OTP is wrong/expired
      const debugUser = await User.findOne({ email });
      if (debugUser) {
        console.log(`[DEBUG] User found. Stored OTP: ${debugUser.resetPasswordOtp}, Expires: ${debugUser.resetPasswordExpires}, Now: ${new Date()}`);
      } else {
        console.log(`[DEBUG] User not found with email: ${email}`);
      }
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    console.log(`[DEBUG] verifyOtp success for email: ${email}`);
    res.json({ message: 'OTP verified successfully' });
  } catch (error) {
    console.error('[DEBUG] verifyOtp error:', error);
    logger.error('Verify OTP error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function resetPassword(req, res) {
  try {
    const { email, otp, newPassword } = req.body;
    console.log(`[DEBUG] resetPassword called for email: ${email}, otp: ${otp}, newPassword length: ${newPassword ? newPassword.length : 0}`);

    if (!newPassword || newPassword.length < 3) {
      return res.status(400).json({ error: 'Password must be at least 3 characters long' });
    }

    const user = await User.findOne({ 
      email, 
      resetPasswordOtp: otp,
      resetPasswordExpires: { $gt: Date.now() }
    });

    if (!user) {
      console.log(`[DEBUG] resetPassword failed: User not found or OTP session invalid for email: ${email}`);
       // Check if user exists but OTP is wrong/expired
      const debugUser = await User.findOne({ email });
      if (debugUser) {
        console.log(`[DEBUG] User found. Stored OTP: ${debugUser.resetPasswordOtp}, Expires: ${debugUser.resetPasswordExpires}, Now: ${new Date()}`);
      } else {
        console.log(`[DEBUG] User not found with email: ${email}`);
      }
      return res.status(400).json({ error: 'Invalid or expired OTP session' });
    }

    console.log(`[DEBUG] resetPassword: User found, updating password.`);
    user.passwordHash = newPassword;
    user.resetPasswordOtp = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    console.log(`[DEBUG] resetPassword: Password updated successfully.`);

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('[DEBUG] resetPassword error:', error);
    logger.error('Reset password error', { error: error.message });
    res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  validators,
  limiter,
  signup,
  login,
  refresh,
  logout,
  me,
  csrf,
  forgotPassword,
  verifyOtp,
  resetPassword,
  changePassword
};

async function changePassword(req, res) {
  try {
    const { oldPassword, newPassword } = req.body;
    console.log(`[DEBUG] changePassword called for user: ${req.user?._id}, newPassword length: ${newPassword ? newPassword.length : 0}`);

    if (!oldPassword || !newPassword) {
      console.log(`[DEBUG] changePassword failed: Missing old or new password`);
      return res.status(400).json({ error: 'Old and new passwords are required' });
    }
    
    if (newPassword.length < 3) {
      console.log(`[DEBUG] changePassword failed: New password too short`);
      return res.status(400).json({ error: 'New password must be at least 3 characters long' });
    }

    const user = await User.findById(req.user._id);
    if (!user) {
      console.log(`[DEBUG] changePassword failed: User not found in DB`);
      return res.status(404).json({ error: 'User not found' });
    }

    const isMatch = await user.comparePassword(oldPassword);
    if (!isMatch) {
      console.log(`[DEBUG] changePassword failed: Old password incorrect`);
      return res.status(401).json({ error: 'Incorrect old password' });
    }

    user.passwordHash = newPassword;
    await user.save();

    console.log(`[DEBUG] changePassword success: Password updated`);
    logger.info('User changed password', { userId: user._id });
    res.json({ message: 'Password updated successfully' });
  } catch (error) {
    console.error('[DEBUG] changePassword error:', error);
    logger.error('Error changing password', { error: error.message });
    res.status(500).json({ error: 'Failed to update password' });
  }
}

