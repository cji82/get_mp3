const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 38472;
const tempDir = path.join(os.tmpdir(), 'get_mp3');
const fileStore = new Map(); // id -> { filePath, ext, mime, createdAt }
const jobStore = new Map(); // id -> { status, progress, message, error, downloadId, sourceUrl, quality, format, createdAt, updatedAt }

app.use(cors({ origin: true }));
app.use(express.json());

const YOUTUBE_REGEX = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\/.+$/;

const serverDir = path.resolve(__dirname);
const YT_DLP_CMD = process.env.YT_DLP_PATH
  || path.join(serverDir, process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const FFMPEG_PATH = process.env.FFMPEG_PATH
  || path.join(serverDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
const NODE_PATH = process.env.JS_RUNTIME_PATH || process.execPath;
const spawnEnv = { ...process.env, PATH: serverDir + path.delimiter + (process.env.PATH || '') };
const CHALLENGE_ERROR_REGEX = /(n challenge|nsig extraction failed|Error solving challenge request)/i;

function ensureTempDir() {
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
}

function safeUnlink(filePath) {
  try {
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (_) {}
}

function cleanupSiblingTempFiles(finalPath) {
  // 결과 파일과 같은 basename을 가진 중간 산출물(.mp4/.webm/.part 등) 정리
  const parsed = path.parse(finalPath);
  const dir = parsed.dir;
  const base = parsed.name;
  const keepExt = parsed.ext.toLowerCase();
  const candidates = [
    path.join(dir, `${base}.mp4`),
    path.join(dir, `${base}.webm`),
    path.join(dir, `${base}.m4a`),
    path.join(dir, `${base}.opus`),
    path.join(dir, `${base}.part`),
    path.join(dir, `${base}${keepExt}.part`)
  ];
  for (const p of candidates) {
    if (p.toLowerCase() === finalPath.toLowerCase()) continue;
    safeUnlink(p);
  }
}

function cleanupTempDirByAge(maxAgeMs = 10 * 60 * 1000) {
  if (!fs.existsSync(tempDir)) return;
  const now = Date.now();
  let files = [];
  try {
    files = fs.readdirSync(tempDir);
  } catch (_) {
    return;
  }
  for (const name of files) {
    const fullPath = path.join(tempDir, name);
    try {
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > maxAgeMs) safeUnlink(fullPath);
    } catch (_) {}
  }
}

function normalizeFormat(format) {
  return (format || '').toString().toLowerCase() === 'm4a' ? 'm4a' : 'mp3';
}

function extractProgress(line) {
  const match = line.match(/\[download\]\s+(\d+(?:\.\d+)?)%/i);
  if (!match) return null;
  const p = parseFloat(match[1]);
  if (Number.isNaN(p)) return null;
  const etaMatch = line.match(/ETA\s+([0-9:]+)/i);
  return {
    progress: Math.min(100, Math.max(0, p)),
    eta: etaMatch ? etaMatch[1] : null
  };
}

function parseOutputBuffer(buffer) {
  // yt-dlp는 진행 갱신을 carriage return(\r) 기반으로 출력하는 경우가 많다.
  const lines = buffer.split(/\r?\n|\r/g);
  return {
    lines: lines.slice(0, -1),
    rest: lines[lines.length - 1] || ''
  };
}

function runYtDlpOnce(args, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP_CMD, args, { stdio: ['ignore', 'pipe', 'pipe'], env: spawnEnv });
    let stderr = '';
    let stderrBuffer = '';
    let stdoutBuffer = '';
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.stderr.on('data', (d) => {
      if (!onProgress) return;
      stderrBuffer += d.toString();
      const parsed = parseOutputBuffer(stderrBuffer);
      const lines = parsed.lines;
      stderrBuffer = parsed.rest;
      for (const line of lines) {
        const info = extractProgress(line);
        if (info) {
          const msg = info.eta ? `다운로드 중 (ETA ${info.eta})` : '다운로드 중';
          onProgress(info.progress, msg);
        } else if (/\[extractaudio\]/i.test(line)) {
          onProgress(99, '오디오 변환 중');
        }
      }
    });
    proc.stdout.on('data', (d) => {
      if (!onProgress) return;
      stdoutBuffer += d.toString();
      const parsed = parseOutputBuffer(stdoutBuffer);
      const lines = parsed.lines;
      stdoutBuffer = parsed.rest;
      for (const line of lines) {
        const info = extractProgress(line);
        if (info) {
          const msg = info.eta ? `다운로드 중 (ETA ${info.eta})` : '다운로드 중';
          onProgress(info.progress, msg);
        } else if (/\[extractaudio\]/i.test(line)) {
          onProgress(99, '오디오 변환 중');
        }
      }
    });
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr || `yt-dlp exited ${code}`));
      }
    });
    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('yt-dlp를 찾을 수 없습니다. 설치 후 PATH에 추가하거나 YT_DLP_PATH 환경변수로 경로를 지정하세요.'));
      } else {
        reject(err);
      }
    });
  });
}

