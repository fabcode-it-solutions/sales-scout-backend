const axios = require("axios");
const firecrawlService = require("./firecrawl.service");
const openaiService = require("./openai.service");
const apolloService = require("./apollo.service");
const smartleadService = require("./smartlead.service");
const dataforseoService = require("./dataforseo.service");
// const hunterService = require('./hunter.service');
const smtpUtil = require("../utils/smtp.util");
const { wrapEmail } = require("../utils/emailTemplate");
// const { saveToWord } = require('../utils/wordGenerator');
const Job = require("../models/Job");
const seoreviewService = require("./seoreview.service");

class WorkflowService {
  async processURL(jobId, url, type = "normal") {
    if (type === "data_for_seo") {
      // return this.processDataForSeoURL(jobId, url);
      return this.processDataForSeoReviewURL(jobId, url);
    }
    const startTime = Date.now();

    // Normalize URL: trim and ensure protocol
    url = url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    try {
      // Step 1: Check if site is accessible (404 check)
      console.log(`🔍 [Workflow] Checking if site is accessible: ${url}`);
      try {
        await axios.head(url, {
          timeout: 15000,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesScout/1.0)" },
          validateStatus: (status) => status < 400, // Reject if 404 or 5xx
        });
      } catch (error) {
        console.warn(
          `⚠️ [Workflow] Site ${url} is not accessible: ${error.message}`,
        );
        await Job.findByIdAndUpdate(jobId, {
          status: "failed",
          jobErrors: [
            {
              step: "accessibility_check",
              message: `Site not accessible: ${error.message}`,
              timestamp: new Date(),
            },
          ],
        });
        return { success: false, reason: "site_not_accessible" };
      }

      // Step 2: Check for email in Apollo
      await this.updateJobStatus(jobId, "finding_contact");

      let domain;
      try {
        domain = new URL(url).hostname.replace("www.", "");
      } catch (e) {
        domain = url;
      }

      const skipApollo =
        (process.env.SKIP_APOLLO || "").toString().toLowerCase().trim() ===
        "true";
      let contact = null;
      let apolloContact = null;

      if (!skipApollo) {
        apolloContact = await apolloService.findEmail(domain);
      }

      if (process.env.STATIC_TEST_EMAIL || skipApollo) {
        if (apolloContact) {
          contact = {
            ...apolloContact,
            email: process.env.STATIC_TEST_EMAIL || apolloContact.email,
            originalEmail: apolloContact.email,
          };
        } else {
          const recipientsEnv = process.env.SMTP_TEST_RECIPIENTS || "";
          const recipientsParsed = recipientsEnv
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean);
          const fallbackEmail =
            process.env.STATIC_TEST_EMAIL ||
            recipientsParsed[0] ||
            "test@example.com";

          contact = {
            email: fallbackEmail,
            name: "Test User",
            title: "Tester",
            confidence: 100,
            source: skipApollo ? "bypass" : "static_test",
          };
          console.log(
            `⚠️ [Workflow] No Apollo contact found (or bypassed). Using dummy Test User: ${contact.email}`,
          );
        }
      } else {
        contact = apolloContact;
      }

      if (!contact) {
        console.warn(
          `⚠️ [Workflow] No contact found in Apollo for ${domain}. Skipping.`,
        );
        await Job.findByIdAndUpdate(jobId, {
          status: "failed",
          jobErrors: [
            {
              step: "contact_finding",
              message: "No contact found in Apollo",
              timestamp: new Date(),
            },
          ],
        });
        return { success: false, reason: "no_contact_found" };
      }

      console.log(`✅ [Workflow] Found contact in Apollo: ${contact.email}`);
      await Job.findByIdAndUpdate(jobId, { contact });

      // Step 3: Crawl website (Firecrawl)
      await this.updateJobStatus(jobId, "crawling");
      console.log(`🕷️ [Workflow] Starting crawl for ${url}`);
      const crawledData = await firecrawlService.scrapeHomepageAndProduct(url);

      await Job.findByIdAndUpdate(jobId, {
        homepageContent: crawledData.homepage,
        productPageContent: crawledData.productPage,
      });

