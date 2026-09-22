const axios = require('axios');
const { checkAndNotifyQuotaExceeded } = require('../utils/quota.utils');

class ApolloService {
  constructor() {
    this.apiKey = process.env.APOLLO_API_KEY;
    this.baseURL = 'https://api.apollo.io/api/v1';
  }

  async findEmail(domain) {
    try {
      console.log(`🔍 [Apollo] Finding email for domain via Apollo: ${domain}`);

      const seniorities = [
        'owner',
        'founder',
        'head',
        'director',
        'manager'
      ];
      const titles = ['Founder/CEO', 'Director of Marketing',];
      const titlesQuery = titles.map(t => `person_titles[]=${encodeURIComponent(t)}`).join('&');
      const senioritiesQuery = seniorities
        .map(s => `person_seniorities[]=${encodeURIComponent(s)}`)
        .join('&');

      const searchRes = await axios.post(
        `${this.baseURL}/mixed_people/api_search?q_organization_domains_list[]=${domain}&${titlesQuery}&${senioritiesQuery}&include_similar_titles=true`,
        {
          page: 1,
          per_page: 10
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'accept': 'application/json',
            'X-Api-Key': this.apiKey
          }
        }
      );

      console.log('📦 [Apollo] Search Status:', searchRes.status);
      const people = searchRes.data?.people || [];

      // Prioritize Founder/CEO over Marketing roles
      let person = people.find(p => {
        const title = (p.title || '').toLowerCase();
        return title.includes('founder') || title.includes('ceo') || title.includes('chief executive');
      });

      if (!person) {
        person = people.find(p => {
          const title = (p.title || '').toLowerCase();
          return title.includes('marketing') || title.includes('cmo');
        });
      }

      // Fallback to first result if no priority match found
      if (!person && people.length > 0) {
        person = people[0];
      }

      if (!person) {
        return null;
      }

      const enrichRes = await axios.post(
        `${this.baseURL}/people/match?id=${person.id}&
        run_waterfall_email=false&
        run_waterfall_phone=false&
        reveal_personal_emails=false&
        reveal_phone_number=false`,
        {},
        {
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache',
            'accept': 'application/json',
            'X-Api-Key': this.apiKey
          }
        }
      );

      const enriched = enrichRes.data?.person || enrichRes.data;
      const email = enriched?.email || enriched?.emails?.[0]?.email;

      if (email) {
        return {
          email,
          name: `${enriched.first_name || ''} ${enriched.last_name || ''}`.trim(),
          title: enriched.title,
          confidence: 85,
          source: 'apollo.io'
        };
      }

      return null;
    } catch (error) {
      // Check for Insufficient Quota (Credits Expired)
       await checkAndNotifyQuotaExceeded('Apollo', error);
      console.error('Apollo.io Error:', error.response?.data || error.message);
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

  async findContactInfo(url, pageContent) {
    // Try to extract email from page content first
    console.log(`🕵️ [Apollo] Attempting to extract email from page content for ${url}`);
    const emailFromPage = this.extractEmailFromContent(pageContent);

    if (emailFromPage) {
      console.log(`✅ [Apollo] Found email on webpage: ${emailFromPage}`);
      return {
        email: emailFromPage,
        source: 'webpage',
        confidence: 'high'
      };
    }

    console.log('⚠️ [Apollo] No email found on webpage, falling back to Apollo API');

    // Fallback to Apollo.io
    const domain = this.extractDomain(url);
    if (!domain) {
      console.log('❌ [Apollo] Could not extract domain from URL');
      return null;
    }

    return await this.findEmail(domain);
  }

  extractEmailFromContent(content) {
    if (!content) return null;

    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const emails = content.match(emailRegex);

    if (emails && emails.length > 0) {
      // Filter out common non-contact emails
      const filtered = emails.filter(email =>
        !email.includes('example.com') &&
        !email.includes('sentry.io') &&
        !email.includes('no-reply')
      );

      return filtered[0] || null;
    }

    return null;
  }
}

module.exports = new ApolloService();
