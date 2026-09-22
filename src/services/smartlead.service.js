const axios = require('axios');
const { checkAndNotifyQuotaExceeded } = require('../utils/quota.utils');

class SmartLeadService {
  constructor() {
    this.apiKey = process.env.SMARTLEAD_API_KEY;
    this.baseUrl = 'https://server.smartlead.ai/api/v1';
  }

  /**
   * Adds a lead to a specific SmartLead campaign
   * @param {string} campaignId - The ID of the SmartLead campaign
   * @param {Object} leadData - The lead details
   * @returns {Promise<Object>} - API response
   */
  async addLeadToCampaign(campaignId, leadData) {
    if (!this.apiKey) {
      throw new Error('SMARTLEAD_API_KEY is not configured in environment variables');
    }
    if (!campaignId) {
      throw new Error('Campaign ID is required to add a lead');
    }

    try {
      console.log(`🚀 [SmartLead] Adding lead to campaign ${campaignId}: ${leadData.email}`);
      console.log(`customFields: ${JSON.stringify(leadData.customFields)}`);

      // Map fields to SmartLead format
      // API expects lead_list array
      const payload = {
        lead_list: [
          {
            email: leadData.email,
            first_name: leadData.firstName,
            last_name: leadData.lastName,
            company_name: leadData.companyName,
            website: leadData.website,
            // Map custom fields (e.g., generated content)
            custom_fields: {
              ...leadData.customFields
            }
          }
        ],
        settings: {
          ignore_global_block_list: false,
          ignore_unsubscribe_list: false,
          ignore_community_bounce_list: false
        }
      };

      const response = await axios.post(
        `${this.baseUrl}/campaigns/${campaignId}/leads?api_key=${this.apiKey}`,
        payload
      );

      // Check if SmartLead actually accepted the lead
      if (response.data.ok === false) {
        throw new Error(response.data.error || 'SmartLead returned ok: false');
      }
2
      console.log('✅ [SmartLead] Lead added successfully:', response.data);
      return response.data;
    } catch (error) {
      await checkAndNotifyQuotaExceeded('SmartLead', error);
      console.error('❌ [SmartLead] Error adding lead:', error.response?.data || error.message);
      // Throwing error to be handled by the caller (WorkflowService)
      throw new Error(`SmartLead API Error: ${JSON.stringify(error.response?.data || error.message)}`);
    }
  }
}

module.exports = new SmartLeadService();
