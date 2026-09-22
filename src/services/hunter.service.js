const axios = require('axios');

class HunterService {
  constructor() {
    this.apiKey = process.env.HUNTER_API_KEY;
    this.baseURL = 'https://api.hunter.io/v2';
  }
  
  async findEmail(domain) {
    try {
      console.log(`🔍 [Hunter] Finding email for domain via Hunter: ${domain}`);
      
      const response = await axios.get(`${this.baseURL}/domain-search`, {
        params: {
          domain,
          api_key: this.apiKey,
          limit: 1
        }
      });
      
      console.log('📦 [Hunter] API Response Status:', response.status);
      const emails = response.data.data.emails;
      console.log(`📦 [Hunter] Found ${emails?.length || 0} emails`);
      
      if (emails && emails.length > 0) {
        const email = emails[0];
        console.log('👤 [Hunter] Selected Email:', {
          email: email.value,
          name: `${email.first_name || ''} ${email.last_name || ''}`,
          position: email.position,
          confidence: email.confidence
        });

        return {
          email: email.value,
          name: `${email.first_name || ''} ${email.last_name || ''}`.trim(),
          title: email.position,
          confidence: email.confidence,
          source: 'hunter.io'
        };
      }
      
      return null;
    } catch (error) {
      console.error('Hunter.io Error:', error.response?.data || error.message);
      return null;
    }
  }
  
  extractDomain(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.replace('www.', '');
    } catch (error) {
      return null;
    }
  }
  
  extractEmailFromContent(content) {
    if (!content) return null;
    
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = content.match(emailRegex);
    
    if (emails && emails.length > 0) {
      // Filter out common non-contact emails
      const filtered = emails.filter(email => 
        !email.includes('example.com') &&
        !email.includes('wix.com') &&
        !email.includes('sentry.io') &&
        !email.includes('domain.com') &&
        !email.endsWith('.png') &&
        !email.endsWith('.jpg') &&
        !email.endsWith('.svg')
      );
      
      return filtered.length > 0 ? filtered[0] : null;
    }
    
    return null;
  }
  
  async findContactInfo(url, pageContent) {
    // Try to extract email from page content first
    console.log(`🕵️ [Hunter] Attempting to extract email from page content for ${url}`);
    const emailFromPage = this.extractEmailFromContent(pageContent);
    
    if (emailFromPage) {
      console.log(`✅ [Hunter] Found email on webpage: ${emailFromPage}`);
      return {
        email: emailFromPage,
        source: 'webpage',
        confidence: 'high'
      };
    }
    
    console.log('⚠️ [Hunter] No email found on webpage, falling back to Hunter API');
    
    // Fallback to Hunter.io
    const domain = this.extractDomain(url);
    if (!domain) {
      console.log('❌ [Hunter] Could not extract domain from URL');
      return null;
    }
    
    return await this.findEmail(domain);
  }
}

module.exports = new HunterService();