function runYtDlp(youtubeUrl, audioQuality = 0, format = 'mp3', onProgress = null) {
  const q = Math.min(9, Math.max(0, parseInt(audioQuality, 10) || 0));
  const normalizedFormat = normalizeFormat(format);
  return new Promise((resolve, reject) => {
    ensureTempDir();
    const id = `audio_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const outExt = normalizedFormat === 'm4a' ? 'm4a' : 'mp3';
    const outPath = path.join(tempDir, `${id}.${outExt}`);
    const commonArgs = ['--newline', '--js-runtimes', `node:${NODE_PATH}`, '--no-playlist', '-o', outPath];
    const commonFallbackArgs = ['--newline', '--extractor-args', 'youtube:player_client=android', '--no-playlist', '-o', outPath];

    let baseArgs;
    let fallbackArgs;
    if (normalizedFormat === 'm4a') {
      baseArgs = [
        ...commonArgs,
        '--format', 'bestaudio[ext=m4a]/bestaudio[acodec*=mp4a]/bestaudio',
        youtubeUrl
      ];
      fallbackArgs = [
        ...commonFallbackArgs,
        '--format', 'bestaudio[ext=m4a]/bestaudio[acodec*=mp4a]/bestaudio',
        youtubeUrl
      ];
    } else {
      baseArgs = [
        ...commonArgs,
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', String(q),
        '--ffmpeg-location', FFMPEG_PATH,
        youtubeUrl
      ];
      fallbackArgs = [
        ...commonFallbackArgs,
        '-x',
        '--audio-format', 'mp3',
        '--audio-quality', String(q),
        '--ffmpeg-location', FFMPEG_PATH,
        youtubeUrl
      ];
    }

    runYtDlpOnce(baseArgs, onProgress)
      .catch((firstErr) => {
        if (!CHALLENGE_ERROR_REGEX.test(firstErr.message || '')) throw firstErr;
        if (onProgress) onProgress(null, 'YouTube 챌린지 우회 재시도 중...');
        return runYtDlpOnce(fallbackArgs, onProgress);
      })
      .then(() => {
        if (fs.existsSync(outPath)) {
          cleanupSiblingTempFiles(outPath);
          resolve({
            filePath: outPath,
            ext: outExt,
            mime: normalizedFormat === 'm4a' ? 'audio/mp4' : 'audio/mpeg'
          });
        } else {
          reject(new Error('변환은 완료되었지만 출력 파일을 찾지 못했습니다.'));
        }
      })
      .catch((err) => {
        if (fs.existsSync(outPath)) try { fs.unlinkSync(outPath); } catch (_) {}
        reject(err);
      });
  });
}

app.get('/convert', async (req, res) => {
  const url = (req.query.url || '').trim();
  const quality = req.query.quality;
  const format = normalizeFormat(req.query.format);
  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: '유효한 YouTube URL을 입력하세요.' });
  }
  try {
    const result = await runYtDlp(url, quality, format);
    const downloadId = path.basename(result.filePath, path.extname(result.filePath));
    fileStore.set(downloadId, {
      filePath: result.filePath,
      ext: result.ext,
      mime: result.mime,
      createdAt: Date.now()
    });
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    res.json({ downloadUrl: `${baseUrl}/file/${downloadId}.${result.ext}` });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || '변환 실패' });
  }
});

app.post('/convert/start', async (req, res) => {
  const url = ((req.body && req.body.url) || req.query.url || '').trim();
  const quality = (req.body && req.body.quality) || req.query.quality;
  const format = normalizeFormat((req.body && req.body.format) || req.query.format);
  const normalizedQuality = Math.min(9, Math.max(0, parseInt(quality, 10) || 0));
  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: '유효한 YouTube URL을 입력하세요.' });
  }

  // 같은 URL/음질로 이미 진행 중인 작업이 있으면 재사용
  for (const [existingId, job] of jobStore.entries()) {
    if (!job) continue;
    const sameRequest = job.sourceUrl === url && (job.quality === normalizedQuality) && (job.format === format);
    const active = job.status === 'queued' || job.status === 'running';
    if (sameRequest && active) {
      const baseUrl = `${req.protocol}://${req.get('host')}`;
      return res.json({
        jobId: existingId,
        reused: true,
        statusUrl: `${baseUrl}/convert/status/${existingId}`
      });
    }
  }

  const jobId = `job_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  jobStore.set(jobId, {
    status: 'queued',
    progress: 0,
    message: '대기 중',
    error: null,
    downloadId: null,
    sourceUrl: url,
    quality: normalizedQuality,
    format,
    createdAt: now,
    updatedAt: now
  });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  res.json({
    jobId,
    statusUrl: `${baseUrl}/convert/status/${jobId}`
  });

  try {
    const running = jobStore.get(jobId);
    if (!running) return;
    running.status = 'running';
    running.message = '다운로드/변환 중';
    running.updatedAt = Date.now();
    jobStore.set(jobId, running);

    const result = await runYtDlp(url, normalizedQuality, format, (progress, message) => {
      const job = jobStore.get(jobId);
      if (!job) return;
      if (typeof progress === 'number') job.progress = progress;
      if (message) job.message = message;
      job.updatedAt = Date.now();
      jobStore.set(jobId, job);
    });

    const downloadId = path.basename(result.filePath, path.extname(result.filePath));
    fileStore.set(downloadId, {
      filePath: result.filePath,
      ext: result.ext,
      mime: result.mime,
      createdAt: Date.now()
    });
    const done = jobStore.get(jobId);
    if (!done) return;
    done.status = 'done';
    done.progress = 100;
    done.message = '완료';
    done.downloadId = downloadId;
    done.updatedAt = Date.now();
    jobStore.set(jobId, done);
  } catch (err) {
    const failed = jobStore.get(jobId);
    if (!failed) return;
    failed.status = 'error';
    failed.error = err.message || '변환 실패';
    failed.message = '실패';
    failed.updatedAt = Date.now();
    jobStore.set(jobId, failed);
  }
});

app.get('/convert/active', (req, res) => {
  const url = (req.query.url || '').trim();
  const hasQuality = req.query.quality !== undefined && req.query.quality !== null && req.query.quality !== '';
  const quality = Math.min(9, Math.max(0, parseInt(req.query.quality, 10) || 0));
  const format = normalizeFormat(req.query.format);
  const hasFormat = req.query.format !== undefined && req.query.format !== null && req.query.format !== '';
  if (!url || !YOUTUBE_REGEX.test(url)) {
    return res.status(400).json({ error: '유효한 YouTube URL을 입력하세요.' });
  }
  for (const [jobId, job] of jobStore.entries()) {
    if (!job) continue;
    const sameQuality = hasQuality ? job.quality === quality : true;
    const sameFormat = hasFormat ? job.format === format : true;
    const sameRequest = job.sourceUrl === url && sameQuality && sameFormat;
    const active = job.status === 'queued' || job.status === 'running';
    if (sameRequest && active) {
      return res.json({
        jobId,
        status: job.status,
        progress: job.progress,
        message: job.message,
        quality: job.quality,
        format: job.format
      });
    }
  }
  return res.json({ jobId: null });
});

app.get('/convert/status/:jobId', (req, res) => {
  const jobId = req.params.jobId;
  const job = jobStore.get(jobId);
  if (!job) return res.status(404).json({ error: '작업을 찾을 수 없습니다.' });

  const baseUrl = `${req.protocol}://${req.get('host')}`;
  const payload = {
    jobId,
    status: job.status,
    progress: job.progress,
    message: job.message,
    error: job.error,
    downloadUrl: (() => {
      if (!job.downloadId) return null;
      const entry = fileStore.get(job.downloadId);
      const ext = entry?.ext || (job.format === 'm4a' ? 'm4a' : 'mp3');
      return `${baseUrl}/file/${job.downloadId}.${ext}`;
    })()
  };
  res.json(payload);
});

