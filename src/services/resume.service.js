const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const logger = require('../core/logger').createServiceLogger('RESUME');

class ResumeService {
  constructor() {
    this._dataDir = null;
    this._filePath = null;
    this._cachedResume = null;
    this._isInitialized = false;
  }

  _init() {
    if (this._isInitialized) return;
    try {
      this._dataDir = app ? app.getPath('userData') : path.join(__dirname, '../../');
      this._filePath = path.join(this._dataDir, 'candidate-resume.json');
      this._loadFromDisk();
      this._isInitialized = true;
    } catch (err) {
      logger.error('Failed to initialize resume service', { error: err.message });
    }
  }

  _loadFromDisk() {
    try {
      if (fs.existsSync(this._filePath)) {
        const raw = fs.readFileSync(this._filePath, 'utf8');
        const parsed = JSON.parse(raw);
        this._cachedResume = {
          text: parsed.text || '',
          fileName: parsed.fileName || '',
          company: parsed.company || '',
          jobDescription: parsed.jobDescription || '',
          updatedAt: parsed.updatedAt || null
        };
        logger.info('Loaded candidate context from disk', {
          chars: this._cachedResume.text ? this._cachedResume.text.length : 0,
          fileName: this._cachedResume.fileName,
          company: this._cachedResume.company,
          jdChars: this._cachedResume.jobDescription ? this._cachedResume.jobDescription.length : 0
        });
      } else {
        this._cachedResume = { text: '', fileName: '', company: '', jobDescription: '', updatedAt: null };
      }
    } catch (err) {
      logger.warn('Could not read resume file from disk, starting empty', { error: err.message });
      this._cachedResume = { text: '', fileName: '', company: '', jobDescription: '', updatedAt: null };
    }
  }

  getResume() {
    this._init();
    return this._cachedResume || { text: '', fileName: '', company: '', jobDescription: '', updatedAt: null };
  }

