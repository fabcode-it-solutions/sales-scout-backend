const axios = require("axios");

class DataForSeoService {
  constructor() {
    this.baseUrl = "https://api.dataforseo.com/v3";
    const login = (process.env.DATAFORSEO_LOGIN || "").trim();
    const password = (process.env.DATAFORSEO_PASSWORD || "").trim();

    if (!login || !password) {
      console.warn(
        "⚠️ [DataForSeo] Missing Login or Password in environment variables.",
      );
    }

    this.auth = Buffer.from(`${login}:${password}`).toString("base64");
    this.headers = {
      Authorization: `Basic ${this.auth}`,
      "Content-Type": "application/json",
    };
  }

  // ============================================================
  // HTTP Helpers
  // ============================================================
  async _post(endpoint, data) {
    try {
      const response = await axios.post(`${this.baseUrl}${endpoint}`, data, {
        headers: this.headers,
      });
      return response.data;
    } catch (error) {
      console.error(
        `DataForSeo POST ${endpoint} error:`,
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  async _get(endpoint) {
    try {
      const response = await axios.get(`${this.baseUrl}${endpoint}`, {
        headers: this.headers,
      });
      return response.data;
    } catch (error) {
      console.error(
        `DataForSeo GET ${endpoint} error:`,
        error.response?.data || error.message,
      );
      throw error;
    }
  }

  // ============================================================
  // 1. On-Page API (Website Health)
  // ============================================================
  async getOnPageOverview(url) {
    try {
      const taskPayload = [
        {
          target: url,
          max_crawl_pages: 10,
          load_resources: false,
          enable_javascript: false,
        },
      ];

      console.log(`[DataForSeo] Starting On-Page crawl for ${url}`);
      const postResult = await this._post("/on_page/task_post", taskPayload);

      if (
        !postResult.tasks ||
        !postResult.tasks[0] ||
        !postResult.tasks[0].id
      ) {
        console.error("[DataForSeo] Failed to start On-Page task.");
        return null;
      }

      const taskId = postResult.tasks[0].id;
      console.log(`[DataForSeo] On-Page Task ID: ${taskId}`);

      // Poll for completion (2s intervals, max 60s)
      let attempts = 0;
      const maxAttempts = 30;

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        const summaryResult = await this._get(`/on_page/summary/${taskId}`);

        if (summaryResult.tasks && summaryResult.tasks[0]) {
          const task = summaryResult.tasks[0];
          if (task.status_code === 20000) {
            let pages = [];
            try {
              const pagesResult = await this._get(`/on_page/pages/${taskId}`);
              pages = pagesResult.tasks?.[0]?.result?.[0]?.items || [];
            } catch (e) {
              console.warn(
                "[DataForSeo] Failed to fetch On-Page pages:",
                e.message,
              );
            }
            const summary = summaryResult.tasks[0]?.result?.[0] || null;
            return { summary, pages };
          } else if (task.status_code === 40600 || task.status_code === 40602) {
            console.warn(
              `[DataForSeo] On-Page task failed: ${task.status_message}`,
            );
            return null;
          }
        }
        attempts++;
      }

      console.warn(`[DataForSeo] On-Page task timed out for ${url}`);
      return null;
    } catch (error) {
      console.error("DataForSeo On-Page Error:", error.message);
      return null;
    }
  }

  // ============================================================
  // 2. Competitor & Keyword Data
  // ============================================================
  async getKeywordSuggestions(keyword, location_code = 2840) {
    try {
      const payload = [
        {
          keyword: keyword,
          location_code: location_code,
          language_code: "en",
          include_seed_keyword: true,
          limit: 20,
        },
      ];
      const result = await this._post(
        "/dataforseo_labs/google/keyword_suggestions/live",
        payload,
      );
      return result.tasks?.[0]?.result?.[0] || null;
    } catch (error) {
      console.error("DataForSeo Keyword Suggestions Error:", error.message);
      return null;
    }
  }

  async getSerpCompetitors(keyword, location_code = 2840) {
    try {
      const payload = [
        {
          keywords: [keyword],
          location_code: location_code,
          language_code: "en",
        },
      ];
      const result = await this._post(
        "/dataforseo_labs/google/serp_competitors/live",
        payload,
      );
      return result.tasks?.[0]?.result?.[0] || null;
    } catch (error) {
      console.error("DataForSeo SERP Competitors Error:", error.message);
      return null;
    }
  }

  // ============================================================
  // 3. Organic Ranked Keywords
  //    What keywords the domain actually ranks for in Google
  //    Endpoint: /dataforseo_labs/google/ranked_keywords/live
  // ============================================================
  async getRankedKeywords(domain, location_code = 2840) {
    try {
      console.log(
        `[DataForSeo] Fetching organic ranked keywords for ${domain}`,
      );
      const payload = [
        {
          target: domain,
          location_code: location_code,
          language_code: "en",
          load_rank_absolute: true,
          item_types: ["organic", "featured_snippet", "local_pack"],
          filters: [["keyword_data.keyword_info.search_volume", ">", 0]],
          order_by: ["ranked_serp_element.serp_item.rank_group,asc"],
          limit: 50,
        },
      ];
      const result = await this._post(
        "/dataforseo_labs/google/ranked_keywords/live",
        payload,
      );
      const data = result.tasks?.[0]?.result?.[0] || null;

      if (data) {
        console.log(
          `[DataForSeo] Found ${data.total_count} total ranked keywords for ${domain} (returned top ${data.items_count})`,
        );
      }
      return data;
    } catch (error) {
      console.error("DataForSeo Ranked Keywords Error:", error.message);
      return null;
    }
  }

  // ============================================================
  // 4. AI Overview Rankings
  //    Keywords where the domain appears inside Google AI Overview
  //    Uses same endpoint with item_types: ["ai_overview_reference"]
  // ============================================================
  async getAiOverviewKeywords(domain, location_code = 2840) {
    try {
      console.log(`[DataForSeo] Fetching AI Overview keywords for ${domain}`);
      const payload = [
        {
          target: domain,
          location_code: location_code,
          language_code: "en",
          item_types: ["ai_overview_reference"],
          limit: 20,
        },
      ];
      const result = await this._post(
        "/dataforseo_labs/google/ranked_keywords/live",
        payload,
      );
      const data = result.tasks?.[0]?.result?.[0] || null;

      if (data) {
        console.log(
          `[DataForSeo] Found ${data.total_count} AI Overview keywords for ${domain} (returned ${data.items_count})`,
        );
      }
      return data;
    } catch (error) {
      console.error("DataForSeo AI Overview Keywords Error:", error.message);
      return null;
    }
  }

  // ============================================================
  // 5. SERP API - Google Organic Live Advanced
  //    Full SERP results including AI Overview, Featured Snippet,
  //    People Also Ask, Knowledge Graph, organic results, etc.
  // ============================================================
  async getSerpOrganic(keyword, location_code = 2840) {
    try {
      console.log(
        `[DataForSeo] Fetching SERP organic for keyword: "${keyword}"`,
      );
      const payload = [
        {
          keyword: keyword,
          location_code: location_code,
          language_code: "en",
          depth: 20,
        },
      ];
      const result = await this._post(
        "/serp/google/organic/live/advanced",
        payload,
      );
      const serpData = result.tasks?.[0]?.result?.[0] || null;

      if (!serpData) return null;

      // Parse and categorize the different SERP features
      const parsed = this._parseSerpItems(serpData);
      return {
        ...serpData,
        parsed,
      };
    } catch (error) {
      console.error("DataForSeo SERP Organic Error:", error.message);
      return null;
    }
  }

  /**
   * Parse SERP items into categorized sections
   */
  _parseSerpItems(serpData) {
    const items = serpData.items || [];

    const parsed = {
      ai_overview: null,
      featured_snippet: null,
      people_also_ask: [],
      knowledge_graph: null,
      organic_results: [],
      paid_results: [],
      local_pack: [],
      video_results: [],
      related_searches: [],
    };

    for (const item of items) {
      switch (item.type) {
        case "ai_overview":
          parsed.ai_overview = {
            text: item.text || item.description || null,
            references: item.references || item.items || [],
            position: item.position || null,
          };
          break;

        case "featured_snippet":
          parsed.featured_snippet = {
            title: item.title,
            url: item.url,
            domain: item.domain,
            description: item.description,
            featured_title: item.featured_title || null,
          };
          break;

        case "people_also_ask":
          const questions = item.items || [];
          parsed.people_also_ask = questions.map((q) => ({
            question: q.title || q.question,
            url: q.url,
            domain: q.domain,
            description: q.description,
          }));
          break;

        case "knowledge_graph":
          parsed.knowledge_graph = {
            title: item.title,
            subtitle: item.sub_title,
            description: item.description,
            url: item.url,
            type: item.card_id || null,
            items: item.items || [],
          };
          break;

        case "organic":
          parsed.organic_results.push({
            position: item.rank_group,
            title: item.title,
            url: item.url,
            domain: item.domain,
            description: item.description,
            is_featured: item.is_featured_snippet || false,
            breadcrumb: item.breadcrumb,
          });
          break;

        case "paid":
          parsed.paid_results.push({
            position: item.rank_group,
            title: item.title,
            url: item.url,
            domain: item.domain,
            description: item.description,
          });
          break;

        case "local_pack":
          const locals = item.items || [];
          parsed.local_pack = locals.map((l) => ({
            title: l.title,
            rating: l.rating?.value,
            reviews: l.rating?.votes_count,
            domain: l.domain,
          }));
          break;

        case "video":
          const videos = item.items || [];
          parsed.video_results = videos.map((v) => ({
            title: v.title,
            url: v.url,
            source: v.source,
          }));
          break;

        case "related_searches":
          const searches = item.items || [];
          parsed.related_searches = searches.map((s) => s.title || s);
          break;

        default:
          break;
      }
    }

    return parsed;
  }

  // ============================================================
  // 6. Domain Overview & Authority
  // ============================================================
  async getDomainRankOverview(domain) {
    try {
      const payload = [
        {
          target: domain,
          location_code: 2840,
          language_code: "en",
        },
      ];
      const result = await this._post(
        "/dataforseo_labs/google/domain_rank_overview/live",
        payload,
      );
      return result.tasks?.[0]?.result?.[0] || null;
    } catch (error) {
      console.error("DataForSeo Domain Rank Overview Error:", error.message);
      return null;
    }
  }

  // ============================================================
  // 7. WHOIS (Domain Age, Registrar, etc.)
  // ============================================================
  async getWhoisData(domain) {
    try {
      console.log(`[DataForSeo] Fetching WHOIS for ${domain}`);
      const payload = [
        {
          target: domain,
        },
      ];
      const result = await this._post(
        "/domain_analytics/whois/overview/live",
        payload,
      );
      const whoisResult = result.tasks?.[0]?.result?.[0]?.items?.[0] || null;

      if (whoisResult) {
        const createdDate = whoisResult.creation_date
          ? new Date(whoisResult.creation_date)
          : null;
        const ageYears = createdDate
          ? (
              (Date.now() - createdDate.getTime()) /
              (365.25 * 24 * 60 * 60 * 1000)
            ).toFixed(1)
          : null;

        return {
          ...whoisResult,
          domain_age_years: ageYears ? parseFloat(ageYears) : null,
        };
      }
      return null;
    } catch (error) {
      console.error("DataForSeo WHOIS Error:", error.message);
      return null;
    }
  }

  // ============================================================
  // 8. Domain Technologies
  // ============================================================
  async getDomainTechnologies(domain) {
    try {
      console.log(`[DataForSeo] Fetching technologies for ${domain}`);
      const payload = [
        {
          target: domain,
          filters: null,
        },
      ];
      const result = await this._post(
        "/domain_analytics/technologies/domain_technologies/live",
        payload,
      );
      return result.tasks?.[0]?.result?.[0] || null;
    } catch (error) {
      console.error("DataForSeo Technologies Error:", error.message);
      return null;
    }
  }

  // ============================================================
  // Helper
  // ============================================================
  getDomain(url) {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch (e) {
      return url;
    }
  }

  // ============================================================
  // Test Connection - Verify credentials work
  // ============================================================
  async testConnection() {
    const login = (process.env.DATAFORSEO_LOGIN || "").trim();
    const password = (process.env.DATAFORSEO_PASSWORD || "").trim();

    console.log(`[DataForSeo] Testing connection...`);
    console.log(`[DataForSeo] Login: "${login}" (length: ${login.length})`);
    console.log(
      `[DataForSeo] Password: "${password ? "***" + password.slice(-3) : "EMPTY"}" (length: ${password.length})`,
    );
    console.log(`[DataForSeo] Base URL: ${this.baseUrl}`);

    try {
      // Simple cheap API call — just fetch SERP locations (no cost)
      const response = await axios.get(
        `${this.baseUrl}/serp/google/locations`,
        {
          headers: this.headers,
        },
      );

      if (response.data?.status_code === 20000) {
        console.log(
          `✅ [DataForSeo] Connection successful! Status: ${response.data.status_code} - ${response.data.status_message}`,
        );
        return { success: true, message: response.data.status_message };
      } else {
        console.error(
          `❌ [DataForSeo] Unexpected status: ${response.data?.status_code} - ${response.data?.status_message}`,
        );
        return {
          success: false,
          status: response.data?.status_code,
          message: response.data?.status_message,
        };
      }
    } catch (error) {
      const status = error.response?.status;
      const data = error.response?.data;
      console.error(`❌ [DataForSeo] Connection FAILED!`);
      console.error(`   HTTP Status: ${status}`);
      console.error(`   Response:`, JSON.stringify(data, null, 2));
      console.error(`   Error: ${error.message}`);
      return {
        success: false,
        httpStatus: status,
        error: error.message,
        response: data,
      };
    }
  }

  // ============================================================
  // MAIN AGGREGATOR
  // ============================================================
  async getAllData(url) {
    const domain = this.getDomain(url);
    const keyword = domain.split(".")[0]; // Naive keyword extraction from domain

    console.log(
      `[DataForSeo] ===== Fetching ALL data for ${domain} (keyword: "${keyword}") =====`,
    );

    // First, verify credentials work
    const connTest = await this.testConnection();
    if (!connTest.success) {
      console.error(
        `❌ [DataForSeo] Cannot proceed — connection test failed:`,
        connTest,
      );
      // Return object with all nulls but include the error info
      return {
        domainOverview: null,
        aiOverviewKeywords: null,
        whois: null,
        summary: {
          domain,
          error: connTest.error || connTest.message || "Auth failed",
        },
        _connectionError: connTest,
      };
    }

    // Run API calls in parallel — only essential ones active
    // To re-enable any API, uncomment the line below and its corresponding destructure
    const apiCalls = [
      // { name: 'onPage',            fn: () => this.getOnPageOverview(url) },           // COMMENTED: On-Page Health (~$0.00125/domain)
      { name: "rankOverview", fn: () => this.getDomainRankOverview(domain) }, // ACTIVE: Organic Traffic + Authority Score (~$0.101)
      // { name: 'rankedKeywords',    fn: () => this.getRankedKeywords(domain) },         // COMMENTED: Ranked Keywords (~$0.015)
      {
        name: "aiOverviewKeywords",
        fn: () => this.getAiOverviewKeywords(domain),
      }, // ACTIVE: AI Overview Data (~$0.012)
      // { name: 'serpOrganic',       fn: () => this.getSerpOrganic(keyword) },           // COMMENTED: SERP Results (~$0.002)
      // { name: 'keywordSuggestions',fn: () => this.getKeywordSuggestions(keyword) },    // COMMENTED: Keyword Suggestions (~$0.015)
      // { name: 'serpCompetitors',   fn: () => this.getSerpCompetitors(keyword) },       // COMMENTED: SERP Competitors (~$0.011)
      { name: "whoisData", fn: () => this.getWhoisData(domain) }, // ACTIVE: Domain Age (~$0.101)
      // { name: 'technologies',     fn: () => this.getDomainTechnologies(domain) },      // COMMENTED: Technologies (~$0.01)
    ];

    const results = await Promise.all(
      apiCalls.map(async ({ name, fn }) => {
        try {
          const data = await fn();
          console.log(
            `[DataForSeo] ✅ ${name}: ${data ? "GOT DATA" : "null (no data)"}`,
          );
          return data;
        } catch (err) {
          console.error(`[DataForSeo] ❌ ${name} FAILED: ${err.message}`);
          return null;
        }
      }),
    );

    // Destructure results — match the order of active apiCalls above
    const [
      /* onPage, */
      rankOverview,
      /* rankedKeywords, */
      aiOverviewKeywords,
      /* serpOrganic, */
      /* keywordSuggestions, */
      /* serpCompetitors, */
      whoisData,
      /* technologies */
    ] = results;

    // Set commented-out results to null
    const onPage = null;
    const rankedKeywords = null;
    const serpOrganic = null;
    const keywordSuggestions = null;
    const serpCompetitors = null;
    const technologies = null;

    // Log summary of what we got
    const gotData = apiCalls.map(
      (c, i) => `${c.name}: ${results[i] ? "✅" : "❌"}`,
    );
    console.log(`[DataForSeo] ===== Results: ${gotData.join(" | ")} =====`);

    // ---- Build normalized summary ----
    const organicMetrics = rankOverview?.items?.[0]?.metrics?.organic || {};
    const paidMetrics = rankOverview?.items?.[0]?.metrics?.paid || {};
    // const onPageSummary = onPage?.summary || {};  // COMMENTED: On-Page disabled

    // Authority score: log-scale from estimated traffic value
    const etv = organicMetrics.etv || 0;
    const authorityScore =
      etv > 0 ? Math.min(100, Math.round(Math.log10(etv + 1) * 20)) : null;

    // On-Page health metrics (COMMENTED — On-Page API disabled)
    // const healthIssues = {
    //   errors: onPageSummary.page_metrics?.checks?.is_4xx || 0,
    //   warnings: onPageSummary.page_metrics?.checks?.is_redirect || 0,
    //   notices: onPageSummary.page_metrics?.checks?.has_meta_title || 0
    // };

    // SERP features detection
    // const serpParsed = serpOrganic?.parsed || {};  // COMMENTED: SERP API disabled
    const hasAiOverview = aiOverviewKeywords?.total_count > 0;
    // const hasFeaturedSnippet = !!serpParsed.featured_snippet;  // COMMENTED: SERP API disabled

    // Ranked keywords breakdown (COMMENTED — Ranked Keywords API disabled)
    // const rankedKwMetrics = rankedKeywords?.metrics?.organic || {};

    const summary = {
      domain,

      // === ACTIVE: From Domain Rank Overview ===
      authority_score: authorityScore,
      organic_traffic: organicMetrics.etv || null,
      keyword_count: organicMetrics.count || null,
      top_positions: organicMetrics.is_up || null,
      paid_traffic: paidMetrics.etv || null,

      // === ACTIVE: From WHOIS ===
      domain_age_years: whoisData?.domain_age_years || null,
      domain_created: whoisData?.creation_date || null,
      domain_expires: whoisData?.expiration_date || null,
      registrar: whoisData?.registrar?.name || whoisData?.registrar || null,

      // === ACTIVE: From AI Overview Keywords ===
      has_ai_overview: hasAiOverview,
      ai_overview_keywords_count: aiOverviewKeywords?.total_count || 0,

      // === COMMENTED: Disabled APIs ===
      // top_3_positions: (rankedKwMetrics.pos_1 || 0) + (rankedKwMetrics.pos_2_3 || 0),  // Ranked Keywords
      // backlinks_count: organicMetrics.count || null,
      // referring_domains: null,
      // pages_crawled: onPageSummary.crawl_progress === 'finished' ? onPageSummary.pages_crawled : null,  // On-Page
      // health_issues: healthIssues,  // On-Page
      // onpage_score: onPageSummary.onpage_score || null,  // On-Page
      // has_featured_snippet: hasFeaturedSnippet,  // SERP
      // technologies_count: technologies?.technologies?.length || 0,  // Technologies
      // total_ranked_keywords: rankedKeywords?.total_count || 0,  // Ranked Keywords
    };

    console.log(`[DataForSeo] ===== Summary for ${domain} =====`);
    console.log(JSON.stringify(summary, null, 2));

    return {
      // onPage,                          // COMMENTED: On-Page API disabled
      domainOverview: rankOverview, // ACTIVE: Organic Traffic + Authority Score
      // rankedKeywords,                  // COMMENTED: Ranked Keywords disabled
      aiOverviewKeywords, // ACTIVE: AI Overview appearances
      // rankings: serpOrganic,           // COMMENTED: SERP Results disabled
      // keywords: keywordSuggestions,    // COMMENTED: Keyword Suggestions disabled
      // competitors: serpCompetitors,    // COMMENTED: SERP Competitors disabled
      whois: whoisData, // ACTIVE: Domain Age
      // technologies,                    // COMMENTED: Technologies disabled
      summary,
    };
  }
}

module.exports = new DataForSeoService();
