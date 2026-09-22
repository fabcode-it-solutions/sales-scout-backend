const { sendEmail } = require('./smtp.util');

// Get pending email from env vars or fallback to admin email
const PENDING_EMAIL = process.env.PENDING_EMAIL || process.env.ADMIN_EMAIL;

/**
 * Checks if an error is due to quota/rate limits and sends a notification email
 * @param {string} serviceName - Name of the service (e.g., 'OpenAI', 'Firecrawl')
 * @param {Error} error - The error object caught from the service
 */
const checkAndNotifyQuotaExceeded = async (serviceName, error) => {
  if (!PENDING_EMAIL) {
    console.warn('⚠️ [Quota] PENDING_EMAIL or ADMIN_EMAIL not set. Cannot send quota notifications.');
    return;
  }

  let isQuotaError = false;
  const errorMessage = (error.message || '').toLowerCase();
  const responseData = error.response?.data ? JSON.stringify(error.response.data).toLowerCase() : '';
  const status = error.response?.status || error.status;
  const code = error.code || error.error?.code;

  // Check for common quota/rate limit indicators
  // 429: Too Many Requests (Rate limit or Quota)
  // 402: Payment Required (sometimes used for quota)
  if (status === 429 || status === 402) {
    isQuotaError = true;
  } 
  // Explicit error messages
  else if (
    errorMessage.includes('quota') || 
    errorMessage.includes('rate limit') || 
    errorMessage.includes('insufficient funds') ||
    errorMessage.includes('billing') ||
    errorMessage.includes('credit')
  ) {
    isQuotaError = true;
  } 
  // Response data checks
  else if (
    responseData.includes('quota') || 
    responseData.includes('rate_limit') || 
    responseData.includes('insufficient_quota') ||
    responseData.includes('insufficient_credit')
  ) {
    isQuotaError = true;
  }
  // Specific Error Codes
  else if (code === 'insufficient_quota' || code === 'rate_limit_exceeded') {
    isQuotaError = true;
  }

  if (isQuotaError) {
    console.log(`🚨 [Quota] Detected quota/limit exceeded for ${serviceName}. Sending notification to ${PENDING_EMAIL}...`);
    
    try {
      const subject = `🚨 Quota Exceeded Alert: ${serviceName}`;
      const html = `
        <div style="font-family: Arial, sans-serif; padding: 20px; border: 1px solid #e0e0e0; border-radius: 5px;">
          <h2 style="color: #d32f2f;">Quota Exceeded Alert</h2>
          <p>The <strong>${serviceName}</strong> service has exceeded its quota or rate limit.</p>
          
          <div style="background-color: #f5f5f5; padding: 15px; border-radius: 4px; margin: 15px 0;">
            <p><strong>Error Message:</strong> ${error.message}</p>
            <p><strong>Status Code:</strong> ${status || 'N/A'}</p>
            ${code ? `<p><strong>Error Code:</strong> ${code}</p>` : ''}
          </div>

          <p><strong>Action Required:</strong> Please check the billing/usage dashboard for ${serviceName} immediately to prevent service interruption.</p>
          
          <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="font-size: 12px; color: #666;">SalesScout System Alert • ${new Date().toLocaleString()}</p>
        </div>
      `;

      await sendEmail(PENDING_EMAIL, subject, html);
      console.log(`✅ [Quota] Notification sent to ${PENDING_EMAIL}`);
    } catch (emailError) {
      console.error(`❌ [Quota] Failed to send notification email:`, emailError.message);
    }
  }
};

module.exports = { checkAndNotifyQuotaExceeded };
