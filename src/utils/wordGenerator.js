const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel } = require('docx');

/**
 * Saves crawled data and AI analysis to Word documents.
 * Generates two separate files: one for analysis report and one for raw data.
 * @param {Object} data - Object containing crawledData and/or analysis
 * @param {string} url - The URL that was processed
 * @returns {Promise<Array<string>>} - Paths to the saved files
 */
const saveToWord = async (data, url) => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const safeUrl = url.replace(/[^a-z0-9]/gi, '_').substring(0, 50);
    const downloadDir = path.join(process.cwd(), 'downloads');
    
    if (!fs.existsSync(downloadDir)) {
      fs.mkdirSync(downloadDir, { recursive: true });
    }

    const savedFiles = [];

    // ==========================================
    // 1. Generate Analysis Report (if analysis exists)
    // ==========================================
    if (data.analysis) {
        const reportFileName = `report_analysis_${safeUrl}_${timestamp}.docx`;
        const reportFilePath = path.join(downloadDir, reportFileName);
        const reportChildren = [];

        // Title
        reportChildren.push(
            new Paragraph({
                text: `SalesScout Analysis: ${url}`,
                heading: HeadingLevel.TITLE,
            }),
            new Paragraph({
                text: `Generated at: ${new Date().toLocaleString()}`,
                spacing: { after: 200 },
            })
        );

        const { analysis } = data;

        // 1. Critical Issues
        if (analysis.critical_issues && analysis.critical_issues.length > 0) {
            reportChildren.push(
              new Paragraph({
                text: 'Critical Issues',
                heading: HeadingLevel.HEADING_2,
                color: 'FF0000'
              })
            );
    
            analysis.critical_issues.forEach(item => {
              reportChildren.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: `• ${item.issue}`, bold: true }),
                    new TextRun({ text: ` (Impact: ${item.impact})`, italics: true })
                  ],
                  spacing: { before: 100 }
                }),
                new Paragraph({
                  text: `Fix: ${item.fix}`,
                  indent: { left: 720 }
                })
              );
            });
        }

        // 2. Opportunities
        if (analysis.opportunities && analysis.opportunities.length > 0) {
            reportChildren.push(
              new Paragraph({
                text: 'Opportunities',
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 200 }
              })
            );
    
            analysis.opportunities.forEach(item => {
              reportChildren.push(
                new Paragraph({
                  children: [
                    new TextRun({ text: `• ${item.opportunity}`, bold: true }),
                  ],
                  spacing: { before: 100 }
                }),
                new Paragraph({
                  text: `Suggestion: ${item.suggested_change}`,
                  indent: { left: 720 }
                })
              );
            });
        }

        // 3. Strengths
        if (analysis.strengths && analysis.strengths.length > 0) {
            reportChildren.push(
              new Paragraph({
                text: 'Strengths',
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 200 }
              })
            );
    
            analysis.strengths.forEach(strength => {
              reportChildren.push(
                new Paragraph({
                  text: `• ${strength}`,
                  spacing: { before: 50 }
                })
              );
            });
        }

        // 4. Estimated Lift
        if (analysis.estimated_lift) {
            reportChildren.push(
              new Paragraph({
                text: 'Estimated Lift',
                heading: HeadingLevel.HEADING_2,
                spacing: { before: 200 }
              }),
              new Paragraph({
                text: analysis.estimated_lift,
                bold: true,
                color: '008000'
              })
            );
        }

        const reportDoc = new Document({
            sections: [{ children: reportChildren }],
        });

        const reportBuffer = await Packer.toBuffer(reportDoc);
        fs.writeFileSync(reportFilePath, reportBuffer);
        console.log(`📝 [WordGenerator] Analysis Report saved to: ${reportFilePath}`);
        savedFiles.push(reportFilePath);
    }

    // ==========================================
    // 2. Generate Raw Data File (if crawledData exists)
    // ==========================================
    if (data.crawledData) {
        const rawFileName = `raw_data_${safeUrl}_${timestamp}.docx`;
        const rawFilePath = path.join(downloadDir, rawFileName);
        const rawChildren = [];

        rawChildren.push(
            new Paragraph({
                text: `Raw Crawl Data: ${url}`,
                heading: HeadingLevel.TITLE,
            }),
            new Paragraph({
                text: `Generated at: ${new Date().toLocaleString()}`,
                spacing: { after: 200 },
            })
        );

        const { homepage, productPage } = data.crawledData;

        // Homepage Section
        if (homepage) {
            rawChildren.push(
                new Paragraph({
                    text: 'Homepage Data',
                    heading: HeadingLevel.HEADING_1,
                    spacing: { before: 400, after: 200 },
                })
            );

            if (homepage.metadata) {
                rawChildren.push(
                    new Paragraph({ text: 'Metadata', heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ text: `Title: ${homepage.metadata.title || 'N/A'}` }),
                    new Paragraph({ text: `Description: ${homepage.metadata.description || 'N/A'}` })
                );
            }

            if (homepage.markdown) {
                // We split large text into chunks to avoid Word paragraph limits if necessary, 
                // but usually splitting by newlines is safer for readability.
                rawChildren.push(
                    new Paragraph({ text: 'Content (Full Markdown)', heading: HeadingLevel.HEADING_2, spacing: { before: 200 } })
                );
                
                // Add content as a single paragraph or split if extremely large. 
                // For now, we put it in one paragraph as requested "whole raw data".
                // If it's too large, docx might fail, but let's assume it fits.
                // We use multiple TextRuns if needed? No, Paragraph text handles string.
                // To be safe against "string too long" errors in some JS engines, we can just put it.
                rawChildren.push(
                    new Paragraph({ text: homepage.markdown }) 
                );
            }
        }

        // Product Page Section
        if (productPage) {
            rawChildren.push(
                new Paragraph({
                    text: 'Product Page Data',
                    heading: HeadingLevel.HEADING_1,
                    pageBreakBefore: true,
                    spacing: { before: 400, after: 200 },
                }),
                new Paragraph({ text: `URL: ${productPage.url}` })
            );

            if (productPage.metadata) {
                rawChildren.push(
                    new Paragraph({ text: 'Metadata', heading: HeadingLevel.HEADING_2 }),
                    new Paragraph({ text: `Title: ${productPage.metadata.title || 'N/A'}` }),
                    new Paragraph({ text: `Description: ${productPage.metadata.description || 'N/A'}` })
                );
            }

            if (productPage.markdown) {
                rawChildren.push(
                    new Paragraph({ text: 'Content (Full Markdown)', heading: HeadingLevel.HEADING_2, spacing: { before: 200 } }),
                    new Paragraph({ text: productPage.markdown })
                );
            }
        }

        const rawDoc = new Document({
            sections: [{ children: rawChildren }],
        });

        const rawBuffer = await Packer.toBuffer(rawDoc);
        fs.writeFileSync(rawFilePath, rawBuffer);
        console.log(`📝 [WordGenerator] Raw Data saved to: ${rawFilePath}`);
        savedFiles.push(rawFilePath);
    }

    return savedFiles;

  } catch (error) {
    console.error('❌ [WordGenerator] Error saving files:', error.message);
    return null;
  }
};

module.exports = { saveToWord };
