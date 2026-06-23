const fs = require('fs');
const path = require('path');

class VisualManifestReporter {
  constructor(options = {}) {
    this.outputFile = options.outputFile || 'e2e/artifacts/visual-manifest.json';
    this.tests = [];
  }

  onTestEnd(test, result) {
    const attachments = (result.attachments || []).map((item) => ({
      name: item.name,
      path: item.path ? path.normalize(item.path) : null,
      contentType: item.contentType || null,
    }));

    this.tests.push({
      title: test.title,
      file: test.location?.file ? path.normalize(test.location.file) : null,
      line: test.location?.line ?? null,
      status: result.status,
      durationMs: result.duration,
      error: result.error?.message || null,
      attachments,
      screenshots: attachments
        .filter((item) => item.contentType === 'image/png' && item.path)
        .map((item) => item.path),
      video: attachments.find((item) => item.contentType === 'video/webm')?.path || null,
      trace: attachments.find((item) => item.name === 'trace')?.path || null,
    });
  }

  onEnd() {
    const payload = {
      generatedAt: new Date().toISOString(),
      hint: 'Открой e2e/artifacts/report/index.html или передай visual-manifest.json агенту для разбора.',
      tests: this.tests,
    };

    const out = path.resolve(process.cwd(), this.outputFile);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  }
}

module.exports = VisualManifestReporter;
