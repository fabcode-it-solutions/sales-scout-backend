const mongoose = require("mongoose");

const jobSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      required: true,
      trim: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    type: {
      type: String,
      enum: ["normal", "data_for_seo"],
      default: "normal",
    },
    status: {
      type: String,
      enum: [
        "pending",
        "queued",
        "crawling",
        "analyzing",
        "finding_contact",
        "generating_email",
        "creating_campaign",
        "completed",
        "failed",
      ],
      default: "pending",
    },

    // Crawled Data (Firecrawl flow)
    homepageContent: {
      markdown: String,
      metadata: Object,
      links: [String],
    },

    // DataForSeo Results (DataForSEO flow)
    dataForSeo: {
      onPage: Object, // On-Page crawl summary + pages data
      keywords: Object, // Keyword suggestions
      competitors: Object, // SERP competitors
      rankedKeywords: Object, // Organic keywords the domain ranks for (positions, volumes, traffic)
      aiOverviewKeywords: Object, // Keywords where domain appears in Google AI Overview
      rankings: Object, // SERP results with parsed AI Overview, Featured Snippet, PAA, etc.
      domainOverview: Object, // Domain rank overview (organic/paid metrics)
      whois: Object, // WHOIS data (domain age, registrar)
      technologies: Object, // Domain technologies/tech stack
      // Normalized summary for quick access
      summary: {
        domain: String,
        authority_score: Number,
        organic_traffic: Number,
        keyword_count: Number,
        top_positions: Number,
        top_3_positions: Number,
        paid_traffic: Number,
        domain_age_years: Number,
        domain_created: String,
        domain_expires: String,
        registrar: String,
        backlinks_count: Number,
        referring_domains: Number,
        pages_crawled: Number,
        health_issues: Object,
        onpage_score: Number,
        onpage_warnings_count: Number,
        onpage_issues_count: Number,
        has_ai_overview: Boolean,
        has_featured_snippet: Boolean,
        ai_overview_keywords_count: Number,
        technologies_count: Number,
        total_ranked_keywords: Number,
      },
    },

    productPageContent: {
      url: String,
      markdown: String,
      metadata: Object,
    },

    // Analysis Results
    analysis: {
      critical_issues: [
        {
          issue: String,
          impact: String,
          fix: String,
          estimated_impact: String,
        },
      ],
      opportunities: [
        {
          opportunity: String,
          current_state: String,
          suggested_change: String,
          impact: String,
        },
      ],
      strengths: [String],
      estimated_lift: String,
    },

    // Contact Information
    contact: {
      email: String,
      phone: String,
      name: String,
      title: String,
      source: String,
      confidence: mongoose.Schema.Types.Mixed,
    },

    // Email Template
    emailTemplate: {
      subject: String,
      body: String,
      preview_text: String,
      sequence: [
        {
          subject: String,
          body: String,
          dayOffset: Number,
        },
      ],
    },

    // Campaign
    campaign: {
      platform: String,
      campaign_id: String,
      sent_at: Date,
      status: String,
    },

    // Error Tracking
    jobErrors: [
      {
        step: String,
        message: String,
        timestamp: Date,
      },
    ],

    retryCount: {
      type: Number,
      default: 0,
    },

    // Metadata
    processingTime: Number,
    cost: Number,
  },
  {
    timestamps: true,
  },
);

// Indexes
jobSchema.index({ url: 1 });
jobSchema.index({ status: 1 });
jobSchema.index({ createdAt: -1 });
jobSchema.index({ userId: 1, status: 1 });
jobSchema.index({ userId: 1, createdAt: -1 });

module.exports = mongoose.model("Job", jobSchema);
