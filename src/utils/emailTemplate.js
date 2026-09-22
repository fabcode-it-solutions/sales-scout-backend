const wrapEmail = (content, previewText = '', signature = {}) => {
  const { name, position, contactInfo } = signature;
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Email from SalesScout</title>
  <style>
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      line-height: 1.4;
      color: #333333;
      margin: 0;
      padding: 0;
      background-color: #f4f4f4;
    }
    p {
      margin-bottom: 1em;
      margin-top: 0;
    }
    .container {
      max-width: 600px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);
      margin-top: 20px;
      margin-bottom: 20px;
    }
    .header {
      background-color: #2563eb;
      color: #ffffff;
      padding: 20px 30px;
      text-align: center;
    }
    .header h1 {
      margin: 0;
      font-size: 24px;
      font-weight: 600;
    }
    .content {
      padding: 30px;
      background-color: #ffffff;
    }
    .footer {
      background-color: #f9fafb;
      padding: 20px;
      text-align: center;
      font-size: 12px;
      color: #6b7280;
      border-top: 1px solid #e5e7eb;
    }
    .signature {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #eee;
    }
    .signature p {
      margin: 2px 0;
      color: #555;
    }
    .signature .name {
      font-weight: bold;
      color: #2563eb;
      font-size: 16px;
    }
    .preview-text {
      display: none;
      font-size: 0;
      max-height: 0;
      overflow: hidden;
      mso-hide: all;
    }
    a {
      color: #2563eb;
      text-decoration: none;
    }
    strong {
      color: #111827;
    }
    ul {
      padding-left: 20px;
    }
    li {
      margin-bottom: 8px;
    }
  </style>
</head>
<body>
  <div class="preview-text">
    ${previewText}
  </div>
  <div class="container">
    <div class="header">
      <h1>SalesScout Analysis</h1>
    </div>
    <div class="content">
      ${content}
      
      // ${name ? `
      // <div class="signature">
      //   <p class="name">${name}</p>
      //   ${position ? `<p>${position}</p>` : ''}
      //   ${contactInfo ? `<p>${contactInfo}</p>` : ''}
      // </div>
      // ` : ''}
    </div>
    // <div class="footer">
    //   <p>&copy; ${new Date().getFullYear()} SalesScout. All rights reserved.</p>
    //   <p>Automated Website Analysis & Outreach System</p>
    // </div>
  </div>
</body>
</html>
  `;
};

module.exports = { wrapEmail };
