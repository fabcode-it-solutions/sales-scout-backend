const OpenAI = require("openai");
const { checkAndNotifyQuotaExceeded } = require("../utils/quota.utils");

// NOTE: This is a public/portfolio build. The proprietary prompt engineering,
// scoring heuristics, and email-generation logic that power this service have
// been withheld to protect client IP. Method signatures are preserved to show
// the service's role in the pipeline.

class OpenAIService {
  constructor() {
    this.client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  // ============================================================
  // Firecrawl Flow: Website Content Analysis
  // ============================================================
  async analyzeWebsite(homepageContent, productPageContent) {
    throw new Error("Not available in public/portfolio build");
  }

  // ============================================================
  // DataForSEO Flow: SEO Data Analysis
  // ============================================================
  async analyzeDataForSeo(seoData) {
    throw new Error("Not available in public/portfolio build");
  }

  // ============================================================
  // SEOReview Flow: SEO Data Analysis (brand + on-page)
  // ============================================================
  async analyzeDataForSeoReview(seoData) {
    throw new Error("Not available in public/portfolio build");
  }

  // ============================================================
  // Retry wrapper with progressive backoff
  // ============================================================
  async _callWithRetry(params, retryCount = 0) {
    try {
      return await this.client.chat.completions.create(params);
    } catch (error) {
      await checkAndNotifyQuotaExceeded("OpenAI", error);
      if (error.status === 429 && retryCount < 3) {
        const waitTime = 20000 * (retryCount + 1);
        console.warn(
          `⚠️ [OpenAI] Rate limit hit. Waiting ${waitTime / 1000}s before retry ${retryCount + 1}...`,
        );
        await new Promise((resolve) => setTimeout(resolve, waitTime));
        return this._callWithRetry(params, retryCount + 1);
      }
      throw error;
    }
  }

  // ============================================================
  // Email generation (shared by both flows)
  // ============================================================
  async generateEmail(analysis, contact, companyName, seoData = null) {
    throw new Error("Not available in public/portfolio build");
  }

  async generateEmailWebsite(analysis, contact, companyName, seoData = null) {
    throw new Error("Not available in public/portfolio build");
  }

  async generateEmailSeo(contact, companyName, seoData = null) {
    throw new Error("Not available in public/portfolio build");
  }

  async generateEmailSeoReview(contact, companyName, seoData = null) {
    throw new Error("Not available in public/portfolio build");
  }
}

module.exports = new OpenAIService();