      // Step 4: Analyze with AI
      await this.updateJobStatus(jobId, "analyzing");
      // const analysis = await openaiService.analyzeWebsite(
      //   crawledData.homepage,
      //   crawledData.productPage,
      // );
      // await Job.findByIdAndUpdate(jobId, { analysis });

      // Step 5: Generate email
      await this.updateJobStatus(jobId, "generating_email");
      const companyName =
        crawledData.homepage.metadata?.title?.split("-")[0]?.trim() || domain;
      const emailTemplate = await openaiService.generateEmailWebsite(
        crawledData.homepage,
        contact,
        companyName,
      );
      console.log(
        `✅ [Workflow] Email template generated for ${emailTemplate.subject}`,
      );
      await Job.findByIdAndUpdate(jobId, { emailTemplate });

      // Step 6: Create campaign (Send Email via SmartLead or SMTP)
      await this.updateJobStatus(jobId, "creating_campaign");

      const smartLeadCampaignId = process.env.SMARTLEAD_CAMPAIGN_ID;

      // Check if we have SmartLead configuration and not skipping it
      if (smartLeadCampaignId && process.env.SMARTLEAD_API_KEY && !skipApollo) {
        try {
          console.log(
            `🚀 [Workflow] Adding lead to SmartLead Campaign ID: ${smartLeadCampaignId}`,
          );

          const nameParts = (contact.name || "").split(" ");
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";

          // Send to SmartLead
          await smartleadService.addLeadToCampaign(smartLeadCampaignId, {
            email: contact.email,
            firstName,
            lastName,
            companyName,
            website: url,
            customFields: {
              generated_subject: emailTemplate.subject,
              generated_email_body: emailTemplate.body,
              generated_email_body_2: emailTemplate.sequence?.[0]?.body || "",
              generated_email_body_3: emailTemplate.sequence?.[1]?.body || "",
            },
          });

          await Job.findByIdAndUpdate(jobId, {
            campaign: {
              platform: "smartlead",
              campaign_id: smartLeadCampaignId,
              sent_at: new Date(),
              status: "lead_added",
            },
          });

          console.log(`✅ [Workflow] Lead added to SmartLead successfully`);
        } catch (slError) {
          console.error(`❌ [Workflow] SmartLead error: ${slError.message}`);
          console.log("⚠️ [Workflow] Falling back to SMTP...");
          await this.sendViaSMTP(contact, emailTemplate, jobId);
        }
      } else {
        // Default to SMTP if no SmartLead config
        await this.sendViaSMTP(contact, emailTemplate, jobId);
      }

      // Mark as completed
      const processingTime = Date.now() - startTime;
      await Job.findByIdAndUpdate(jobId, {
        status: "completed",
        processingTime,
      });

      console.log(`✅ Completed processing ${url} in ${processingTime}ms`);

