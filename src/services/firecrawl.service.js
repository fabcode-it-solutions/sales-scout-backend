const axios = require('axios');
const { checkAndNotifyQuotaExceeded } = require('../utils/quota.utils');

class FirecrawlService {
  constructor() {
    this.apiKey = process.env.FIRECRAWL_API_KEY;
    this.baseURL = 'https://api.firecrawl.dev/v1';
  }
  
  async scrapeURL(url, retryCount = 0) {
    try {
      console.log(`🔍 [Firecrawl] Requesting scrape for: ${url} (Attempt ${retryCount + 1})`);
      const response = await axios.post(
        `${this.baseURL}/scrape`,
        {
          url,
          formats: ['markdown'],
          onlyMainContent: true
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`✅ [Firecrawl] Success for ${url}`);
      // console.log('📦 [Firecrawl] Response Data:', JSON.stringify(response.data, null, 2));
      
      return response.data;
    } catch (error) {
      // Check for Insufficient Quota (Credits Expired)
      await checkAndNotifyQuotaExceeded('Firecrawl', error);
      // Handle Rate Limiting (429)
      if (error.response?.status === 429 && retryCount < 3) {
        const waitTime = 10000; // Wait 10 seconds
        console.warn(`⚠️ [Firecrawl] Rate limit hit. Waiting ${waitTime/1000}s before retry ${retryCount + 1}...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.scrapeURL(url, retryCount + 1);
      }

      console.error('Firecrawl Error:', error.response?.data || error.message);
      throw new Error(`Failed to scrape ${url}: ${error.message}`);
    }
  }
  
  async scrapeHomepageAndProduct(url) {
    try {
      // Scrape homepage
      console.log(`🕷️  Crawling homepage: ${url}`);
      const homepage = await this.scrapeURL(url);
      
      // Find product page link
      const productPageURL = this.findProductPageLink(homepage.data.links, url);
      
      let productPage = null;
      if (productPageURL) {
        console.log(`🕷️  Crawling product page: ${productPageURL}`);
        productPage = await this.scrapeURL(productPageURL);
      }
      
      return {
        homepage: {
          markdown: homepage.data.markdown,
          metadata: homepage.data.metadata,
          links: homepage.data.links || []
        },
        productPage: productPage ? {
          url: productPageURL,
          markdown: productPage.data.markdown,
          metadata: productPage.data.metadata
        } : null
      };
    } catch (error) {
      throw error;
    }
  }
  
  findProductPageLink(links, baseURL) {
    if (!links || links.length === 0) return null;
    
    // Heuristics to find product page
    const productPatterns = [
      /\/products?\//i,
      /\/shop\//i,
      /\/collections?\//i,
      /\/store\//i
    ];
    
    for (const link of links) {
      for (const pattern of productPatterns) {
        if (pattern.test(link)) {
          // Make sure it's a full URL
          if (link.startsWith('http')) {
            return link;
          } else {
            return new URL(link, baseURL).href;
          }
        }
      }
    }
    
    return null;
  }
}

module.exports = new FirecrawlService();
