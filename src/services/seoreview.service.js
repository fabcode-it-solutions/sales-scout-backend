const axios = require("axios");

class SeoReviewService {
  constructor() {
    this.baseUrl = "https://api.seoreviewtools.com";
    this.apiKey = (process.env.SEOREVIEWTOOLS_API_KEY || "").trim();

    if (!this.apiKey) {
      console.warn(
        "⚠️ [SeoReview] Missing SEOREVIEWTOOLS_API_KEY in environment variables.",
      );
    }
  }

  // ============================================================
  // Credits
  // https://api.seoreviewtools.com/credits/
  // ============================================================
  // async getCredits(params = {}) {
  //   return this._get("/credits/", params);
  // }

  async _get(path, params = {}) {
    if (!this.apiKey) {
      throw new Error(
        "SEOREVIEWTOOLS_API_KEY is not configured in environment variables",
      );
    }

    try {
      const response = await axios.get(`${this.baseUrl}${path}`, {
        params: {
          ...params,
          key: this.apiKey,
        },
      });

      const data = response.data;

      if (data && data.status && data.status !== "ok") {
        const errorMessage =
          data["error message"] || data.error || data.message || "Unknown error";
        console.error(`[SeoReview] API error on ${path}:`, errorMessage);
        throw new Error(errorMessage);
      }

      console.log(
        "[SeoReview] API response",
        JSON.stringify({ path, params, data }, null, 2),
      );

      return data;
    } catch (error) {
      console.error(
        `[SeoReview] HTTP error on ${path}:`,
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  // ============================================================
  // 1. Website Traffic (replaces Authority Score usage here)
  // https://api.seoreviewtools.com/documentation/website-traffic/website-traffic-api/
  // ============================================================
  async getWebsiteTraffic(domain) {
    if (!domain) throw new Error("[SeoReview] getWebsiteTraffic requires a domain");

    const data = await this._get("/website-traffic/", {
      url: domain,
    });

    const inner = data?.data?.data;
    const payload = Array.isArray(inner) ? inner[0] || {} : inner || data?.data || data || {};

    const organicRaw =
      payload["organic traffic"] ??
      payload.organic ??
      null;

    const paidRaw =
      payload["paid traffic"] ??
      payload.paid ??
      null;

    const paidCostRaw =
      payload["paid traffic cost"] ??
      payload.paid_traffic_cost ??
      null;

    const result = {
      raw: data,
      domain,
      organicTraffic: organicRaw !== null ? Number(organicRaw) : null,
      paidTraffic: paidRaw !== null ? Number(paidRaw) : null,
      paidTrafficCost: paidCostRaw !== null ? Number(paidCostRaw) : null,
    };

    console.log(
      "[SeoReview] Parsed website traffic",
      JSON.stringify(
        {
          domain: result.domain,
          organicTraffic: result.organicTraffic,
          paidTraffic: result.paidTraffic,
          paidTrafficCost: result.paidTrafficCost,
        },
        null,
        2,
      ),
    );

    return result;
  }

  // ============================================================
  // 2. Gemini Brand Visibility Report
  // https://api.seoreviewtools.com/documentation/brand-monitor-apis/gemini-brand-visibility-report-api/
  // ============================================================
  /**
   * brandInput: brand name or brand URL (as per API docs)
   * options: { location, competitors, productsOrServices }
   */
  async getBrandVisibility(brandInput, options = {}) {
    if (!brandInput) {
      throw new Error("[SeoReview] getBrandVisibility requires brandInput");
    }

    const params = { brandinput: brandInput };

    if (options.location) params.location = options.location;
    if (options.competitors) params.competitors = options.competitors;
    if (options.productsOrServices)
      params.products_or_services = options.productsOrServices;

    const data = await this._get("/v3/gemini-brand-research/", params);

    const inner = data?.data?.data;
    const record = Array.isArray(inner) ? inner[0] || {} : inner || {};

    const awarenessSources =
      record?.brand_awareness_analysis?.brand_awareness_sources ||
      record?.brand_awareness_analysis?.brand_awarness_sources ||
      [];

    console.log(
      "[SeoReview] Brand visibility response",
      JSON.stringify(
        {
          brandInput,
          options,
          brand_name: record?.brand_name,
          brand_awareness_sources_count: Array.isArray(awarenessSources)
            ? awarenessSources.length
            : 0,
        },
        null,
        2,
      ),
    );

    return record;
  }

  // ============================================================
  // 3. SEO Content Analysis (URL)
  // https://api.seoreviewtools.com/documentation/seo-content-analysis-api/url/
  // ============================================================
  async analyzeContent(url, keyword, relatedKeywords = null) {
    if (!url || !keyword) {
      throw new Error(
        "[SeoReview] analyzeContent requires both url and keyword",
      );
    }

    const params = { url, keyword };

    if (relatedKeywords && relatedKeywords.trim().length > 0) {
      params.relatedkeywords = relatedKeywords;
    }

    const data = await this._get("/seo-content-analysis-4-1/", params);

    const record = Array.isArray(data?.data) ? data.data[0] : data?.data || data;

    let scoreRaw =
      data?.data?.Overview?.["Overall SEO score"] ??
      record?.score ??
      record?.["Overall SEO score"] ??
      record?.overall_seo_score ??
      record?.overall_score ??
      null;

    if (scoreRaw != null && typeof record === "object") {
      record.score = Number(scoreRaw);
    }

    console.log(
      "[SeoReview] Content analysis response",
      JSON.stringify(
        {
          url,
          keyword,
          relatedKeywords,
          status: record?.status || data?.status,
          score: record?.score ?? null,
          warningsCount: Array.isArray(record?.warnings)
            ? record.warnings.length
            : 0,
          issuesCount: Array.isArray(record?.issues) ? record.issues.length : 0,
        },
        null,
        2,
      ),
    );

    return record;
  }

  // ============================================================
  // 4. Combined flow:
  //    Use Gemini brand visibility -> brand_awareness_sources
  //    as related keywords for SEO content analysis
  // ============================================================
  /**
   * High-level helper:
   *  - Calls Gemini Brand Visibility with brandInput (brand name or URL)
   *  - Extracts brand_awareness_sources as related keywords
   *  - Calls SEO Content Analysis for the given page URL
   *
   * @param {string} url - The page URL to analyze for SEO content
   * @param {string} [brandInput] - Brand name or URL for Gemini (defaults to url)
   * @param {object} [options] - Optional Gemini parameters (location, competitors, productsOrServices)
   * @returns {Promise<{ brandVisibility: any, contentAnalysis: any, usedKeyword: string, usedRelatedKeywords: string[] }>}
   */
  async analyzeContentUsingBrandVisibility(url, brandInput = null, options = {}) {
    const effectiveBrandInput = brandInput || url;

    // 1) Fetch brand visibility (Gemini)
    const brandVisibility = await this.getBrandVisibility(
      effectiveBrandInput,
      options,
    );

    const brandName =
      brandVisibility?.brand_name || effectiveBrandInput || "Unknown";

    const sourcesRaw = brandVisibility?.top_5_topics || [];

    let sourceKeywords = [];

    if (Array.isArray(sourcesRaw)) {
      sourceKeywords = sourcesRaw
        .map((item) => {
          if (!item) return null;
          if (typeof item === "string") return item;
          return (
            item.keyword ||
            item.name ||
            item.topic ||
            item.source ||
            item.title ||
            null
          );
        })
        .filter(Boolean);
    }

    let relatedKeywordsParam = null;
    let usedRelatedKeywords = [];

    if (sourceKeywords.length >= 3) {
      usedRelatedKeywords = sourceKeywords.slice(0, 10);
      relatedKeywordsParam = usedRelatedKeywords.join("|");
    } else if (sourceKeywords.length > 0) {
      usedRelatedKeywords = sourceKeywords;
      relatedKeywordsParam = usedRelatedKeywords.join("|");
      console.warn(
        `[SeoReview] Only ${sourceKeywords.length} top_5_topics found; SEO content API recommends at least 3 related keywords.`,
      );
    } else {
      console.warn(
        "[SeoReview] No top_5_topics found; running SEO content analysis without relatedkeywords.",
      );
    }

    const mainKeyword =
      usedRelatedKeywords.length > 0 ? usedRelatedKeywords[0] : brandName;

    console.log(
      "[SeoReview] Content analysis keywords",
      JSON.stringify(
        {
          url,
          mainKeyword,
          relatedKeywords: usedRelatedKeywords,
        },
        null,
        2,
      ),
    );

    const contentAnalysis = await this.analyzeContent(
      url,
      mainKeyword,
      relatedKeywordsParam,
    );

    const combined = {
      brandVisibility,
      contentAnalysis,
      usedKeyword: mainKeyword,
      usedRelatedKeywords,
    };

    // score is nested inside brand_awareness_analysis
    const brandAwarenessScore =
      brandVisibility?.brand_awareness_analysis?.brand_awareness_score ||
      brandVisibility?.brand_awareness_index ||
      brandVisibility?.brand_visibility_score ||
      null;

    const extractedBrandData = {
      brand_name: brandName,
      brand_awareness_keywords: usedRelatedKeywords,
      brand_awareness_score: brandAwarenessScore,
    };

    console.log(
      "[SeoReview] Extracted core brand visibility data",
      JSON.stringify(extractedBrandData, null, 2),
    );

    console.log(
      "[SeoReview] Combined Gemini + content analysis",
      JSON.stringify(
        {
          url,
          brandInput: effectiveBrandInput,
          usedKeyword: combined.usedKeyword,
          usedRelatedKeywords: combined.usedRelatedKeywords,
        },
        null,
        2,
      ),
    );

    return combined;
  }
}

module.exports = new SeoReviewService();