app.get('/file/:id', (req, res) => {
  const id = path.basename(path.parse(req.params.id || '').name || '');
  const entry = fileStore.get(id);
  if (!entry || !fs.existsSync(entry.filePath)) {
    return res.status(404).send('파일 없음');
  }
  const ext = entry.ext || 'mp3';
  const mime = entry.mime || (ext === 'm4a' ? 'audio/mp4' : 'audio/mpeg');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', 'attachment; filename="' + id + '.' + ext + '"');
  const stream = fs.createReadStream(entry.filePath);
  stream.pipe(res);
  stream.on('end', () => {
    try {
      fs.unlinkSync(entry.filePath);
      fileStore.delete(id);
    } catch (_) {}
  });
  stream.on('error', () => {
    try { fs.unlinkSync(entry.filePath); } catch (_) {}
    fileStore.delete(id);
  });
});

// 오래된 임시 파일 정리 (10분)
setInterval(() => {
  const now = Date.now();
  const maxAge = 10 * 60 * 1000;
  const jobMaxAge = 30 * 60 * 1000;
  for (const [id, entry] of fileStore.entries()) {
    if (now - entry.createdAt > maxAge) {
      try { if (fs.existsSync(entry.filePath)) fs.unlinkSync(entry.filePath); } catch (_) {}
      fileStore.delete(id);
    }
  }
  for (const [jobId, job] of jobStore.entries()) {
    if (now - (job.updatedAt || job.createdAt || now) > jobMaxAge) {
      jobStore.delete(jobId);
    }
  }
  cleanupTempDirByAge(maxAge);
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`서버 http://localhost:${PORT}`);
});