  saveProfile(data = {}) {
    this._init();
    try {
      const prev = this._cachedResume || {};
      const sanitizedText = typeof data.text === 'string' ? data.text.trim() : (prev.text || '');
      const sanitizedCompany = typeof data.company === 'string' ? data.company.trim().slice(0, 200) : (prev.company || '');
      const sanitizedJd = typeof data.jobDescription === 'string' ? data.jobDescription.trim() : (prev.jobDescription || '');
      const fileName = data.fileName || prev.fileName || 'Resume';

      const payload = {
        text: sanitizedText,
        fileName: fileName,
        company: sanitizedCompany,
        jobDescription: sanitizedJd,
        updatedAt: new Date().toISOString()
      };

      fs.writeFileSync(this._filePath, JSON.stringify(payload, null, 2), 'utf8');
      this._cachedResume = payload;
      logger.info('Candidate profile and interview context saved successfully', {
        chars: sanitizedText.length,
        company: sanitizedCompany,
        jdChars: sanitizedJd.length,
        fileName: payload.fileName
      });
      return { success: true, profile: payload };
    } catch (err) {
      logger.error('Failed to save candidate profile', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  saveResume(textOrData, fileName = '', company = '', jobDescription = '') {
    if (typeof textOrData === 'object' && textOrData !== null) {
      return this.saveProfile(textOrData);
    }
    return this.saveProfile({
      text: textOrData,
      fileName,
      company: company || (this._cachedResume && this._cachedResume.company) || '',
      jobDescription: jobDescription || (this._cachedResume && this._cachedResume.jobDescription) || ''
    });
  }

  clearResume() {
    this._init();
    try {
      const prev = this._cachedResume || {};
      const hasCompanyOrJd = !!((prev.company && prev.company.trim()) || (prev.jobDescription && prev.jobDescription.trim()));
      if (!hasCompanyOrJd && fs.existsSync(this._filePath)) {
        fs.unlinkSync(this._filePath);
        this._cachedResume = { text: '', fileName: '', company: '', jobDescription: '', updatedAt: null };
      } else {
        const payload = {
          text: '',
          fileName: '',
          company: prev.company || '',
          jobDescription: prev.jobDescription || '',
          updatedAt: new Date().toISOString()
        };
        fs.writeFileSync(this._filePath, JSON.stringify(payload, null, 2), 'utf8');
        this._cachedResume = payload;
      }
      logger.info('Candidate resume cleared');
      return { success: true };
    } catch (err) {
      logger.error('Failed to clear candidate resume', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  clearAll() {
    this._init();
    try {
      if (fs.existsSync(this._filePath)) {
        fs.unlinkSync(this._filePath);
      }
      this._cachedResume = { text: '', fileName: '', company: '', jobDescription: '', updatedAt: null };
      logger.info('Candidate profile and interview context fully cleared');
      return { success: true };
    } catch (err) {
      logger.error('Failed to clear candidate profile and context', { error: err.message });
      return { success: false, error: err.message };
    }
  }

  /**
   * Parse resume from a Buffer (PDF, TXT, MD)
   */
  async parseFileBuffer(buffer, originalFileName = '') {
    try {
      if (!buffer || buffer.length === 0) {
        throw new Error('Empty file buffer provided');
      }

      const ext = path.extname(originalFileName).toLowerCase();

      if (ext === '.pdf') {
        // Polyfill browser DOM globals for legacy pdf.js inside Electron's Node runtime
        if (typeof global.HTMLElement === 'undefined') {
          global.HTMLElement = class HTMLElement {};
        }
        if (typeof global.DOMMatrix === 'undefined') {
          global.DOMMatrix = class DOMMatrix {};
        }
        if (typeof global.Image === 'undefined') {
          global.Image = class Image {};
        }
        if (typeof global.ImageData === 'undefined') {
          global.ImageData = class ImageData {};
        }
        if (typeof global.Path2D === 'undefined') {
          global.Path2D = class Path2D {};
        }

        const pdfModule = require('pdf-parse');
        let extractedText = '';
        let pageCount = 1;

        try {
          if (pdfModule.PDFParse) {
            const parser = new pdfModule.PDFParse({ data: buffer });
            const result = await parser.getText();
            extractedText = (result.text || '').trim();
            pageCount = result.pages ? result.pages.length : (result.total || 1);
          } else if (typeof pdfModule === 'function') {
            const data = await pdfModule(buffer);
            extractedText = (data.text || '').trim();
            pageCount = data.numpages || 1;
          }
        } catch (pdfErr) {
          logger.warn('pdf-parse threw an error, trying fallback stream text extractor', {
            error: pdfErr.message,
            file: originalFileName
          });
          // Fallback text extraction directly from PDF buffer streams
          extractedText = this._extractPdfTextFallback(buffer);
        }

        extractedText = extractedText
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        if (!extractedText) {
          throw new Error('Could not extract readable text from PDF (it may be scanned/image-only)');
        }

        return {
          success: true,
          text: extractedText,
          fileName: originalFileName,
          pageCount
        };
      } else {
        // Plain text / Markdown
        const text = buffer.toString('utf8').trim();
        return {
          success: true,
          text,
          fileName: originalFileName,
          pageCount: 1
        };
      }
    } catch (err) {
      logger.error('Failed to parse resume file', { error: err.message, file: originalFileName });
      return { success: false, error: err.message };
    }
  }

  /**
   * Fallback text extractor from uncompressed PDF streams
   */
  _extractPdfTextFallback(buffer) {
    try {
      const zlib = require('zlib');
      const str = buffer.toString('binary');
      let allText = '';
      const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
      let match;
      while ((match = streamRegex.exec(str)) !== null) {
        const rawStream = Buffer.from(match[1], 'binary');
        let decompressed = '';
        try {
          decompressed = zlib.inflateSync(rawStream).toString('utf8');
        } catch (_) {
          try {
            decompressed = zlib.inflateRawSync(rawStream).toString('utf8');
          } catch (_) {
            decompressed = rawStream.toString('utf8');
          }
        }

        if (decompressed) {
          const textRegex = /\(([^)]+)\)\s*Tj/g;
          let tm;
          while ((tm = textRegex.exec(decompressed)) !== null) {
            allText += tm[1] + ' ';
          }
          const arrayTextRegex = /\[(.*?)\]\s*TJ/g;
          while ((tm = arrayTextRegex.exec(decompressed)) !== null) {
            const innerMatches = tm[1].match(/\(([^)]+)\)/g);
            if (innerMatches) {
              allText += innerMatches.map(m => m.slice(1, -1)).join('') + ' ';
            }
          }
        }
      }
      return allText.replace(/\\([()\\])/g, '$1').replace(/\s+/g, ' ').trim();
    } catch (_) {
      return '';
    }
  }

  /**
   * Build prompt context block for injection into General / HR / Behavioral skills
   */
  /**
   * Build prompt context block for injection into General / HR / Behavioral skills
   */
  getPromptContext() {
    this._init();
    if (!this._cachedResume) {
      return '';
    }

    const text = (this._cachedResume.text || '').trim();
    const company = (this._cachedResume.company || '').trim();
    const jobDescription = (this._cachedResume.jobDescription || '').trim();

    const hasResume = !!text;
    const hasCompany = !!company;
    const hasJd = !!jobDescription;

    if (!hasResume && !hasCompany && !hasJd) {
      return '';
    }

    let contextBlock = '\n\n## CANDIDATE PROFILE & TARGET ROLE CONTEXT:';
    contextBlock += '\nWhen the user asks behavioral, situational, project deep-dive, role alignment, or HR questions (such as "Tell me about yourself", "Tell me about a time...", "Describe a challenge you faced", "Why are you interested in this role?", "Why our company?"):';
    contextBlock += '\n- Ground your responses in the candidate\'s real background, projects, metrics, and accomplishments.';
    contextBlock += '\n- Speak naturally from the candidate\'s first-person perspective ("In my experience...", "When I built...", "At my previous role...").';
    contextBlock += '\n- Follow the STAR method (Situation → Task → Action → Result) utilizing these real accomplishments.';

    if (hasCompany) {
      contextBlock += `\n\n### TARGET COMPANY:\n**${company}**\n- Explicitly align answers with ${company}'s known engineering culture, business domain, products, scale, and values.`;
      contextBlock += `\n- When asked questions like "Why this company?" or "Why do you want to work here?", directly reference ${company}'s mission, technical challenges, and industry impact.`;
    }

    if (hasJd) {
      const cappedJd = jobDescription.length > 5000
        ? jobDescription.substring(0, 5000) + '\n[...job description truncated for brevity...]'
        : jobDescription;
      contextBlock += `\n\n### TARGET ROLE & JOB DESCRIPTION (JD):\n${cappedJd}\n- Prioritize project achievements, skills, and technical stack that directly match the responsibilities and qualifications listed above.`;
    }

    if (hasResume) {
      const cappedContent = text.length > 6000
        ? text.substring(0, 6000) + '\n[...resume truncated for context brevity...]'
        : text;
      contextBlock += `\n\n### CANDIDATE RESUME / EXPERIENCE DETAILS:\n${cappedContent}\n--- END RESUME DETAILS ---`;
    }

    return contextBlock;
  }
}

module.exports = new ResumeService();
