const xlsx = require('xlsx');

const testURLs = [
  { url: 'https://www.shopify.com' },
  { url: 'https://www.allbirds.com' },
  { url: 'https://www.gymshark.com' }
];

const worksheet = xlsx.utils.json_to_sheet(testURLs);
const workbook = xlsx.utils.book_new();
xlsx.utils.book_append_sheet(workbook, worksheet, 'URLs');

xlsx.writeFile(workbook, 'test-urls.xlsx');
console.log('✅ Created test-urls.xlsx');
