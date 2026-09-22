const xlsx = require('xlsx');

class ExcelUtils {
  static readURLsFromExcel(filePath) {
    try {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const data = xlsx.utils.sheet_to_json(sheet);
      
      // Try different column names
      const urls = data.map(row => {
        return row.url || row.URL || row.Url || row.website || row.Website;
      }).filter(Boolean);
      
      return urls;
    } catch (error) {
      throw new Error(`Failed to read Excel file: ${error.message}`);
    }
  }
  
  static createExcelFromResults(jobs) {
    try {
      const data = jobs.map(job => ({
        URL: job.url,
        Status: job.status,
        'Critical Issues': job.analysis?.critical_issues?.length || 0,
        'Opportunities': job.analysis?.opportunities?.length || 0,
        'Contact Email': job.contact?.email || 'Not found',
        'Estimated Lift': job.analysis?.estimated_lift || 'N/A',
        'Processing Time (ms)': job.processingTime || 0,
        'Created At': job.createdAt
      }));
      
      const worksheet = xlsx.utils.json_to_sheet(data);
      const workbook = xlsx.utils.book_new();
      xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');
      
      return workbook;
    } catch (error) {
      throw new Error(`Failed to create Excel: ${error.message}`);
    }
  }
  
  static exportToExcel(jobs, filename) {
    try {
      const workbook = this.createExcelFromResults(jobs);
      xlsx.writeFile(workbook, filename);
      return filename;
    } catch (error) {
      throw new Error(`Failed to export Excel: ${error.message}`);
    }
  }
}

module.exports = ExcelUtils;