      return { success: true, jobId };
    } catch (error) {
      console.error(`❌ Error processing ${url}:`, error.message);

      await Job.findByIdAndUpdate(jobId, {
        status: "failed",
        $push: {
          jobErrors: {
            step: error.step || "unknown",
            message: error.message,
            timestamp: new Date(),
          },
        },
      });

      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // DataForSEO Flow
  // ============================================================
  async processDataForSeoURL(jobId, url) {
    const startTime = Date.now();
    url = url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    try {
      // Step 1: Check if site is accessible
      console.log(`🔍 [Workflow-SEO] Checking if site is accessible: ${url}`);
      try {
        await axios.head(url, {
          timeout: 15000,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesScout/1.0)" },
          validateStatus: (status) => status < 400,
        });
      } catch (error) {
        console.warn(
          `⚠️ [Workflow-SEO] Site ${url} is not accessible: ${error.message}`,
        );
        await Job.findByIdAndUpdate(jobId, {
          status: "failed",
          jobErrors: [
            {
              step: "accessibility_check",
              message: `Site not accessible: ${error.message}`,
              timestamp: new Date(),
            },
          ],
        });
        return { success: false, reason: "site_not_accessible" };
      }

      // Step 2: Check for email in Apollo
      await this.updateJobStatus(jobId, "finding_contact");

      let domain;
      try {
        domain = new URL(url).hostname.replace("www.", "");
      } catch (e) {
        domain = url;
      }

      const skipApollo =
        (process.env.SKIP_APOLLO || "").toString().toLowerCase().trim() ===
        "true";
      let contact = null;
      let apolloContact = null;

      if (!skipApollo) {
        apolloContact = await apolloService.findEmail(domain);
      }

      if (process.env.STATIC_TEST_EMAIL || skipApollo) {
        if (apolloContact) {
          contact = {
            ...apolloContact,
            email: process.env.STATIC_TEST_EMAIL || apolloContact.email,
            originalEmail: apolloContact.email,
          };
        } else {
          const recipientsEnv = process.env.SMTP_TEST_RECIPIENTS || "";
          const recipientsParsed = recipientsEnv
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean);
          const fallbackEmail =
            process.env.STATIC_TEST_EMAIL ||
            recipientsParsed[0] ||
            "test@example.com";

          contact = {
            email: fallbackEmail,
            name: "Test User",
            title: "Tester",
            confidence: 100,
            source: skipApollo ? "bypass" : "static_test",
          };
        }
      } else {
        contact = apolloContact;
      }

      if (!contact) {
        console.warn(
          `⚠️ [Workflow-SEO] No contact found in Apollo for ${domain}. Skipping.`,
        );
        await Job.findByIdAndUpdate(jobId, {
          status: "failed",
          jobErrors: [
            {
              step: "contact_finding",
              message: "No contact found in Apollo",
              timestamp: new Date(),
            },
          ],
        });
        return { success: false, reason: "no_contact_found" };
      }

      console.log(`✅ [Workflow-SEO] Found contact: ${contact.email}`);
      await Job.findByIdAndUpdate(jobId, { contact });

      // Step 3: Fetch ALL DataForSEO data in parallel
      await this.updateJobStatus(jobId, "crawling");
      console.log(
        `📊 [Workflow-SEO] Starting DataForSeo data fetch for ${url}`,
      );

      const seoData = await dataforseoService.getAllData(url);
      console.log(`✅ [Workflow-SEO] DataForSeo fetch completed for ${url}`);

      // Check if we have enough data to proceed (only checking active APIs: domainOverview, aiOverviewKeywords, whois)
      const hasValidData =
        seoData &&
        (seoData.domainOverview ||
          seoData.whois ||
          seoData.aiOverviewKeywords ||
          (seoData.summary &&
            (seoData.summary.organic_traffic ||
              seoData.summary.domain_age_years ||
              seoData.summary.authority_score)));

      if (!hasValidData) {
        console.warn(
          `⚠️ [Workflow-SEO] DataForSeo returned insufficient data for ${url}. Aborting analysis.`,
        );
        await Job.findByIdAndUpdate(jobId, {
          status: "failed",
          jobErrors: [
            {
              step: "data_fetching",
              message:
                "DataForSeo returned insufficient data (all fields null). Check API credentials and logs.",
              timestamp: new Date(),
            },
          ],
        });
        return { success: false, reason: "insufficient_data" };
      }

      // Save all SEO data
      await Job.findByIdAndUpdate(jobId, {
        dataForSeo: seoData,
      });

      // Step 4: Analyze with AI
      await this.updateJobStatus(jobId, "analyzing");
      const analysis = await openaiService.analyzeDataForSeo(seoData);
      await Job.findByIdAndUpdate(jobId, { analysis });

      // Step 5: Generate email (pass seoData for analytics paragraph in SEO flow)
      await this.updateJobStatus(jobId, "generating_email");
      const companyName = seoData.summary?.domain || domain;
      const emailTemplate = await openaiService.generateEmailSeo(
        contact,
        companyName,
        seoData,
      );
      console.log(
        `✅ [Workflow-SEO] Email template generated for ${emailTemplate}`,
      );
      await Job.findByIdAndUpdate(jobId, { emailTemplate });

      // Step 6: Create campaign (Send Email via SmartLead or SMTP)
      await this.updateJobStatus(jobId, "creating_campaign");

      const smartLeadDFSCampaignId = process.env.SMARTLEAD_DFS_CAMPAIGN_ID;

      if (
        smartLeadDFSCampaignId &&
        process.env.SMARTLEAD_API_KEY &&
        !skipApollo
      ) {
        try {
          console.log(
            `🚀 [Workflow-SEO] Adding lead to SmartLead Campaign ID: ${smartLeadDFSCampaignId}`,
          );

          const nameParts = (contact.name || "").split(" ");
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";

          await smartleadService.addLeadToCampaign(smartLeadDFSCampaignId, {
            email: contact.email,
            firstName,
            lastName,
            companyName,
            website: url,
            customFields: {
              generated_DFS_subject: emailTemplate.subject,
              generated_DFS_email_body: emailTemplate.body,
              generated_DFS_email_body_2:
                emailTemplate.sequence?.[0]?.body || "",
              generated_DFS_email_body_3:
                emailTemplate.sequence?.[1]?.body || "",
            },
          });

          await Job.findByIdAndUpdate(jobId, {
            campaign: {
              platform: "smartlead",
              campaign_id: smartLeadDFSCampaignId,
              sent_at: new Date(),
              status: "lead_added",
            },
          });

          console.log(`✅ [Workflow-SEO] Lead added to SmartLead successfully`);
        } catch (slError) {
          console.error(
            `❌ [Workflow-SEO] SmartLead error: ${slError.message}`,
          );
          console.log("⚠️ [Workflow-SEO] Falling back to SMTP...");
          await this.sendViaSMTP(contact, emailTemplate, jobId);
        }
      } else {
        await this.sendViaSMTP(contact, emailTemplate, jobId);
      }

      // Mark as completed
      const processingTime = Date.now() - startTime;
      await Job.findByIdAndUpdate(jobId, {
        status: "completed",
        processingTime,
      });

      console.log(
        `✅ [Workflow-SEO] Completed processing ${url} in ${processingTime}ms`,
      );

      return { success: true, jobId };
    } catch (error) {
      console.error(
        `❌ [Workflow-SEO] Error processing ${url}:`,
        error.message,
      );

      await Job.findByIdAndUpdate(jobId, {
        status: "failed",
        $push: {
          jobErrors: {
            step: error.step || "unknown",
            message: error.message,
            timestamp: new Date(),
          },
        },
      });

      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // SEO Review Tools Flow
  // ============================================================
  async processDataForSeoReviewURL(jobId, url) {
    const startTime = Date.now();
    url = url.trim();
    if (!url.startsWith("http://") && !url.startsWith("https://")) {
      url = `https://${url}`;
    }

    try {
      console.log(
        `🔍 [Workflow-SEOReview] Checking if site is accessible: ${url}`,
      );
      try {
        await axios.head(url, {
          timeout: 15000,
          headers: { "User-Agent": "Mozilla/5.0 (compatible; SalesScout/1.0)" },
          validateStatus: (status) => status < 400,
        });
      } catch (error) {
        console.warn(
          `⚠️ [Workflow-SEOReview] Site ${url} is not accessible: ${error.message}`,
        );
        await Job.findByIdAndUpdate(jobId, {
          status: "failed",
          jobErrors: [
            {
              step: "accessibility_check",
              message: `Site not accessible: ${error.message}`,
              timestamp: new Date(),
            },
          ],
        });
        return { success: false, reason: "site_not_accessible" };
      }

      await this.updateJobStatus(jobId, "finding_contact");

      let domain;
      try {
        domain = new URL(url).hostname.replace("www.", "");
      } catch (e) {
        domain = url;
      }

      const skipApollo =
        (process.env.SKIP_APOLLO || "").toString().toLowerCase().trim() ===
        "true";
      let contact = null;
      let apolloContact = null;

      if (!skipApollo) {
        apolloContact = await apolloService.findEmail(domain);
      }

      if (process.env.STATIC_TEST_EMAIL || skipApollo) {
        if (apolloContact) {
          contact = {
            ...apolloContact,
            email: process.env.STATIC_TEST_EMAIL || apolloContact.email,
            originalEmail: apolloContact.email,
          };
        } else {
          const recipientsEnv = process.env.SMTP_TEST_RECIPIENTS || "";
          const recipientsParsed = recipientsEnv
            .split(",")
            .map((e) => e.trim())
            .filter(Boolean);
          const fallbackEmail =
            process.env.STATIC_TEST_EMAIL ||
            recipientsParsed[0] ||
            "test@example.com";

          contact = {
            email: fallbackEmail,
            name: "Test User",
            title: "Tester",
            confidence: 100,
            source: skipApollo ? "bypass" : "static_test",
          };
        }
      } else {
        contact = apolloContact;
      }

      if (!contact) {
        console.warn(
          `⚠️ [Workflow-SEOReview] No contact found in Apollo for ${domain}. Skipping.`,
        );
        await Job.findByIdAndUpdate(jobId, {
          status: "failed",
          jobErrors: [
            {
              step: "contact_finding",
              message: "No contact found in Apollo",
              timestamp: new Date(),
            },
          ],
        });
        return { success: false, reason: "no_contact_found" };
      }

      console.log(`✅ [Workflow-SEOReview] Found contact: ${contact.email}`);
      await Job.findByIdAndUpdate(jobId, { contact });

      await this.updateJobStatus(jobId, "crawling");
      console.log(
        `📊 [Workflow-SEOReview] Starting SEOReviewTools data fetch for ${url}`,
      );

      const seoreviewData =
        await seoreviewService.analyzeContentUsingBrandVisibility(url, domain);
      console.log(
        `✅ [Workflow-SEOReview] SEOReviewTools fetch completed for ${url}`,
      );

      const trafficInfo = await seoreviewService.getWebsiteTraffic(domain);
      console.log(
        "✅ [Workflow-SEOReview] Website traffic fetch completed",
        JSON.stringify(trafficInfo, null, 2),
      );

      const contentScore =
        seoreviewData?.contentAnalysis?.score ??
        seoreviewData?.contentAnalysis?.["Overall SEO score"] ??
        null;
      const contentWarningsCount = Array.isArray(
        seoreviewData?.contentAnalysis?.warnings,
      )
        ? seoreviewData.contentAnalysis.warnings.length
        : 0;
      const contentIssuesCount = Array.isArray(
        seoreviewData?.contentAnalysis?.issues,
      )
        ? seoreviewData.contentAnalysis.issues.length
        : 0;

      const summary = {
        domain,
        authority_score: null,
        organic_traffic: trafficInfo.organicTraffic ?? null,
        keyword_count: null,
        top_positions: null,
        top_3_positions: null,
        paid_traffic: trafficInfo.paidTraffic ?? null,
        domain_age_years: null,
        domain_created: null,
        domain_expires: null,
        registrar: null,
        backlinks_count: null,
        referring_domains: null,
        pages_crawled: null,
        health_issues: null,
        onpage_score: contentScore,
        onpage_warnings_count: contentWarningsCount,
        onpage_issues_count: contentIssuesCount,
        has_ai_overview: null,
        has_featured_snippet: null,
        ai_overview_keywords_count: 0,
        technologies_count: null,
        total_ranked_keywords: null,
        paid_traffic_cost: trafficInfo.paidTrafficCost ?? null,
      };

      console.log(
        "[Workflow-SEOReview] Built summary",
        JSON.stringify(summary, null, 2),
      );

      const seoDataForAnalysis = {
        summary,
      };

      const seoDataForEmail = {
        summary,
        seoreview: {
          brandVisibility: seoreviewData.brandVisibility,
          contentAnalysis: seoreviewData.contentAnalysis,
          usedKeyword: seoreviewData.usedKeyword,
          usedRelatedKeywords: seoreviewData.usedRelatedKeywords,
          trafficInfo,
        },
      };

      await Job.findByIdAndUpdate(jobId, {
        dataForSeo: seoDataForEmail,
      });

      await this.updateJobStatus(jobId, "analyzing");
      const analysis =
        await openaiService.analyzeDataForSeoReview(seoDataForEmail);
      await Job.findByIdAndUpdate(jobId, { analysis });

      await this.updateJobStatus(jobId, "generating_email");
      const companyName = summary.domain || domain;
      const emailTemplate = await openaiService.generateEmailSeoReview(
        contact,
        companyName,
        seoDataForEmail,
      );
      await Job.findByIdAndUpdate(jobId, { emailTemplate });

      await this.updateJobStatus(jobId, "creating_campaign");

      const smartLeadDFSCampaignId = process.env.SMARTLEAD_DFS_CAMPAIGN_ID;

      if (
        smartLeadDFSCampaignId &&
        process.env.SMARTLEAD_API_KEY &&
        !skipApollo
      ) {
        try {
          console.log(
            `🚀 [Workflow-SEOReview] Adding lead to SmartLead Campaign ID: ${smartLeadDFSCampaignId}`,
          );

          const nameParts = (contact.name || "").split(" ");
          const firstName = nameParts[0] || "";
          const lastName = nameParts.slice(1).join(" ") || "";

          await smartleadService.addLeadToCampaign(smartLeadDFSCampaignId, {
            email: contact.email,
            firstName,
            lastName,
            companyName,
            website: url,
            customFields: {
              generated_DFS_subject: emailTemplate.subject,
              generated_DFS_email_body: emailTemplate.body,
              generated_DFS_email_body_2:
                emailTemplate.sequence?.[0]?.body || "",
              generated_DFS_email_body_3:
                emailTemplate.sequence?.[1]?.body || "",
            },
          });

          await Job.findByIdAndUpdate(jobId, {
            campaign: {
              platform: "smartlead",
              campaign_id: smartLeadDFSCampaignId,
              sent_at: new Date(),
              status: "lead_added",
            },
          });

          console.log(
            `✅ [Workflow-SEOReview] Lead added to SmartLead successfully`,
          );
        } catch (slError) {
          console.error(
            `❌ [Workflow-SEOReview] SmartLead error: ${slError.message}`,
          );
          console.log("⚠️ [Workflow-SEOReview] Falling back to SMTP...");
          await this.sendViaSMTP(contact, emailTemplate, jobId);
        }
      } else {
        await this.sendViaSMTP(contact, emailTemplate, jobId);
      }

      const processingTime = Date.now() - startTime;
      await Job.findByIdAndUpdate(jobId, {
        status: "completed",
        processingTime,
      });

      console.log(
        `✅ [Workflow-SEOReview] Completed processing ${url} in ${processingTime}ms`,
      );

      return { success: true, jobId };
    } catch (error) {
      console.error(
        `❌ [Workflow-SEOReview] Error processing ${url}:`,
        error.message,
      );

      await Job.findByIdAndUpdate(jobId, {
        status: "failed",
        $push: {
          jobErrors: {
            step: error.step || "unknown",
            message: error.message,
            timestamp: new Date(),
          },
        },
      });

      return { success: false, error: error.message };
    }
  }

  // ============================================================
  // Helper methods
  // ============================================================
  async updateJobStatus(jobId, status) {
    await Job.findByIdAndUpdate(jobId, { status });
  }

  async sendViaSMTP(contact, emailTemplate, jobId) {
    try {
      const wrappedHtml = wrapEmail(emailTemplate.body);

      await smtpUtil.sendEmail(
        contact.email,
        emailTemplate.subject,
        wrappedHtml,
      );

      await Job.findByIdAndUpdate(jobId, {
        campaign: {
          platform: "smtp",
          sent_at: new Date(),
          status: "sent",
        },
      });

      console.log(`📧 [SMTP] Email sent to ${contact.email}`);
    } catch (smtpError) {
      console.error(`❌ [SMTP] Failed to send email: ${smtpError.message}`);
      await Job.findByIdAndUpdate(jobId, {
        $push: {
          jobErrors: {
            step: "email_sending",
            message: `SMTP send failed: ${smtpError.message}`,
            timestamp: new Date(),
          },
        },
      });
    }
  }
}

module.exports = new WorkflowService();
